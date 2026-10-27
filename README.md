# Smooth Caret for Chrome

[smoothcaret](https://github.com/dooovid/smoothcaret), but on every text field on every site: inputs, textareas and rich editors (Gmail, Notion, ChatGPT, Discord, X…), with no markup changes.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension/` folder.
3. Pin it from the puzzle-piece menu. The popup has a field to try it in, plus on/off, per-site and blink switches, glide duration, animation type (Ease Out, Ease In & Out, Spring, Linear), caret width, and a color picker with opacity, or "Match text" to use each site's own caret color. **Rainbow** cycles the hue at a chosen speed, keeping the picker's saturation, brightness and opacity. It runs off the clock, so every tab's caret and the popup show the same color at the same moment. Changes apply live in every tab. The popup's look, its components and the logo come from [SmoothCursorExtension](https://github.com/dooovid/SmoothCursorExtension) and [Silk-Type](https://github.com/dooovid/Silk-Type).

To use it on `file://` pages, also turn on **Allow access to file URLs** on the extension's details page.

## Pasting it into an app (Claude desktop and other Electron apps)

`dist/smooth-caret-inject.js` is the caret plus the popup's settings UI in one script, for pages an extension can't reach. Run it from the app's DevTools and the caret starts right away. A draggable menu opens. Tap **Right Shift** on its own to hide or show the menu; holding it to type capitals does nothing. Running the script again just reopens the menu. Settings and the menu's position are saved in that page's `localStorage`, so they survive restarts. The script itself has to be run again after each launch or reload.

For the Claude desktop app:

1. Turn on its DevTools: `echo '{"allowDevTools": true}' > ~/Library/Application\ Support/Claude/developer_settings.json`, then quit Claude (⌘Q) and reopen it.
2. Click into the Claude window and press ⌘⌥I (the menu item is **Show Dev Tools**; right-click → **Inspect Element** works too). If neither shows up, your organization may have turned developer mode off for its workspace, and DevTools stay locked.
3. Sources → Snippets → **New snippet**, paste the whole of `dist/smooth-caret-inject.js`, and save with ⌘S.
4. Run it with ⌘Enter. Later, open the command menu (⌘P) and type `!` followed by the snippet's name.

It's built from the extension's own files, so the two stay the same. After changing `extension/` or `inject/`, rebuild:

```bash
node inject/build.mjs
```

The build turns the popup's markup into a JSON tree that's put together element by element, and loads the styles as constructed stylesheets. So it works on pages whose security policy blocks inline styles and enforces Trusted Types. `test/inject.html` is such a page.

## How it finds the caret

The old library measured text with `canvas.measureText` relative to a wrapper it inserted. That breaks with real-world padding and nesting, and it can't do line wrapping. This version asks the browser for absolute positions instead:

- **contenteditable**: `getSelection().getRangeAt(0).getClientRects()` returns the caret's rect in viewport coordinates. Every wrapper, padding, transform and scroll offset is already applied. Empty lines, where Chrome returns no rect, fall back to the neighbouring character or line box. The page's DOM is never modified, since editors like ProseMirror watch it.
- **input / textarea**: their text sits in a closed shadow tree that ranges can't reach. The extension copies only the field's *own* text-layout styles (font, padding, letter-spacing, tab-size, text-transform, `-webkit-text-security` for passwords…) onto a hidden mirror div of the same content width. The browser lays the text out there, which gives the caret's offset inside the field. `field.getBoundingClientRect()` then places it on the page. Ancestor padding and nesting never enter the math. Password fields put placeholder characters in the mirror instead of the password: one per grapheme, padded to the same length, since Chrome draws one dot per grapheme. The dots and every offset come out the same, and the password is never copied.
- **Soft wraps**: the end of one wrapped line and the start of the next share one `selectionStart`. The extension shows the start of the next line, as Chrome does, unless you just pressed End/⌘→ or clicked to the right of the upper line.

The caret animates in the field's unscrolled content coordinates. Scrolling the page or the field moves it rigidly with the text; only real caret movement glides. It's drawn in a closed shadow root that is also a `popover`, so it stays above modal dialogs, and it's clipped to the field and any scrolling ancestors.

The overlay is also CSS-anchored (`position-anchor`) to whatever element has focus, and the caret is drawn relative to it. Chrome scrolls anchored elements together with their anchor, so when the page or a scroll container scrolls, the caret moves in step with the text. It doesn't wait for the script's next frame, which on busy sites made it trail behind and catch up as if eased.

It leaves the native caret alone where it can't, or shouldn't, take over:

- `email` and `number` inputs, which don't expose `selectionStart`.
- Editors that hide the caret to draw their own (CodeMirror, Monaco, Ace).

### Google Docs

Docs paints its document on a canvas and draws its own cursor, `.kix-cursor`, whose `.kix-cursor-caret` is a left border. There's no field to measure, so the extension styles Docs' cursor instead. It gets a CSS transition whose `linear()` timing curve is sampled from the same animation code, so every easing mode and glide time behaves the same as elsewhere. Your width, color, rainbow and blink settings apply too. Only your own cursor is touched: Docs gives it the `docs-text-ui-cursor-blink` class while the document has focus, and the extension tags it with `data-smooth-caret` so the styles stay on while you type and that class is gone. Collaborators' cursors keep their colors. Docs scrolls its editor to follow the cursor, so the transition switches off while it scrolls, and the cursor moves with the text instead of trailing it. If Google renames these classes, nothing matches and Docs' own cursor carries on unchanged.
- Read-only fields.

## Accuracy test

`test/index.html` is a torture page: weird padding, wrappers with no field padding, right/center alignment, password, horizontal scroll, `transform: scale`, wrapping textareas with tabs and emoji, a textarea inside a scroller, a closed shadow root, a modal dialog and a rich contenteditable. It runs `content.js` as a page script with `chrome.*` stubbed.

Serve the folder and open it:

```bash
python3 -m http.server 8765
```

Then run `runChecks()` in the console. For every caret position in every field, it asks the extension where the caret is, then asks Chrome (`document.caretPositionFromPoint(...).getClientRect()`) which offset is at that point and where Chrome would draw it. Current result: 1,049 positions, 0 mismatches, worst error 0.34px.

`test/popup.html` previews the popup outside the extension. `test/inject.html` runs the pasted-in build on a page with a strict Content-Security-Policy. `test/docs.html` mocks Google Docs' cursor markup; type in it to watch the cursor glide, or run `await runDocsChecks()` to check the transition curve, which cursor gets styled, and the scrolling and off-switch behavior.

## Publishing an update

1. Bump `version` in `extension/manifest.json`. The Chrome Web Store won't take a version it has already seen.
2. If you changed `extension/` or `inject/`, run `node inject/build.mjs` so `dist/` matches.
3. Package it:

   ```bash
   store/package.sh
   ```

   That writes `store/smooth-caret-<version>.zip`, with `manifest.json` at the root of the zip.
4. In the [developer dashboard](https://chrome.google.com/webstore/devconsole), open Smooth Caret, go to **Package**, click **Upload new package** and pick the zip. Then click **Submit for review**.

The listing text, permission justifications and privacy answers are in `store/LISTING.md`. The store images are rendered from the pages in `store/art/`. The screenshots show the real popup, so if the popup changes, re-render them and upload the new ones on the **Store listing** tab:

```bash
node store/art/render.mjs
```

## Privacy

Smooth Caret runs entirely in the browser. It sends nothing anywhere and stores only its own settings. See [PRIVACY.md](PRIVACY.md).

## License

[GPL-3.0](LICENSE)
