// Smooth Caret: draws a gliding caret over whichever text field has focus.
//
// Where the caret is:
// - contenteditable: the Selection API hands back the caret's rect in viewport
//   coordinates (range.getClientRects()), with every wrapper, padding,
//   transform and scroll offset on the page already applied by the browser.
// - <input>/<textarea>: their text lives in a closed UA shadow tree that ranges
//   can't reach. We copy the field's text-layout styles onto a hidden "mirror"
//   div with the same content width, let the browser lay the same text out
//   there, and read the rect of the character at the caret. That gives the
//   caret's offset inside the field's padding box, and the field's own
//   getBoundingClientRect() puts it on the page. Wrappers and ancestor padding
//   never enter the math.
//
// The caret animates in the field's unscrolled content space, so scrolling the
// page or the field moves it rigidly with the text; only real caret movement
// (typing, clicking, arrow keys) glides.
(() => {
  'use strict';
  if (globalThis.__smoothCaretLoaded) return;
  globalThis.__smoothCaretLoaded = true;

  const DEFAULTS = {
    enabled: true,
    disabledSites: [],
    colorMode: 'auto', // 'auto' uses the field's own caret color
    color: '#00a6ff', // any CSS color, alpha included
    duration: 150, // ms the caret takes to arrive; 0 jumps
    easing: 'ease-out', // see step()
    width: 2,
    blink: true,
    rainbow: false, // cycle the hue of `color`, see rainbowColor(); paused under 'auto'
    rainbowSpeed: 3, // 1 is a 10s lap round the hue wheel, 10 is 1s
  };
  const TEST = !!globalThis.__SMOOTHCARET_TEST__;
  // The extension's chrome.*, or the stand-in inject/build.mjs passes in when
  // this runs pasted into a page.
  const ext = typeof chrome !== 'undefined' ? chrome : undefined;
  const SELECTED = { selected: true };
  const site = topHostname();
  let settings = { ...DEFAULTS };

  // Text-layout properties the mirror copies from the field. Anything that can
  // change where a glyph lands or where a line wraps.
  const MIRROR_PROPS = [
    'direction', 'unicode-bidi', 'writing-mode',
    'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch',
    'font-variant', 'font-variant-caps', 'font-variant-ligatures', 'font-variant-numeric',
    'font-variant-east-asian', 'font-variant-alternates', 'font-feature-settings',
    'font-variation-settings', 'font-kerning', 'font-optical-sizing', 'font-size-adjust',
    'font-synthesis', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform',
    'text-indent', 'text-align', 'text-align-last', 'text-justify', 'text-rendering',
    'tab-size', 'word-break', 'overflow-wrap', 'line-break', 'hyphens',
    'white-space-collapse', 'text-wrap-mode', 'text-wrap-style', 'text-autospace',
    'text-spacing-trim', '-webkit-text-security',
  ];
  // The host is a 0x0 box CSS-anchored to the top-left of whatever element has
  // focus (see the :focus rule in ensureBuilt). Chrome keeps anchored boxes
  // glued to their anchor as pages and scroll containers scroll, on its own
  // scrolling thread, so the caret moves with the text before this script's
  // next frame runs. Where anchoring isn't available the host sits at 0,0 and
  // the frame loop places everything, as before.
  const HOST_CSS = [
    'all:initial', 'display:block', 'position:fixed', 'left:0', 'top:0', 'right:auto', 'bottom:auto',
    // The default anchor (position-anchor), not a name inside anchor(): Chrome
    // only applies its scroll tracking to the default anchor.
    'position-anchor:--smooth-caret', 'left:anchor(left, 0px)', 'top:anchor(top, 0px)',
    'position-visibility:always', 'width:0', 'height:0',
    'max-width:none', 'max-height:none', 'margin:0', 'padding:0', 'border:0',
    'background:transparent', 'overflow:visible', 'pointer-events:none',
    'z-index:2147483647', 'visibility:visible', 'opacity:1', 'transform:none',
    'filter:none', 'clip-path:none', 'contain:none',
  ].map((d) => d + '!important').join(';');
  const SHADOW_CSS = `
    .clip { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden;
            opacity: 0; transition: opacity .12s ease; }
    .clip.on { opacity: 1; }
    .caret { position: absolute; left: 0; top: 0; width: 2px; height: 0;
             border-radius: 1px; will-change: transform; }
  `;
  const HIDE_CSS = ':focus{caret-color:transparent!important;anchor-name:--smooth-caret}';
  const BLINK = [
    { opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.6 },
    { opacity: 0, offset: 0.9 }, { opacity: 1 },
  ];

  let host, clipEl, caretEl, mirrorEl, mirrorText, hideStyle, hideSheet, blinkAnim;
  let active = null;
  let rafId = 0;
  let shown = false;
  let lastClip = '';
  let lastCaret = '';
  let lastMirrorCss = '';
  let keepNative = false;
  let paused = false; // test hook only
  let rainbowBase = null;
  let parseCtx = null;
  let graphemes = null;
  const probe = document.createRange();

  // ---------- overlay ----------

  // One fixed, full-viewport host with a closed shadow root. It's a manual
  // popover so it can be lifted into the top layer, above modal <dialog>s and
  // fullscreen elements that no z-index can beat.
  function ensureBuilt() {
    if (!host) {
      host = document.createElement('smooth-caret-overlay');
      host.setAttribute('popover', 'manual');
      host.style.cssText = HOST_CSS;
      const shadow = host.attachShadow({ mode: 'closed' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(SHADOW_CSS);
      shadow.adoptedStyleSheets = [sheet];
      clipEl = document.createElement('div');
      clipEl.className = 'clip';
      caretEl = document.createElement('div');
      caretEl.className = 'caret';
      clipEl.append(caretEl);
      mirrorEl = document.createElement('div');
      mirrorText = document.createTextNode('');
      mirrorEl.append(mirrorText);
      shadow.append(clipEl, mirrorEl);
      blinkAnim = caretEl.animate(BLINK, { duration: 1100, iterations: Infinity, easing: 'ease-in-out' });
      applyBlink();

      // While enabled, this hides the native caret of whatever has focus and
      // makes it the overlay's anchor. Shadow hosts match :focus too, and
      // caret-color inherits into their shadow trees.
      hideStyle = document.createElement('style');
      hideStyle.textContent = HIDE_CSS;
    }
    const root = document.documentElement;
    if (!host.isConnected) root.append(host);
    if (!hideStyle.isConnected && !hideSheet?.constructed) {
      root.append(hideStyle);
      hideSheet = hideStyle.sheet;
      // A page whose CSP forbids inline styles (one this was pasted into, not
      // an extension's isolated world) leaves the <style> empty. A constructed
      // sheet isn't inline, so it still applies.
      if (!hideSheet?.cssRules.length) {
        hideStyle.remove();
        hideSheet = new CSSStyleSheet();
        hideSheet.replaceSync(HIDE_CSS);
        hideSheet.constructed = true;
      }
      hideSheet.disabled = true;
    }
    if (hideSheet.constructed && !document.adoptedStyleSheets.includes(hideSheet)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, hideSheet];
    }
  }

  // Top-layer order is "most recently shown wins", so re-show on every
  // activation to stay above dialogs and popovers opened since.
  function bumpTopLayer() {
    if (typeof host.showPopover !== 'function') return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch {
      // Not supported here, or the host was detached. Plain z-index still works.
    }
  }

  function setHide(on) {
    if (hideSheet) hideSheet.disabled = !on || keepNative;
  }

  function setShown(on) {
    if (on === shown || !clipEl) return;
    shown = on;
    clipEl.classList.toggle('on', on);
  }

  function place(l, t, w, h, x, y, cw, ch) {
    const clipKey = `${l},${t},${w},${h}`;
    if (clipKey !== lastClip) {
      lastClip = clipKey;
      const s = clipEl.style;
      s.left = l + 'px';
      s.top = t + 'px';
      s.width = w + 'px';
      s.height = h + 'px';
    }
    const caretKey = `${x},${y},${cw},${ch}`;
    if (caretKey !== lastCaret) {
      lastCaret = caretKey;
      const s = caretEl.style;
      s.transform = `translate(${x}px,${y}px)`;
      s.width = cw + 'px';
      s.height = ch + 'px';
    }
  }

  function restartBlink() {
    if (blinkAnim && settings.blink) blinkAnim.currentTime = 0;
  }

  function applyBlink() {
    if (!blinkAnim) return;
    if (settings.blink) {
      blinkAnim.play();
    } else {
      blinkAnim.pause();
      blinkAnim.currentTime = 0;
    }
  }

  // ---------- which element, and is it ours to draw ----------

  function shadowOf(el) {
    try {
      if (ext && ext.dom && ext.dom.openOrClosedShadowRoot) return ext.dom.openOrClosedShadowRoot(el);
    } catch {
      // Fall through to the open root.
    }
    return el.shadowRoot;
  }

  function deepActive() {
    let el = document.activeElement;
    for (;;) {
      const root = el && shadowOf(el);
      const inner = root && root.activeElement;
      if (!inner) return el;
      el = inner;
    }
  }

  function kindOf(el) {
    if (!el) return null;
    const tag = el.localName;
    if (tag === 'textarea') return el.readOnly || el.disabled ? null : 'field';
    // email, number and friends report selectionStart === null, so we can't
    // know where their caret is; those keep the native one.
    if (tag === 'input') {
      return typeof el.selectionStart === 'number' && !el.readOnly && !el.disabled ? 'field' : null;
    }
    return el.isContentEditable ? 'editable' : null;
  }

  function caretColorOf(cs) {
    const c = cs.caretColor;
    return !c || c === 'auto' || c === 'currentcolor' ? cs.color : c;
  }

  function alphaOf(color) {
    if (!color || color === 'transparent') return 0;
    const m = /\(([^)]*)\)/.exec(color);
    if (!m) return 1;
    const body = m[1];
    let a;
    if (body.includes('/')) a = body.split('/')[1];
    else if (body.split(',').length === 4) a = body.split(',')[3];
    else return 1;
    a = a.trim();
    const v = parseFloat(a) / (a.endsWith('%') ? 100 : 1);
    return Number.isNaN(v) ? 1 : v;
  }

  function num(v) {
    return parseFloat(v) || 0;
  }

  function isOn() {
    return settings.enabled && !(settings.disabledSites || []).includes(site);
  }

  function evaluate() {
    const el = isOn() && (TEST || document.hasFocus()) ? deepActive() : null;
    if (active && active.el === el) {
      loop();
      return;
    }
    deactivate();
    const kind = kindOf(el);
    if (!kind) return;
    ensureBuilt();

    // Read the page's own caret color with our hiding rule off. A transparent
    // caret means the page hides it on purpose and draws its own (CodeMirror,
    // Monaco, Ace, Google Docs), so we stay out of the way. So do tiny or
    // invisible proxy fields that editors use to capture keystrokes.
    setHide(false);
    const cs = getComputedStyle(el);
    const color = caretColorOf(cs);
    const rect = el.getBoundingClientRect();
    if (alphaOf(color) === 0 || rect.width < 4 || rect.height < 4 || num(cs.opacity) < 0.05) return;

    active = {
      el,
      kind,
      cs,
      color,
      n: 0,
      clippers: clippers(el),
      clipSelf: kind === 'field' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible',
      pos: null,
      tgt: null,
    };
    setHide(true);
    // Component styles inside a shadow tree can beat the document rule. Fall
    // back to an inline style, put back on blur.
    if (!keepNative && alphaOf(caretColorOf(cs)) !== 0) {
      active.inline = [el.style.getPropertyValue('caret-color'), el.style.getPropertyPriority('caret-color')];
      el.style.setProperty('caret-color', 'transparent', 'important');
    }
    caretEl.style.background = colorFor(active);
    lastClip = lastCaret = '';
    bumpTopLayer();
    loop();
  }

  function deactivate() {
    if (!active) return;
    if (active.inline) active.el.style.setProperty('caret-color', ...active.inline);
    active = null;
    setHide(false);
    setShown(false);
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function colorFor(st) {
    if (settings.colorMode !== 'custom') return st.color;
    return settings.rainbow ? rainbowColor() : settings.color;
  }

  // Keeps the saved color's saturation, brightness and opacity and turns its
  // hue with the wall clock. The popup uses the same formula, so the popup and
  // every tab show the same color at the same moment.
  function rainbowColor() {
    if (!rainbowBase) rainbowBase = toHsva(settings.color);
    const { h, s, v, a } = rainbowBase;
    const hue = (((h + (Date.now() / 1000) * (settings.rainbowSpeed / 10)) % 1) + 1) % 1;
    const f = (n) => {
      const k = (n + hue * 6) % 6;
      return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
    };
    return `rgba(${f(5)}, ${f(3)}, ${f(1)}, ${a})`;
  }

  function toHsva(css) {
    // Canvas normalizes any CSS color to #rrggbb or rgba(r, g, b, a). One
    // context, reused: settings can change every few frames during a drag.
    parseCtx ||= document.createElement('canvas').getContext('2d');
    parseCtx.fillStyle = '#000';
    parseCtx.fillStyle = css;
    const c = parseCtx.fillStyle;
    const [r, g, b, a = 1] = c[0] === '#'
      ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      : c.match(/[\d.]+/g).map((n, i) => (i < 3 ? n / 255 : +n));
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h / 6, s: max ? d / max : 0, v: max, a };
  }

  // ---------- geometry ----------

  function readBox(el) {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      // CSS transforms on any ancestor scale the field; the ratio of its
      // on-screen size to its layout size recovers that scale.
      sx: el.offsetWidth ? r.width / el.offsetWidth : 1,
      sy: el.offsetHeight ? r.height / el.offsetHeight : 1,
      cl: el.clientLeft,
      ct: el.clientTop,
      cw: el.clientWidth,
      ch: el.clientHeight,
      sl: el.scrollLeft,
      st: el.scrollTop,
    };
  }

  function flatParent(n) {
    if (n.assignedSlot) return n.assignedSlot;
    const p = n.parentNode;
    if (!p) return null;
    if (p.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return p.host || null;
    return p.nodeType === Node.ELEMENT_NODE ? p : null;
  }

  // Ancestors whose overflow clips the field: scroll containers, overflow:hidden
  // wrappers. Absolute and fixed boxes escape clipping by ancestors below their
  // containing block, so those are skipped.
  function clippers(el) {
    const list = [];
    let pos = getComputedStyle(el).position;
    const root = document.documentElement;
    for (let n = flatParent(el); n && n !== root && n !== document.body; n = flatParent(n)) {
      const cs = getComputedStyle(n);
      const holdsFixed = cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none'
        || /paint|layout|strict|content/.test(cs.contain) || /transform|perspective|filter/.test(cs.willChange);
      const isBlock = pos === 'fixed' ? holdsFixed : pos === 'absolute' ? cs.position !== 'static' || holdsFixed : true;
      const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain);
      if (isBlock && clips && cs.display !== 'contents' && cs.display !== 'inline') list.push(n);
      if (isBlock) pos = cs.position;
    }
    return list;
  }

  function clipBox(st, box) {
    // No viewport bound: the overlay scrolls with the page now, so a viewport
    // edge would go stale mid-scroll, and off-screen pixels don't show anyway.
    let l = -Infinity;
    let t = -Infinity;
    let r = Infinity;
    let b = Infinity;
    // A little horizontal slack so a caret sitting on a zero-padding edge isn't
    // sliced in half.
    const ex = settings.width + 1;
    const cut = (L, T, R, B) => {
      l = Math.max(l, L - ex);
      t = Math.max(t, T - 1);
      r = Math.min(r, R + ex);
      b = Math.min(b, B + 1);
    };
    if (st.clipSelf) {
      const x = box.left + box.cl * box.sx;
      const y = box.top + box.ct * box.sy;
      cut(x, y, x + box.cw * box.sx, y + box.ch * box.sy);
    }
    for (const a of st.clippers) {
      const ar = a.getBoundingClientRect();
      const sx = a.offsetWidth ? ar.width / a.offsetWidth : 1;
      const sy = a.offsetHeight ? ar.height / a.offsetHeight : 1;
      const x = ar.left + a.clientLeft * sx;
      const y = ar.top + a.clientTop * sy;
      cut(x, y, x + a.clientWidth * sx, y + a.clientHeight * sy);
    }
    // An editable that overflows freely has nothing clipping it; cap the box.
    const far = 4096;
    l = Math.max(l, box.left - far);
    t = Math.max(t, box.top - far);
    r = Math.min(r, box.left + box.cw * box.sx + far);
    b = Math.min(b, box.top + box.ch * box.sy + far);
    return r > l && b > t ? { l, t, r, b } : null;
  }

  function firstRect(rects) {
    for (const r of rects) if (r.height > 0) return r;
    return null;
  }

  function lastRect(rects) {
    for (let i = rects.length - 1; i >= 0; i--) if (rects[i].height > 0) return rects[i];
    return null;
  }

  // ---------- input / textarea ----------

  function styleSig(cs) {
    let s = cs.paddingLeft + cs.paddingRight + cs.paddingTop + cs.paddingBottom;
    for (const p of MIRROR_PROPS) s += '|' + cs.getPropertyValue(p);
    return s;
  }

  function fieldTarget(st, box) {
    const el = st.el;
    const k = el.selectionStart;
    if (k == null) return null;
    if (k !== el.selectionEnd) return SELECTED;
    const value = fieldText(el, st.cs);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (st.n % 30 === 0) {
      const sig = styleSig(st.cs);
      if (sig !== st.sig) {
        st.sig = sig;
        st.cache = null;
      }
    }
    if (!st.cache || value !== st.value || k !== st.k || cw !== st.cw || ch !== st.ch) {
      st.value = value;
      st.k = k;
      st.cw = cw;
      st.ch = ch;
      st.cache = layoutField(st.el, st.cs, value, k);
    }
    const t = st.cache;
    if (!t || !t.up || !st.hint) return t;
    // At a soft wrap the end of one line and the start of the next are the
    // same offset. Chrome shows the end of the upper line after End/Cmd+Right
    // or a click to the right of it, so follow what the user just did.
    if (st.hint === 'end') return t.up;
    const upMid = box.top + box.sy * (box.ct + t.up.y + t.up.h / 2 - box.st);
    const downMid = box.top + box.sy * (box.ct + t.y + t.h / 2 - box.st);
    return Math.abs(st.hint.y - upMid) < Math.abs(st.hint.y - downMid) ? t.up : t;
  }

  // Password fields draw every character as the same dot, so the mirror gets
  // placeholders instead: the password is never copied into it or kept here.
  function fieldText(el, cs) {
    return cs.getPropertyValue('-webkit-text-security') === 'none' ? el.value : maskedText(el.value);
  }

  // Chrome draws one dot per grapheme (an emoji or a letter with accents is
  // one dot), so each grapheme becomes an 'x' padded with combining marks to
  // the same UTF-16 length. It draws the same dots and wraps the same way, and
  // every offset lands where it did. Newlines stay.
  function maskedText(value) {
    graphemes ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let out = '';
    for (const { segment } of graphemes.segment(value)) {
      out += segment === '\n' ? '\n' : 'x' + '́'.repeat(segment.length - 1);
    }
    return out;
  }

  // Lays the field's text out in the mirror and returns the caret at offset k
  // as {x, y, h} relative to the field's padding box, ignoring scroll. At a
  // soft wrap, `up` is the same caret drawn at the end of the upper line.
  function layoutField(el, cs, value, k) {
    const isInput = el.localName === 'input';
    const padL = num(cs.paddingLeft);
    const padR = num(cs.paddingRight);
    const padT = num(cs.paddingTop);
    const padB = num(cs.paddingBottom);
    let css = 'all:initial;display:block;position:absolute;left:0;top:0;visibility:hidden;'
      + 'pointer-events:none;box-sizing:content-box;margin:0;padding:0;border:0;height:auto;';
    for (const p of MIRROR_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) css += `${p}:${v};`;
    }
    css += isInput ? 'white-space:pre;' : `white-space:${cs.getPropertyValue('white-space') || 'pre-wrap'};`;
    css += `width:${Math.max(0, el.clientWidth - padL - padR)}px;`;
    if (css !== lastMirrorCss) {
      lastMirrorCss = css;
      mirrorEl.style.cssText = css;
    }

    // At the end of the text or right before a hard line break there's no
    // character to measure, so a zero-width space stands in. It sits next to a
    // newline or at the very end, where it can't change how anything wraps.
    let text = value;
    if (k >= text.length || text.charCodeAt(k) === 10) text = text.slice(0, k) + '​' + text.slice(k);
    if (mirrorText.data !== text) mirrorText.data = text;

    const c = text.charCodeAt(k);
    const n = c >= 0xd800 && c <= 0xdbff && k + 1 < text.length ? 2 : 1;
    probe.setStart(mirrorText, k);
    probe.setEnd(mirrorText, k + n);
    const r = firstRect(probe.getClientRects());
    if (!r) return null;
    const m = mirrorEl.getBoundingClientRect();
    const rtl = cs.direction === 'rtl';
    // Inputs center their single line vertically in the content box.
    const dy = isInput ? padT + (el.clientHeight - padT - padB - m.height) / 2 : padT;
    const caret = { x: padL + (rtl ? r.right : r.left) - m.left, y: r.top - m.top + dy, h: r.height };

    if (!isInput && k > 0 && text.charCodeAt(k - 1) !== 10) {
      const p = text.charCodeAt(k - 1);
      probe.setStart(mirrorText, k - (p >= 0xdc00 && p <= 0xdfff && k > 1 ? 2 : 1));
      probe.setEnd(mirrorText, k);
      const u = lastRect(probe.getClientRects());
      if (u && u.top + u.height / 2 < r.top) {
        caret.up = { x: padL + (rtl ? u.left : u.right) - m.left, y: u.top - m.top + dy, h: u.height };
      }
    }
    return caret;
  }

  // ---------- contenteditable ----------

  function editableTarget(st, box) {
    const el = st.el;
    const root = el.getRootNode();
    const sel = typeof root.getSelection === 'function' ? root.getSelection() : document.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return SELECTED;
    if (!el.contains(range.startContainer)) return null;
    const r = rangeCaret(range);
    if (!r) return null;
    return {
      x: (r.x - box.left) / box.sx - box.cl + box.sl,
      y: (r.y - box.top) / box.sy - box.ct + box.st,
      h: r.h / box.sy,
    };
  }

  // Caret rect for a collapsed range, in viewport coordinates. Chrome returns
  // nothing for ranges between elements (empty lines, next to <br> or images),
  // so those fall back to the neighbouring character or inline box. The page's
  // DOM is never touched; editors watch it closely.
  function rangeCaret(range) {
    const r = firstRect(range.getClientRects());
    if (r) return { x: r.left, y: r.top, h: r.height };
    const node = range.startContainer;
    const off = range.startOffset;
    if (node.nodeType === Node.TEXT_NODE) return charEdge(node, off) || blockStart(node);
    return edgeOf(node.childNodes[off], false) || edgeOf(node.childNodes[off - 1], true) || blockStart(node);
  }

  function charEdge(text, off) {
    if (off < text.length && text.data.charCodeAt(off) !== 10) {
      probe.setStart(text, off);
      probe.setEnd(text, off + 1);
      const r = firstRect(probe.getClientRects());
      if (r) return { x: r.left, y: r.top, h: r.height };
    }
    if (off > 0) {
      probe.setStart(text, off - 1);
      probe.setEnd(text, off);
      const r = lastRect(probe.getClientRects());
      if (r) return { x: r.right, y: r.top, h: r.height };
    }
    return null;
  }

  function edgeOf(n, atEnd) {
    if (!n) return null;
    if (n.nodeType === Node.TEXT_NODE) return n.length ? charEdge(n, atEnd ? n.length : 0) : null;
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    // Only inline boxes: a block's rect is the whole block, not a line.
    if (n.localName !== 'br' && !getComputedStyle(n).display.startsWith('inline')) return null;
    const rects = n.getClientRects();
    const r = atEnd ? lastRect(rects) : firstRect(rects);
    return r ? { x: atEnd ? r.right : r.left, y: r.top, h: r.height } : null;
  }

  // Last resort: the start of the first line of the block holding the caret.
  function blockStart(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fs = num(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? fs * 1.2 : num(cs.lineHeight);
    const h = fs * 1.15;
    const left = b.left + num(cs.borderLeftWidth) + num(cs.paddingLeft);
    const right = b.right - num(cs.borderRightWidth) - num(cs.paddingRight);
    const align = cs.textAlign;
    const rtl = cs.direction === 'rtl';
    let x = left + num(cs.textIndent);
    if (align === 'center') x = (left + right) / 2;
    else if (align === 'right' || (align === 'end' && !rtl) || ((align === 'start' || align === 'left') && rtl)) x = right;
    return { x, y: b.top + num(cs.borderTopWidth) + num(cs.paddingTop) + (lh - h) / 2, h };
  }

  // ---------- frame loop ----------

  function loop() {
    if (!rafId && active && !paused) rafId = requestAnimationFrame(frame);
  }

  function frame(now) {
    rafId = 0;
    const st = active;
    if (!st) return;
    try {
      if (!st.el.isConnected || deepActive() !== st.el) {
        evaluate();
        return;
      }
      if (!TEST && !document.hasFocus()) {
        // The window lost focus; its 'focus' event brings us back.
        setShown(false);
        return;
      }
      if (!paused) rafId = requestAnimationFrame(frame);
      const dt = st.t ? Math.min(0.1, (now - st.t) / 1000) : 0;
      st.t = now;
      st.n++;
      if (st.n % 30 === 0) st.clippers = clippers(st.el);

      const box = readBox(st.el);
      const target = st.kind === 'field' ? fieldTarget(st, box) : editableTarget(st, box);
      const clip = target && target !== SELECTED ? clipBox(st, box) : null;
      if (!clip) {
        setShown(false);
        return;
      }
      step(st, target, dt);

      // Snap to device pixels so the resting caret is crisp, like the native one.
      const dpr = devicePixelRatio || 1;
      const snap = (v) => Math.round(v * dpr) / dpr;
      const w = settings.width;
      const vx = box.left + box.sx * (box.cl + st.pos.x - box.sl) - w / 2;
      const vy = box.top + box.sy * (box.ct + st.pos.y - box.st);
      const l = snap(clip.l);
      const t = snap(clip.t);
      // Everything is drawn relative to the anchored host. While only the page
      // or a scroll container moves, these numbers stay the same, so nothing
      // gets rewritten and Chrome's scrolling carries the caret by itself.
      const hr = host.getBoundingClientRect();
      place(l - hr.left, t - hr.top, snap(clip.r) - l, snap(clip.b) - t, snap(vx) - l, snap(vy) - t, w, snap(st.pos.h * box.sy));
      if (settings.rainbow && settings.colorMode === 'custom') caretEl.style.background = rainbowColor();
      setShown(true);
    } catch (err) {
      deactivate();
      if (TEST) throw err;
    }
  }

  // Every mode arrives in about `duration` and retargets mid-flight without a
  // kink, since each keystroke moves the target before the caret gets there.
  // - ease-out: exponential approach; starts fast, settles gently.
  // - ease-in-out: critically damped spring; keeps its velocity across
  //   retargets, so it speeds up and slows down smoothly.
  // - spring: underdamped spring that overshoots a little.
  // - linear: constant speed, recomputed from the remaining gap on retarget.
  // The springs use their exact solutions, so they stay stable at any frame rate.
  function step(st, tgt, dt) {
    if (!st.pos) {
      st.pos = { ...tgt };
      st.vel = { x: 0, y: 0, h: 0 };
      st.tgt = tgt;
      restartBlink();
      return;
    }
    const prev = st.tgt;
    const moved = Math.abs(prev.x - tgt.x) > 0.01 || Math.abs(prev.y - tgt.y) > 0.01 || Math.abs(prev.h - tgt.h) > 0.01;
    if (moved) restartBlink();
    st.tgt = tgt;
    const p = st.pos;
    const v = st.vel;
    const dur = settings.duration / 1000;
    // No glide, or a jump of more than a screen (Ctrl+End in a long document):
    // just land.
    if (!(dur > 0) || Math.abs(tgt.y - p.y) > innerHeight) {
      Object.assign(p, tgt);
      v.x = v.y = v.h = 0;
      return;
    }
    if (moved || !st.lin) {
      st.lin = { x: Math.abs(p.x - tgt.x) / dur, y: Math.abs(p.y - tgt.y) / dur, h: Math.abs(p.h - tgt.h) / dur };
    }
    const w = 4.74 / dur; // a critically damped spring is ~95% there at t = 4.74/w
    for (const key of ['x', 'y', 'h']) {
      const x0 = p[key] - tgt[key];
      const v0 = v[key];
      let x1;
      let v1 = 0;
      // The caret's height never bounces.
      const mode = key === 'h' && settings.easing === 'spring' ? 'ease-in-out' : settings.easing;
      if (mode === 'linear') {
        x1 = x0 - Math.sign(x0) * Math.min(Math.abs(x0), st.lin[key] * dt);
      } else if (mode === 'ease-in-out') {
        const e = Math.exp(-w * dt);
        x1 = (x0 + (v0 + w * x0) * dt) * e;
        v1 = (v0 - w * (v0 + w * x0) * dt) * e;
      } else if (mode === 'spring') {
        const z = 0.7; // ~5% overshoot
        const wd = w * Math.sqrt(1 - z * z);
        const e = Math.exp(-z * w * dt);
        const b = (v0 + z * w * x0) / wd;
        const c = Math.cos(wd * dt);
        const sn = Math.sin(wd * dt);
        x1 = e * (x0 * c + b * sn);
        v1 = e * (v0 * c - (x0 * wd + z * w * b) * sn);
      } else {
        x1 = x0 * Math.exp((-3 / dur) * dt); // ~95% there at `duration`
      }
      if (Math.abs(x1) < 0.05 && Math.abs(v1) < 2) {
        x1 = 0;
        v1 = 0;
      }
      p[key] = tgt[key] + x1;
      v[key] = v1;
    }
  }

  // ---------- settings ----------

  function topHostname() {
    try {
      return window.top.location.hostname;
    } catch {
      // Cross-origin frame: the top origin is still readable here.
      const ao = location.ancestorOrigins;
      if (ao && ao.length) {
        try {
          return new URL(ao[ao.length - 1]).hostname;
        } catch {
          // Opaque origin.
        }
      }
      return location.hostname;
    }
  }

  function applySettings() {
    rainbowBase = null;
    applyBlink();
    if (active && caretEl) caretEl.style.background = colorFor(active);
    lastCaret = '';
    evaluate();
  }

  function loadSettings() {
    try {
      ext.storage.local.get(DEFAULTS, (s) => {
        settings = { ...DEFAULTS, ...s };
        applySettings();
      });
      ext.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue ?? DEFAULTS[key];
        applySettings();
      });
    } catch {
      // No extension context (the extension was reloaded under us). Defaults.
      applySettings();
    }
  }

  // ---------- wiring ----------

  // Affinity hints for soft wraps, see fieldTarget().
  addEventListener('keydown', (e) => {
    if (!active) return;
    const mac = /Mac/.test(navigator.platform);
    const end = e.key === 'End' || (mac && e.metaKey && e.key === 'ArrowRight') || (mac && e.ctrlKey && e.key === 'e');
    active.hint = end ? 'end' : null;
  }, true);
  const pointerHint = (e) => {
    if (active && (e.type === 'pointerdown' || e.buttons) && e.composedPath().includes(active.el)) {
      active.hint = { y: e.clientY };
    }
  };
  addEventListener('pointerdown', pointerHint, true);
  addEventListener('pointermove', pointerHint, true);
  addEventListener('focusin', evaluate, true);
  addEventListener('focusout', () => queueMicrotask(evaluate), true);
  addEventListener('focus', (e) => e.target === window && evaluate());
  addEventListener('blur', (e) => e.target === window && setShown(false));
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', () => {
      if (active) active.cache = null;
    });
  }
  loadSettings();

  // In the extension's own popup, popup.js sends changes straight here so the
  // try-it field previews them without waiting on storage. Only listened for
  // on extension pages, so web pages can't send it.
  if (location.protocol === 'chrome-extension:') {
    addEventListener('smoothcaret:preview', (e) => {
      Object.assign(settings, e.detail);
      applySettings();
    });
  }

  if (TEST) {
    globalThis.__smoothCaretDebug = {
      // Where the caret would sit right now for el, in viewport coordinates.
      target(el) {
        ensureBuilt();
        const box = readBox(el);
        const cs = getComputedStyle(el);
        const t = kindOf(el) === 'field'
          ? layoutField(el, cs, fieldText(el, cs), el.selectionStart)
          : editableTarget({ el }, box);
        if (!t || t === SELECTED) return null;
        const toViewport = (c) => ({
          x: box.left + box.sx * (box.cl + c.x - box.sl),
          y: box.top + box.sy * (box.ct + c.y - box.st),
          h: c.h * box.sy,
        });
        return { ...toViewport(t), up: t.up && toViewport(t.up) };
      },
      set(s) {
        Object.assign(settings, s);
        applySettings();
      },
      // Runs one caret jump of `to` px through step() at a fixed frame rate,
      // without the DOM. Returns x after each frame.
      simulate(easing, duration, to, dt = 1 / 60, frames = 60) {
        const saved = { easing: settings.easing, duration: settings.duration };
        Object.assign(settings, { easing, duration });
        const st = { pos: null };
        step(st, { x: 0, y: 0, h: 10 }, 0);
        const xs = [];
        for (let i = 0; i < frames; i++) {
          step(st, { x: to, y: 0, h: 10 }, dt);
          xs.push(st.pos.x);
        }
        Object.assign(settings, saved);
        return xs;
      },
      // Runs one frame of the caret loop now, for tests where rAF is paused.
      tick(now = performance.now()) {
        evaluate();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        frame(now);
      },
      // Stops (or restarts) the frame loop, to see what the browser moves alone.
      pause(on) {
        paused = on;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        if (!on) loop();
      },
      // The drawn caret's rect in viewport coordinates.
      caretRect() {
        return caretEl && caretEl.getBoundingClientRect();
      },
      keepNative(on) {
        keepNative = on;
        if (active) setHide(true);
      },
      get active() {
        return active && active.el;
      },
    };
  }
})();
