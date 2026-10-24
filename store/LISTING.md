# Chrome Web Store listing

Everything the developer dashboard asks for, tab by tab. Paste the text in the boxes as it is.

## Package

Upload `store/smooth-caret-<version>.zip`, made by `store/package.sh`.

## Store listing tab

**Title** and **summary** come from `extension/manifest.json` and can't be edited in the dashboard:

- Title: `Smooth Caret`
- Summary: `A smooth, gliding text caret on every site, in inputs, textareas and rich editors. Set its speed, easing, width and color.`

**Description**

```text
Smooth Caret replaces the blinking text caret on every website with one that glides. When you type, click or use the arrow keys, the caret slides to its new spot instead of jumping there.

WORKS WHEREVER YOU TYPE
• Search boxes, forms and comment fields
• Textareas, long wrapped text included
• Rich editors: email, chat, notes and writing apps
• Fields inside iframes, shadow DOM and dialogs

MAKE IT YOURS
Open the toolbar popup and try every change live in its test field:
• Glide: how long the caret takes to arrive, from instant to slow and floaty
• Easing: Ease Out, Ease In & Out, Spring or Linear
• Width: 1 to 6 pixels
• Color: any color and opacity, an eyedropper, or Match text to keep each site's own caret color
• Rainbow: cycles through the hues at the speed you pick
• Blink on or off
• Turn it off on one site, or everywhere, with a single switch

STAYS OUT OF THE WAY
• It asks the browser where the real caret is, so it lines up exactly, even with unusual padding, scaled elements, scrolling and wrapped lines.
• Scrolling carries the caret with the text. Only real caret movement glides.
• Where an editor draws its own caret (code editors, Google Docs) it leaves the native caret alone.

PRIVATE
Smooth Caret runs entirely in your browser. It collects nothing and sends nothing: no accounts, no analytics, no network requests. The only thing it stores is your settings. In password fields it measures placeholder dots instead of your password.

Open source: https://github.com/dooovid/smooth-caret
```

**Category:** Functionality & UI (under Make Chrome Yours)

**Language:** English

**Graphic assets** (all in `store/`)

| Field | File |
| --- | --- |
| Store icon (128×128) | `icon-128.png` |
| Screenshots (1280×800, up to 5) | `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`, in that order |
| Small promo tile (440×280) | `promo-small.png` |
| Marquee promo tile (1400×560) | `promo-marquee.png` |
| YouTube video | leave empty |

**Additional fields**

- Official URL: leave as None. It needs a domain verified in Google Search Console.
- Homepage URL: `https://github.com/dooovid/smooth-caret`
- Support URL: `https://github.com/dooovid/smooth-caret/issues`
- Mature content: off

## Privacy tab

**Single purpose description**

```text
Smooth Caret replaces the text caret in web page text fields with a smoothly animated one that glides to each new caret position, with settings for its speed, easing, width and color.
```

**Permission justifications**

storage:

```text
Saves the user's caret settings (on/off, sites they turned it off for, glide time, easing, width, color, blink, rainbow) in chrome.storage.local, so every tab uses them and they survive restarts. Nothing is synced or sent anywhere.
```

activeTab:

```text
When the user opens the toolbar popup, the extension reads the current tab's URL to get its hostname, so the popup can show an "On <site>" switch that turns the caret off for that site. It uses no other tab access.
```

Host permission (the dashboard lists the content script's <all_urls> match here):

```text
The extension draws its caret in whatever text field the user is typing in, so its content script has to run on every site. It runs in all frames, including about:blank and srcdoc frames, because many rich text editors (email composers, CMS and forum editors) put their editable area in an iframe. The script only reads the focused field's text layout and caret position, in memory, to draw the caret on top of it. It makes no network requests and sends no data anywhere.
```

**Are you using remote code?** No, I am not using remote code.

**Data usage**

- What user data do you plan to collect? Tick **none** of the boxes. The extension sends nothing off the device. It does read the focused field's text locally, which is why there's a privacy policy below.
- Tick all three certifications: you don't sell or transfer user data to third parties, you don't use it for anything unrelated to the single purpose, and you don't use it for creditworthiness or lending.

**Privacy policy URL**

```text
https://github.com/dooovid/smooth-caret/blob/main/PRIVACY.md
```

## Distribution tab

- Payments: Free of charge
- Visibility: Public
- Distribution: all regions

## Test instructions tab

```text
No account or setup needed. After installing, click into any text field (for example the search box on google.com, or a comment box), then type, click around and use the arrow keys: the caret glides to each new position instead of jumping. Click the toolbar icon to open the settings popup. It has its own test field at the top, and every change applies live in that field and in every open tab.
```
