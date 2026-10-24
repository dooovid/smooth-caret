# Smooth Caret privacy policy

*Last updated: October 23, 2026*

Smooth Caret is a Chrome extension that draws a smooth, gliding caret in the text field you're typing in. It works entirely inside your browser.

## What it reads

To draw its caret exactly where the real one is, the extension reads, while a field has focus:

- the field's text and styles, so it can lay the text out the same way and measure where the caret sits. In password fields it lays out placeholder characters of the same length instead, so your password never goes into its measuring copy and is never kept;
- the caret's position, plus your clicks and End/arrow key presses inside that field, to know which side of a line wrap the caret belongs on;
- the site's hostname, to check whether you've turned the extension off there.

All of this stays in memory on your device, is used only to draw the caret, and is gone as soon as the caret moves on. None of it is saved.

## What it stores

Only its own settings: on or off, the sites you turned it off for, glide time, easing, width, color, blink and rainbow. They're kept in `chrome.storage.local` on your device and aren't synced. The settings popup also remembers which of its tabs you last had open. Removing the extension deletes all of it.

## What it sends

Nothing. Smooth Caret makes no network requests, loads no remote code and has no analytics, ads, accounts or third-party services. It doesn't collect, sell or share any data.

## Permissions

- **storage**: saves the settings above.
- **activeTab**: when you open the popup, reads the current tab's address so the popup can offer a switch for that site.
- **Runs on all sites**: draws the caret in whatever field you type in, on any page.

## Changes and contact

If this policy changes, the new version will be posted here with a new date. The source code is public at [github.com/dooovid/smooth-caret](https://github.com/dooovid/smooth-caret). For questions, [open an issue](https://github.com/dooovid/smooth-caret/issues).
