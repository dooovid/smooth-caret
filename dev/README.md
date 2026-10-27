# Development

- `extension/` is the Chrome extension as it ships. There's no build step: load it unpacked, or zip it for the store.
- `smooth-caret.js` is the same caret plus the popup's settings UI and a menu window, as one script for pages an extension can't reach (Electron apps). It's generated from `extension/` and `dev/inject/`, and the latest build is committed, so nobody has to build anything to use it.
- `dev/inject/` holds the menu window, the settings store and `build.mjs`.
- `dev/test/` holds the test pages.
- `dev/store/` holds the Chrome Web Store listing text and images. `dev/package.sh` makes the store zip.

## Rebuilding smooth-caret.js

After changing `extension/` or `dev/inject/`:

```bash
node dev/inject/build.mjs
```

The build turns the popup's markup into a JSON tree that's put together element by element, and loads the styles as constructed stylesheets. So it works on pages whose security policy blocks inline styles and enforces Trusted Types. `dev/test/inject.html` is such a page.

## How it finds the caret

The old [smoothcaret](https://github.com/dooovid/smoothcaret) library measured text with `canvas.measureText` relative to a wrapper it inserted. That breaks with real-world padding and nesting, and it can't do line wrapping. This version asks the browser for absolute positions instead:

- **contenteditable**: `getSelection().getRangeAt(0).getClientRects()` returns the caret's rect in viewport coordinates. Every wrapper, padding, transform and scroll offset is already applied. Empty lines, where Chrome returns no rect, fall back to the neighbouring character or line box. The page's DOM is never modified, since editors like ProseMirror watch it.
- **input / textarea**: their text sits in a closed shadow tree that ranges can't reach. The extension copies only the field's *own* text-layout styles (font, padding, letter-spacing, tab-size, text-transform, `-webkit-text-security` for passwords…) onto a hidden mirror div of the same content width. The browser lays the text out there, which gives the caret's offset inside the field. `field.getBoundingClientRect()` then places it on the page. Ancestor padding and nesting never enter the math. Password fields put placeholder characters in the mirror instead of the password: one per grapheme, padded to the same length, since Chrome draws one dot per grapheme. The dots and every offset come out the same, and the password is never copied.
- **Soft wraps**: the end of one wrapped line and the start of the next share one `selectionStart`. The extension shows the start of the next line, as Chrome does, unless you just pressed End/⌘→ or clicked to the right of the upper line.

The caret animates in the field's unscrolled content coordinates. Scrolling the page or the field moves it rigidly with the text; only real caret movement glides. It's drawn in a closed shadow root that is also a `popover`, so it stays above modal dialogs, and it's clipped to the field and any scrolling ancestors.

The overlay is also CSS-anchored (`position-anchor`) to whatever element has focus, and the caret is drawn relative to it. Chrome scrolls anchored elements together with their anchor, so when the page or a scroll container scrolls, the caret moves in step with the text. It doesn't wait for the script's next frame, which on busy sites made it trail behind and catch up as if eased.

It leaves the native caret alone where it can't, or shouldn't, take over:

- `email` and `number` inputs, which don't expose `selectionStart`.
- Editors that hide the caret to draw their own (CodeMirror, Monaco, Ace).
- Read-only fields.

### Google Docs

Docs paints its document on a canvas and draws its own cursor, `.kix-cursor`, whose `.kix-cursor-caret` is a left border. There's no field to measure, so the extension styles Docs' cursor instead. It gets a CSS transition whose `linear()` timing curve is sampled from the same animation code, so every easing mode and glide time behaves the same as elsewhere. Your width, color, rainbow and blink settings apply too. Only your own cursor is touched: Docs gives it the `docs-text-ui-cursor-blink` class while the document has focus, and the extension tags it with `data-smooth-caret` so the styles stay on while you type and that class is gone. Collaborators' cursors keep their colors. Docs scrolls its editor to follow the cursor, so the transition switches off while it scrolls, and the cursor moves with the text instead of trailing it. If Google renames these classes, nothing matches and Docs' own cursor carries on unchanged.

## Tests

Serve the repo's root:

```bash
python3 -m http.server 8765
```

- `dev/test/index.html` is a torture page: weird padding, wrappers with no field padding, right/center alignment, password, horizontal scroll, `transform: scale`, wrapping textareas with tabs and emoji, a textarea inside a scroller, a closed shadow root, a modal dialog and a rich contenteditable. It runs `content.js` as a page script with `chrome.*` stubbed. Run `runChecks()` in the console. For every caret position in every field, it asks the extension where the caret is, then asks Chrome (`document.caretPositionFromPoint(...).getClientRect()`) which offset is at that point and where Chrome would draw it. Current result: 1,049 positions, 0 mismatches, worst error 0.34px.
- `dev/test/docs.html` mocks Google Docs' cursor markup. Type in it to watch the cursor glide, or run `await runDocsChecks()` to check the transition curve, which cursor gets styled, and the scrolling and off-switch behavior.
- `dev/test/popup.html` previews the popup outside the extension.
- `dev/test/inject.html` runs `smooth-caret.js` on a page with a strict Content-Security-Policy.

## Publishing an update

1. Bump `version` in `extension/manifest.json`. The Chrome Web Store won't take a version it has already seen.
2. If you changed `extension/` or `dev/inject/`, rebuild `smooth-caret.js` (see above).
3. Package it:

   ```bash
   dev/package.sh
   ```

   That writes `dev/store/smooth-caret-<version>.zip`, with `manifest.json` at the root of the zip.
4. In the [developer dashboard](https://chrome.google.com/webstore/devconsole), open Smooth Caret, go to **Package**, click **Upload new package** and pick the zip. Then click **Submit for review**.

The listing text, permission justifications and privacy answers are in `dev/store/LISTING.md`. The store images are rendered from the pages in `dev/store/art/`. The screenshots show the real popup, so if the popup changes, re-render them and upload the new ones on the **Store listing** tab:

```bash
node dev/store/art/render.mjs
```
