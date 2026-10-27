// Shared by the store image pages. Runs after extension/content.js in test
// mode, so the easing curves are the real caret's (see frames()).

// The caret at offset k of el's [data-text] text node, relative to el.
function caretAt(el, k) {
  const text = el.querySelector('[data-text]').firstChild;
  const r = document.createRange();
  const end = k >= text.length;
  r.setStart(text, end ? k - 1 : k);
  r.setEnd(text, end ? k : k + 1);
  const c = r.getClientRects()[0];
  const box = el.getBoundingClientRect();
  return { x: (end ? c.right : c.left) - box.left, y: c.top - box.top, h: c.height };
}

function bar(el, cls, x, y, w, h, background, opacity) {
  const b = document.createElement('i');
  b.className = cls;
  Object.assign(b.style, {
    left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, background, opacity,
  });
  el.append(b);
}

// Draws the caret arriving at offset `to` in el after gliding from `from`: a
// blurred wedge tapering away behind it, three fading carets like the logo's
// bars, and the caret itself. `color` is a CSS color, or a function of
// progress along the trail (0..1) that returns one, for rainbow trails.
function glide(el, from, to, { color = '#c695ff', width = 3, inset = 0.08, tail = 150, glow = 0.55 } = {}) {
  const a = caretAt(el, from);
  const b = caretAt(el, to);
  const dir = Math.sign(b.x - a.x);
  const y = b.y + b.h * inset;
  const h = b.h * (1 - 2 * inset);
  const paint = (t) => (typeof color === 'function' ? color(t) : color);

  const len = Math.min(Math.abs(b.x - a.x), tail);
  const stops = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6;
    return `color-mix(in srgb, ${paint(t)} ${Math.round(70 * t ** 1.6)}%, transparent) ${t * 100}%`;
  });
  bar(el, 'streak', dir > 0 ? b.x - len : b.x, y, len, h, `linear-gradient(${dir > 0 ? 90 : 270}deg, ${stops})`, glow);
  [0.2, 0.5, 0.8].forEach((opacity, i) => {
    const back = (3 - i) * width * 2.6;
    bar(el, 'ghost', b.x - dir * back - width / 2, y, width, h, paint(1 - (3 - i) * 0.22), opacity);
  });
  bar(el, 'caret', b.x - width / 2, y, width, h, paint(1), 1);
}

// Positions over time of a caret jumping `to` px with the extension's own
// easing (content.js step(), run in test mode), one per 60fps frame.
function frames(easing, duration, to, count) {
  return [0, ...__smoothCaretDebug.simulate(easing, duration, to, 1 / 60, count)];
}

// Keeps a .popup the height of the popup inside it, scaled, and centered
// vertically in a stage `stageHeight` tall.
function fitPopup(wrap, scale, stageHeight) {
  const frame = wrap.querySelector('iframe');
  frame.addEventListener('load', () => {
    const ui = frame.contentDocument.querySelector('.ui');
    new ResizeObserver(() => {
      wrap.style.height = `${ui.offsetHeight}px`;
      wrap.style.top = `${Math.round((stageHeight - ui.offsetHeight * scale) / 2)}px`;
    }).observe(ui);
  });
  wrap.style.transform = `scale(${scale})`;
}
