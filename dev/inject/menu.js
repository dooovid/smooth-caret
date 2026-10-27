// The injected menu: the extension popup's settings UI (ui.js) in a draggable
// ClickGUI-style window. A lone Right Shift tap opens and closes it, as does
// running the snippet again. Uses UI_TREE and UI_CSS from the build, and the
// store from store.js.
const SVG_NS = 'http://www.w3.org/2000/svg';
const POS_KEY = 'smoothCaret.menuPos';
const MENU_HOST_CSS = [
  'all:initial', 'display:block', 'position:fixed', 'inset:0 auto auto 0', 'width:0', 'height:0',
  'margin:0', 'padding:0', 'border:0', 'background:transparent', 'overflow:visible', 'z-index:2147483647',
].map((d) => d + '!important').join(';');

const clampTo = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));

// The markup arrives as a JSON tree and is built node by node: pages that
// enforce Trusted Types refuse innerHTML from pasted scripts.
function buildTree(node, inSvg) {
  if (typeof node === 'string') return document.createTextNode(node);
  const [tag, attrs, children] = node;
  const svg = inSvg || tag === 'svg';
  const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  for (const child of children) el.append(buildTree(child, svg));
  return el;
}

function remembered(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked; it just won't be remembered.
  }
}

// ---------- window ----------

const menuHost = document.createElement('smooth-caret-menu');
menuHost.setAttribute('popover', 'manual');
menuHost.style.cssText = MENU_HOST_CSS;
const menuShadow = menuHost.attachShadow({ mode: 'closed' });
const menuSheet = new CSSStyleSheet();
menuSheet.replaceSync(UI_CSS);
menuShadow.adoptedStyleSheets = [menuSheet];

const win = document.createElement('div');
win.className = 'window';
const uiEl = buildTree(UI_TREE);
uiEl.classList.add('injected');
win.append(uiEl);
menuShadow.append(win);

const header = uiEl.querySelector('header');
const closeButton = document.createElement('button');
closeButton.className = 'menu_close';
closeButton.setAttribute('aria-label', 'Close');
closeButton.title = 'Close (Right Shift)';
closeButton.textContent = '×';
header.append(closeButton);

document.documentElement.append(menuHost);
// Shown for good; the window inside fades in and out. Being a popover puts it
// in the top layer, above the page's own dialogs.
try {
  menuHost.showPopover();
} catch {
  // No popover support: z-index alone.
}

// ---------- settings UI ----------

// The page's own field last typed in. Clicking the menu's controls hands
// focus back to it, so its caret shows each change live.
let lastField = null;
document.addEventListener('focusin', (e) => {
  let el = e.target;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  if (el === menuHost) return;
  const typable = el.isContentEditable || el.localName === 'textarea'
    || (el.localName === 'input' && typeof el.selectionStart === 'number');
  if (typable) lastField = el;
}, true);

mountSmoothCaretUI(menuShadow, {
  load: chromeShim.storage.local.get,
  preview: previewSettings,
  persist: persistSettings,
  refocusTarget: () => lastField,
  remember: { get: remembered, set: remember },
});

// ---------- open, close, drag ----------

let open = false;

function savedPos() {
  try {
    const [x, y] = JSON.parse(remembered(POS_KEY));
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
  } catch {
    // Nothing saved yet.
  }
  return [innerWidth - uiEl.offsetWidth - 24, 24]; // top right
}

// Keeps the whole window on screen.
function moveTo(x, y) {
  const nx = clampTo(x, 8, innerWidth - uiEl.offsetWidth - 8);
  const ny = clampTo(y, 8, innerHeight - uiEl.offsetHeight - 8);
  win.style.left = `${nx}px`;
  win.style.top = `${ny}px`;
  return [nx, ny];
}

function toggle(force = !open) {
  open = force;
  if (open) {
    // Back on top of anything shown since, dialogs and the caret included.
    try {
      menuHost.hidePopover();
      menuHost.showPopover();
    } catch {
      // No popover support.
    }
    moveTo(...savedPos());
  } else if (menuShadow.activeElement) {
    // Closing with focus inside: hand it back to the page.
    lastField?.focus({ preventScroll: true });
  }
  win.classList.toggle('open', open);
}

closeButton.addEventListener('click', () => toggle(false));
menuShadow.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) toggle(false);
});
addEventListener('resize', () => {
  if (open) moveTo(...savedPos());
});

// Drag by the header, like a ClickGUI panel. The switch and close button in it
// keep their clicks.
header.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('label, button, input')) return;
  e.preventDefault();
  const rect = win.getBoundingClientRect();
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  const done = new AbortController();
  header.setPointerCapture(e.pointerId);
  win.classList.add('dragging');
  header.addEventListener('pointermove', (ev) => {
    moveTo(ev.clientX - dx, ev.clientY - dy);
  }, { signal: done.signal });
  const end = () => {
    done.abort();
    win.classList.remove('dragging');
    const r = win.getBoundingClientRect();
    remember(POS_KEY, JSON.stringify([Math.round(r.left), Math.round(r.top)]));
  };
  header.addEventListener('pointerup', end, { signal: done.signal });
  header.addEventListener('pointercancel', end, { signal: done.signal });
});

// A lone Right Shift tap: pressed and released with nothing else in between,
// so holding it for capitals never opens the menu.
let armed = false;
addEventListener('keydown', (e) => {
  if (e.code !== 'ShiftRight') armed = false;
  else if (!e.repeat) armed = true;
}, true);
addEventListener('keyup', (e) => {
  if (e.code === 'ShiftRight' && armed) toggle();
  armed = false;
}, true);
addEventListener('pointerdown', () => {
  armed = false;
}, true);
addEventListener('blur', () => {
  armed = false;
});

window.__smoothCaretMenu = { toggle };
toggle(true);
console.info('%cSmooth Caret%c injected. Tap Right Shift to show or hide the menu.', 'font-weight:bold;color:#c695ff', '');
