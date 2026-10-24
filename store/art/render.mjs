// Renders the Chrome Web Store images into store/ from the pages in this folder,
// with headless Chrome driven over the DevTools protocol. The popup in the
// screenshots is the real extension/popup.html, so re-run this after changing
// the popup.
//
//   node store/art/render.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGES = [
  ['screenshot-1.html', 1280, 800, 'screenshot-1.png'],
  ['screenshot-2.html', 1280, 800, 'screenshot-2.png'],
  ['screenshot-3.html', 1280, 800, 'screenshot-3.png'],
  ['promo-small.html', 440, 280, 'promo-small.png'],
  ['promo-marquee.html', 1400, 560, 'promo-marquee.png'],
  ['icon.html', 128, 128, 'icon-128.png'],
];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const here = fileURLToPath(new URL('.', import.meta.url));
const only = process.argv.slice(2);

const profile = mkdtempSync(join(tmpdir(), 'smooth-caret-art-'));
const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, '--allow-file-access-from-files',
  '--remote-debugging-port=0', 'about:blank',
], { stdio: 'ignore' });

try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 100));
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const [page] = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const w of waiters.splice(0)) w(msg);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const loaded = () => new Promise((resolve) => {
    const check = (msg) => (msg.method === 'Page.loadEventFired' ? resolve() : waiters.push(check));
    waiters.push(check);
  });

  await send('Page.enable');
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [file, width, height, out] of IMAGES) {
    if (only.length && !only.includes(out)) continue;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const done = loaded();
    await send('Page.navigate', { url: new URL(file, `file://${here}`).href });
    await done;
    // Let the popup's opening transitions and the slider fills settle.
    await new Promise((r) => setTimeout(r, 1500));
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    writeFileSync(join(here, '..', out), Buffer.from(data, 'base64'));
    console.log(`store/${out}`);
  }
  await send('Browser.close').catch(() => {});
} finally {
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
