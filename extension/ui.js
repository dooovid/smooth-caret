// The settings UI: tabs, switches, sliders, the easing dropdown and the color
// picker with rainbow mode. The extension popup (popup.js) and the injectable
// menu (dev/inject/menu.js) both mount it on the markup in popup.html's .ui block.
//
// scope: the Document or ShadowRoot holding that markup.
// env:
//   load(defaults, cb)  reads the saved settings
//   preview(patch)      applies a change right away to the caret on this page
//   persist(patch)      saves changes; called at most every 100ms
//   refocusTarget()     the field to hand focus back to after a control is
//                       clicked, so its caret stays up; or null
//   remember            { get(key), set(key, value) } for small UI state
// Returns { setSite(hostname | '' | null), flush() }.
// eslint-disable-next-line no-unused-vars
function mountSmoothCaretUI(scope, env) {
  const DEFAULTS = {
    enabled: true,
    disabledSites: [],
    colorMode: 'auto',
    color: '#00a6ff',
    duration: 150,
    easing: 'ease-out',
    width: 2,
    blink: true,
    rainbow: false,
    rainbowSpeed: 3,
  };

  const $ = (id) => scope.getElementById(id);
  const ui = scope.querySelector('.ui');
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const mod1 = (n) => ((n % 1) + 1) % 1;

  // How far round the hue wheel the rainbow is right now, 0..1. It runs off the
  // wall clock, so the UI and every caret show the same color at the same
  // moment. content.js has the same formula. Speed 1 is a 10s lap, 10 is 1s.
  const rainbowPhase = (speed, now = Date.now()) => mod1((now / 1000) * (speed / 10));
  let settings = { ...DEFAULTS };
  let site = null; // null hides the per-site switch

  // Changes reach this page's caret at once, but storage (and through it every
  // other tab) at most every 100ms. Writing every frame of a drag fans out to
  // every tab and stalls the browser. The last value always lands: it's written
  // the moment a drag ends, a field commits, or the page goes away.
  let pending = null;
  let timer = 0;
  function save(patch) {
    Object.assign(settings, patch);
    env.preview(patch);
    pending = { ...pending, ...patch };
    if (!timer) timer = setTimeout(flush, 100);
  }

  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (!pending) return;
    env.persist(pending);
    pending = null;
  }
  // On the scope: `change` doesn't leave a shadow root.
  scope.addEventListener('pointerup', flush);
  scope.addEventListener('change', flush);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', flush);

  // ---------- slider ----------

  const FOLLOW = 0.03; // s; how far a dragged fill trails the pointer (higher = floatier)

  // Gradient track whose fill eases after the value (see .slider_inner). A
  // transparent native range input sits on top and does the actual input.
  class Slider {
    constructor(block, onInput) {
      this.range = block.querySelector('input[type="range"]');
      this.num = block.querySelector('input[type="number"]'); // optional
      this.inner = block.querySelector('.slider_inner');
      this.onInput = onInput;
      const { min, max, step } = this.range;
      this.continuous = step === 'any' || (max - min) / (+step || 1) > 20;
      this.p = 0; // value as a fraction of the track
      this.shown = 0; // where the fill is drawn mid-drag
      this.dragging = false;
      this.raf = 0;
      this.range.addEventListener('input', () => this.set(+this.range.value, true));
      this.trackDrags();
      this.num?.addEventListener('input', () => {
        if (this.num.value === '') return;
        this.set(clamp(Math.round(+this.num.value), +this.range.min, +this.range.max), true);
      });
      this.num?.addEventListener('blur', () => {
        this.num.value = this.range.value;
      });
      if (this.num) this.chip(this.num.closest('.value'));
    }

    trackDrags() {
      this.range.addEventListener('pointerdown', (e) => {
        const x0 = e.clientX;
        const done = new AbortController();
        addEventListener('pointermove', (ev) => {
          if (Math.abs(ev.clientX - x0) > 2) this.beginDrag();
        }, { signal: done.signal });
        const end = () => {
          done.abort();
          this.endDrag();
        };
        addEventListener('pointerup', end, { signal: done.signal });
        addEventListener('pointercancel', end, { signal: done.signal });
      });
    }

    // The CSS catch-up ease restarts on every input event. With a few stops
    // (Width) that reads as smooth, but dragging a continuous slider fires one
    // every frame, and the restarts stuttered and fell far behind. So while a
    // continuous slider is dragged (or its number scrubbed), the fill eases
    // after the pointer here instead, worked out once per frame. Letting go
    // hands back to the CSS ease from wherever the fill is.
    beginDrag() {
      if (!this.continuous || this.dragging) return;
      const track = this.inner.parentElement.clientWidth - 4;
      this.shown = clamp(this.inner.getBoundingClientRect().width / track, 0, 1);
      this.dragging = true;
      this.inner.parentElement.classList.add('dragging');
      this.paint(this.shown);
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.follow);
    }

    endDrag() {
      if (!this.dragging) return;
      this.dragging = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.inner.parentElement.classList.remove('dragging');
      this.paint(this.p);
    }

    follow = (now) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.shown += (this.p - this.shown) * (1 - Math.exp(-dt / FOLLOW));
      if (Math.abs(this.p - this.shown) < 0.0005) this.shown = this.p;
      this.paint(this.shown);
      this.raf = requestAnimationFrame(this.follow);
    };

    paint(p) {
      this.inner.style.width = `max(6px, calc((100% - 4px) * ${p}))`;
    }

    // The number beside the label is a chip: click it to type (Enter keeps the
    // value, Escape puts the old one back), or drag it sideways to scrub. A drag
    // never takes focus, so the caret being previewed stays live meanwhile.
    chip(chip) {
      const num = this.num;
      num.addEventListener('focus', () => {
        this.before = this.range.value;
        num.select();
      });
      num.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') num.blur();
        if (e.key === 'Escape') {
          this.set(+this.before, true);
          num.blur();
        }
      });
      chip.addEventListener('pointerdown', (e) => {
        // Already typing: let clicks move the text cursor as usual.
        if (e.button !== 0 || scope.activeElement === num) return;
        e.preventDefault();
        const x0 = e.clientX;
        const v0 = +this.range.value;
        const min = +this.range.min;
        const max = +this.range.max;
        let scrubbing = false;
        const done = new AbortController();
        chip.setPointerCapture(e.pointerId);
        chip.addEventListener('pointermove', (ev) => {
          const dx = ev.clientX - x0;
          if (!scrubbing && Math.abs(dx) < 3) return;
          scrubbing = true;
          chip.classList.add('scrubbing');
          this.beginDrag();
          // The whole range over about 200px of drag.
          this.set(clamp(Math.round(v0 + (dx / 200) * (max - min)), min, max), true);
        }, { signal: done.signal });
        const end = () => {
          done.abort();
          chip.classList.remove('scrubbing');
          this.endDrag();
          if (!scrubbing) num.focus();
        };
        chip.addEventListener('pointerup', end, { signal: done.signal });
        chip.addEventListener('pointercancel', end, { signal: done.signal });
      });
    }

    set(value, emit) {
      this.range.value = value;
      if (this.num && scope.activeElement !== this.num) this.num.value = value;
      this.p = (value - this.range.min) / (this.range.max - this.range.min);
      // Mid-drag, follow() draws the fill.
      if (!this.dragging) this.paint(this.p);
      if (emit) this.onInput(value);
    }
  }

  // ---------- dropdown ----------

  // The chevron turns, the menu grows open, and the chosen label cross-fades.
  class Dropdown {
    constructor(root, onSelect) {
      this.root = root;
      this.button = root.querySelector('.drop_down_main');
      this.label = root.querySelector('.active_choice');
      this.options = [...root.querySelectorAll('[data-option]')];
      this.onSelect = onSelect;
      this.value = null;
      this.open = false;
      this.button.addEventListener('click', () => this.toggle());
      this.button.addEventListener('keydown', (e) => this.key(e));
      for (const o of this.options) {
        o.addEventListener('click', () => {
          this.select(o.dataset.option, true);
          this.toggle(false);
        });
      }
      // A click anywhere else closes it. From outside a shadow root the click's
      // path stops at the host, so the page side is checked separately.
      scope.addEventListener('pointerdown', (e) => {
        if (!e.composedPath().includes(root)) this.toggle(false);
      });
      if (scope.host) {
        document.addEventListener('pointerdown', (e) => {
          if (e.target !== scope.host) this.toggle(false);
        });
      }
    }

    toggle(open = !this.open) {
      this.open = open;
      this.root.dataset.open = open;
      this.button.setAttribute('aria-expanded', open);
      this.highlight(open ? this.index(this.value) : -1);
    }

    index(value) {
      return this.options.findIndex((o) => o.dataset.option === value);
    }

    highlight(i) {
      this.active = i;
      this.options.forEach((o, j) => o.classList.toggle('active', j === i));
    }

    key(e) {
      if (e.key === 'Escape' && this.open) {
        e.preventDefault();
        e.stopPropagation();
        this.toggle(false);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.open) return this.toggle(true);
        this.highlight(clamp(this.active + (e.key === 'ArrowDown' ? 1 : -1), 0, this.options.length - 1));
      } else if ((e.key === 'Enter' || e.key === ' ') && this.open) {
        e.preventDefault();
        this.select(this.options[this.active].dataset.option, true);
        this.toggle(false);
      }
    }

    select(value, emit) {
      if (value === this.value) return;
      const first = this.value === null;
      this.value = value;
      for (const o of this.options) o.setAttribute('aria-selected', o.dataset.option === value);
      const text = this.options[this.index(value)].textContent;
      if (first) {
        this.label.textContent = text;
      } else {
        this.label.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' }).onfinish = () => {
          this.label.textContent = text;
          this.label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'forwards' });
        };
      }
      if (emit) this.onSelect(value);
    }
  }

  // ---------- color picker ----------

  const M = 10; // canvas margin, so a handle can sit right on the edge
  const CHASE = 24; // how fast handles catch the pointer, 1/s

  function hsvToRgb(h, s, v) {
    const f = (n) => {
      const k = (n + h * 6) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
  }

  function rgbToHsv(r, g, b) {
    [r, g, b] = [r / 255, g / 255, b / 255];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return [h / 6, max ? d / max : 0, max];
  }

  // Any CSS color to [r, g, b, a], by letting canvas normalize it.
  const parser = document.createElement('canvas').getContext('2d');
  function parseColor(css) {
    parser.fillStyle = '#000';
    parser.fillStyle = css;
    const out = parser.fillStyle;
    if (out[0] === '#') return [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16)).concat(1);
    const [r, g, b, a = 1] = out.match(/[\d.]+/g).map(Number);
    return [r, g, b, a];
  }

  const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');

  function setupCanvas(canvas) {
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, w, h };
  }

  function drawHandle(ctx, x, y, fill) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.shadowColor = 'rgba(0, 0, 0, .4)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  // Saturation/brightness field plus hue and opacity sliders. Handles chase the
  // pointer instead of jumping to it, and the color is read from where the
  // handles are, so the color glides along with them.
  //
  // In rainbow mode the hue handle runs round on its own. `to.h` then holds the
  // base hue that gets saved, and the hue on screen is that plus rainbowPhase().
  class ColorPicker {
    constructor(onColor) {
      this.field = setupCanvas($('color_field'));
      this.hue = setupCanvas($('color_slider'));
      this.alpha = setupCanvas($('opacity_slider'));
      this.bar = $('color_picker_bar');
      this.hex = $('color_input');
      this.onColor = onColor;
      this.at = { h: 0, s: 1, v: 1, a: 1 }; // where the handles are drawn, 0..1
      this.to = { ...this.at }; // where they're headed
      this.raf = 0;
      this.last = 0;
      this.lastCss = '';
      this.rainbow = false;
      this.speed = DEFAULTS.rainbowSpeed;
      this.checker = this.makeChecker();

      this.drag(this.field, (x, y) => {
        this.to.s = x;
        this.to.v = 1 - y;
      });
      this.drag(this.hue, (x) => {
        // Mid-rainbow, grabbing the hue sets where the cycle is, and it carries
        // on from wherever you let go.
        this.to.h = this.rainbow ? mod1(x - rainbowPhase(this.speed)) : x;
      });
      this.drag(this.alpha, (x) => {
        this.to.a = x;
      });
      this.keys(this.field, { ArrowLeft: ['s', -1], ArrowRight: ['s', 1], ArrowUp: ['v', 1], ArrowDown: ['v', -1] });
      this.keys(this.hue, { ArrowLeft: ['h', -1], ArrowRight: ['h', 1] });
      this.keys(this.alpha, { ArrowLeft: ['a', -1], ArrowRight: ['a', 1] });

      this.hex.addEventListener('input', () => {
        const v = this.hex.value.trim();
        const ok = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
        this.hex.classList.toggle('bad', !ok);
        if (ok) this.setColor(v[0] === '#' ? v : '#' + v, false);
      });
      this.hex.addEventListener('focus', () => this.hex.select());
      this.hex.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.hex.blur();
      });
      this.hex.addEventListener('blur', () => {
        this.hex.classList.remove('bad');
        this.hex.value = this.hexText();
      });
    }

    makeChecker() {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 8;
      const t = tile.getContext('2d');
      t.fillStyle = '#c8c8c8';
      t.fillRect(0, 0, 8, 8);
      t.fillStyle = '#9e9e9e';
      t.fillRect(0, 0, 4, 4);
      t.fillRect(4, 4, 4, 4);
      return this.alpha.ctx.createPattern(tile, 'repeat');
    }

    drag(surface, apply) {
      const el = surface.canvas;
      const move = (e) => {
        const r = el.getBoundingClientRect();
        apply(clamp((e.clientX - r.left - M) / (r.width - 2 * M), 0, 1), clamp((e.clientY - r.top - M) / (r.height - 2 * M), 0, 1));
        this.touch();
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // Keep focus (and the caret) in the field being previewed, so the new
        // color shows on the live caret while you drag.
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        move(e);
      });
      el.addEventListener('pointermove', (e) => {
        if (el.hasPointerCapture(e.pointerId)) move(e);
      });
      const release = (e) => {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    }

    keys(surface, map) {
      surface.canvas.addEventListener('keydown', (e) => {
        const hit = map[e.key];
        if (!hit) return;
        e.preventDefault();
        const [key, dir] = hit;
        const next = this.to[key] + dir * (e.shiftKey ? 0.1 : 0.01);
        this.to[key] = key === 'h' && this.rainbow ? mod1(next) : clamp(next, 0, 1);
        this.touch();
      });
    }

    // The user changed something: the color is theirs from here on.
    touch() {
      this.live = true;
      this.kick();
    }

    // The saved settings, applied with no animation when the UI opens.
    load(css, rainbow, speed) {
      this.rainbow = rainbow;
      this.speed = speed;
      this.setColor(css, true);
      if (rainbow) this.kick();
    }

    // Start or stop cycling, and return the base color to save with the flag.
    // Starting moves the base hue back by the current offset and stopping keeps
    // the hue on screen, so the color never jumps either way.
    setRainbow(on) {
      if (on !== this.rainbow) {
        // Stopping uses the hue at this instant rather than the last frame's.
        this.to.h = on ? mod1(this.at.h - rainbowPhase(this.speed)) : mod1(this.to.h + rainbowPhase(this.speed));
        this.rainbow = on;
        // A grey or near-black rainbow wouldn't show; slide to full color.
        if (on && (this.to.s < 0.25 || this.to.v < 0.35)) {
          this.to.s = 1;
          this.to.v = 1;
          this.live = true;
        }
        this.kick();
      }
      this.lastCss = this.css(this.to.h);
      return this.lastCss;
    }

    // Change the lap time without the color on screen jumping. Returns the new
    // base color to save.
    setSpeed(speed) {
      if (this.rainbow) {
        // Re-anchor from the hue at this exact instant. The last frame's hue
        // would drop the time since that frame on every slider event, and a drag
        // fires several per frame, which stalled the cycle.
        const now = Date.now();
        const hue = mod1(this.to.h + rainbowPhase(this.speed, now));
        this.to.h = mod1(hue - rainbowPhase(speed, now));
      }
      this.speed = speed;
      this.lastCss = this.css(this.to.h);
      return this.lastCss;
    }

    // Glide the handles to a color that's been saved already, without writing
    // every step of the glide.
    glideTo(css) {
      this.setColor(css, false);
      this.live = false;
    }

    // Jump straight to a color (instant) or glide the handles there.
    setColor(css, instant) {
      const [r, g, b, a] = parseColor(css);
      let [h, s, v] = rgbToHsv(r, g, b);
      // Greys have no hue; keep the hue slider where it was.
      if (!s) h = this.to.h;
      // A typed color mid-rainbow should show as typed, right now.
      else if (this.rainbow && !instant) h = mod1(h - rainbowPhase(this.speed));
      Object.assign(this.to, { h, s, v, a });
      if (instant) {
        Object.assign(this.at, this.to);
        this.draw();
        this.lastCss = this.css();
        this.paintReadout();
      } else {
        this.touch();
      }
    }

    kick() {
      if (this.raf) return;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    frame = (now) => {
      this.raf = 0;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const k = 1 - Math.exp(-CHASE * dt);
      let moving = false;
      if (this.rainbow) this.at.h = mod1(this.to.h + rainbowPhase(this.speed));
      for (const key of this.rainbow ? ['s', 'v', 'a'] : ['h', 's', 'v', 'a']) {
        const d = this.to[key] - this.at[key];
        if (Math.abs(d) > 0.0005) {
          this.at[key] += d * k;
          moving = true;
        } else {
          this.at[key] = this.to[key];
        }
      }
      this.draw();
      this.emit();
      if (this.rainbow) this.onHue?.(this.at.h);
      if (moving || this.rainbow) this.raf = requestAnimationFrame(this.frame);
    };

    rgb(h = this.at.h) {
      return hsvToRgb(h, this.at.s, this.at.v);
    }

    css(h = this.at.h) {
      const [r, g, b] = this.rgb(h);
      const a = Math.round(this.at.a * 100) / 100;
      return a >= 1 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    hexText() {
      const [r, g, b] = this.rgb();
      const a = Math.round(this.at.a * 255);
      return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 255 ? hex2(a) : ''}`;
    }

    paintReadout() {
      this.bar.style.setProperty('--color', this.css());
      if (scope.activeElement !== this.hex) this.hex.value = this.hexText();
    }

    emit() {
      this.paintReadout();
      // Mid-rainbow the saved color keeps its base hue; every caret adds the
      // same clock-driven offset itself, so nothing is written as the hue turns.
      const css = this.css(this.rainbow ? this.to.h : this.at.h);
      if (css === this.lastCss) return;
      this.lastCss = css;
      if (this.live) this.onColor(css);
    }

    draw() {
      const { h, s, v, a } = this.at;
      const [r, g, b] = this.rgb();
      const pure = `rgb(${hsvToRgb(h, 1, 1).join()})`;

      {
        const { ctx, w, h: H } = this.field;
        const iw = w - 2 * M;
        const ih = H - 2 * M;
        ctx.clearRect(0, 0, w, H);
        ctx.beginPath();
        ctx.roundRect(M, M, iw, ih, 8);
        let grad = ctx.createLinearGradient(M, 0, M + iw, 0);
        grad.addColorStop(0, '#fff');
        grad.addColorStop(1, pure);
        ctx.fillStyle = grad;
        ctx.fill();
        grad = ctx.createLinearGradient(0, M + ih, 0, M);
        grad.addColorStop(0, '#000');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fill();
        drawHandle(ctx, M + s * iw, M + (1 - v) * ih, `rgb(${r}, ${g}, ${b})`);
      }

      {
        const { ctx, w, h: H } = this.hue;
        const iw = w - 2 * M;
        ctx.clearRect(0, 0, w, H);
        const grad = ctx.createLinearGradient(M, 0, M + iw, 0);
        ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach((c, i) => grad.addColorStop(i / 6, c));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(M, 0, iw, H, H / 2);
        ctx.fill();
        drawHandle(ctx, M + h * iw, H / 2, pure);
      }

      {
        const { ctx, w, h: H } = this.alpha;
        const iw = w - 2 * M;
        ctx.clearRect(0, 0, w, H);
        ctx.beginPath();
        ctx.roundRect(M, 0, iw, H, H / 2);
        ctx.fillStyle = this.checker;
        ctx.fill();
        const grad = ctx.createLinearGradient(M, 0, M + iw, 0);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(1, `rgb(${r}, ${g}, ${b})`);
        ctx.fillStyle = grad;
        ctx.fill();
        drawHandle(ctx, M + a * iw, H / 2, `rgba(${r}, ${g}, ${b}, ${a})`);
      }
    }
  }

  // ---------- wiring ----------

  const duration = new Slider($('duration'), (v) => save({ duration: v }));
  const width = new Slider($('width'), (v) => save({ width: v }));
  const easing = new Dropdown($('easing'), (v) => save({ easing: v }));
  const rainbowSpeed = new Slider($('rainbow_speed'), (v) => {
    save({ rainbowSpeed: v, color: picker.setSpeed(v) });
    renderColor();
  });
  // Touching the picker always means a custom color, even under Match text.
  const picker = new ColorPicker((css) => {
    if (settings.colorMode === 'custom') save({ color: css });
    else setMode('custom');
  });

  // Match text and the custom color are the two modes. The rainbow belongs to
  // the custom one: Match text pauses it, and it picks up again after.
  function setMode(mode, patch = {}) {
    Object.assign(settings, patch);
    const color = picker.setRainbow(mode === 'custom' && settings.rainbow);
    save({ ...patch, colorMode: mode, color });
    renderColor();
  }

  function renderColor() {
    const auto = settings.colorMode === 'auto';
    $('match').checked = auto;
    $('rainbow').checked = settings.rainbow;
    ui.classList.toggle('match', auto);
    // The rainbow visuals show it running, not just switched on.
    ui.classList.toggle('rainbow', settings.rainbow && !auto);
  }

  // The Rainbow label and switch track scroll with the hue the picker is
  // showing, which is the caret's hue too. The hue never jumps, even when the
  // speed changes, so neither do they.
  picker.onHue = (h) => {
    ui.style.setProperty('--rainbow-shift', `${(-h * 120).toFixed(2)}px`);
    $('rainbow_fill').setAttribute('gradientTransform', `translate(${(-h * 35).toFixed(3)} 0)`);
  };

  // Chrome's own screen color picker. The pick is saved the moment it arrives,
  // since clicking outside can be what closes an extension popup.
  if ('EyeDropper' in window) {
    const button = $('eyedropper');
    button.hidden = false;
    button.addEventListener('click', async () => {
      button.classList.add('picking');
      try {
        // eslint-disable-next-line no-undef
        const { sRGBHex } = await new EyeDropper().open();
        picker.setRainbow(false);
        save({ color: sRGBHex, colorMode: 'custom', rainbow: false });
        flush();
        picker.glideTo(sRGBHex);
        renderColor();
      } catch {
        // Cancelled with Escape.
      } finally {
        button.classList.remove('picking');
      }
    });
  }

  function renderSite() {
    $('site_row').hidden = site === null;
    if (site === null) return;
    const name = site.replace(/^www\./, '') || 'local files';
    $('site_name').textContent = name;
    $('site_row').title = name;
    $('site').checked = !settings.disabledSites.includes(site);
  }

  // ---------- tabs ----------

  // The tab you were on last time comes back next time.
  function setTab(name, remember) {
    ui.dataset.tab = name;
    for (const t of scope.querySelectorAll('.tab')) t.setAttribute('aria-selected', t.dataset.tab === name);
    for (const p of scope.querySelectorAll('.panel')) p.inert = p.id !== `panel_${name}`;
    if (remember) env.remember.set('smoothCaret.tab', name);
  }

  for (const t of scope.querySelectorAll('.tab')) t.addEventListener('click', () => setTab(t.dataset.tab, true));
  setTab(env.remember.get('smoothCaret.tab') === 'color' ? 'color' : 'motion', false);

  function render() {
    $('enabled').checked = settings.enabled;
    ui.classList.toggle('off', !settings.enabled);
    renderSite();
    $('blink').checked = settings.blink;
    duration.set(settings.duration, false);
    width.set(settings.width, false);
    easing.select(settings.easing, false);
    rainbowSpeed.set(settings.rainbowSpeed, false);
    picker.load(settings.color, settings.rainbow && settings.colorMode === 'custom', settings.rainbowSpeed);
    renderColor();
  }

  $('enabled').onchange = (e) => {
    save({ enabled: e.target.checked });
    ui.classList.toggle('off', !e.target.checked);
  };
  $('site').onchange = (e) => {
    const list = settings.disabledSites.filter((h) => h !== site);
    if (!e.target.checked) list.push(site);
    save({ disabledSites: list });
  };
  $('blink').onchange = (e) => save({ blink: e.target.checked });
  $('match').onchange = (e) => setMode(e.target.checked ? 'auto' : 'custom');
  $('rainbow').onchange = (e) => setMode('custom', { rainbow: e.target.checked });

  // ---------- focus ----------

  // Clicking a switch, slider or the menu hands focus back to the field being
  // previewed, so its caret stays up while you tweak. Fields you type into keep
  // focus. A rich editor gets its cursor position back too.
  const deepActive = () => {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };
  let refocus = null;
  scope.addEventListener('pointerdown', (e) => {
    refocus = null;
    const target = env.refocusTarget();
    const active = deepActive();
    if (!target || !(target === active || target.contains(active))) return;
    if (e.composedPath().some((n) => n.matches?.('#try, .value, #color_input'))) return;
    const sel = getSelection();
    const range = target.isContentEditable && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    refocus = { target, range };
  }, true);
  scope.addEventListener('pointerup', () => {
    const r = refocus;
    refocus = null;
    if (!r) return;
    requestAnimationFrame(() => {
      r.target.focus({ preventScroll: true });
      if (r.range) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r.range);
      }
    });
  }, true);

  env.load(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => ui.classList.remove('opening')));
  });

  return {
    setSite(hostname) {
      site = hostname;
      renderSite();
    },
    flush,
  };
}
