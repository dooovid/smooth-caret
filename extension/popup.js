// Settings popup: mounts the shared UI (ui.js) on this page. content.js runs
// here too, so the try-it field at the top previews every change live.
const popup = mountSmoothCaretUI(document, {
  load: (defaults, cb) => chrome.storage.local.get(defaults, cb),
  // content.js listens for this on extension pages, ahead of storage.
  preview: (patch) => dispatchEvent(new CustomEvent('smoothcaret:preview', { detail: patch })),
  persist: (patch) => chrome.storage.local.set(patch),
  refocusTarget: () => document.getElementById('try'),
  remember: {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage blocked; it just won't be remembered.
      }
    },
  },
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  let site = null; // content scripts can't run on this tab (chrome:// pages)
  try {
    const u = new URL(tab.url);
    if (u.protocol === 'http:' || u.protocol === 'https:') site = u.hostname;
    else if (u.protocol === 'file:') site = '';
  } catch {
    // No URL access for this tab.
  }
  popup.setSite(site);
});
