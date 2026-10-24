// Settings for the pasted-in build, kept in the page's localStorage since
// there's no extension storage here. chromeShim stands in for the slice of
// chrome.storage that content.js uses; the menu calls previewSettings for
// every change and persistSettings for the throttled saves.
const SETTINGS_KEY = 'smoothCaret.settings';
const settingsListeners = [];

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

const chromeShim = {
  storage: {
    local: { get: (defaults, cb) => cb({ ...defaults, ...readSaved() }) },
    onChanged: { addListener: (fn) => settingsListeners.push(fn) },
  },
};

function previewSettings(patch) {
  const changes = {};
  for (const [key, value] of Object.entries(patch)) changes[key] = { newValue: value };
  for (const fn of settingsListeners) fn(changes, 'local');
}

function persistSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSaved(), ...patch }));
  } catch {
    // Storage blocked: the change lasts until the page reloads.
  }
}
