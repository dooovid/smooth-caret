// Smooth Caret, page side: runs in the page's own JavaScript world. content.js
// runs in the extension's isolated world, where changes to built-in objects
// aren't visible to the page's scripts.
//
// While you type in an email field, content.js gives it a made-up type so
// Chrome hands out its caret position, and tags it data-smooth-caret-email
// (see "email fields" in content.js). The page's scripts should still see an
// email field, so a tagged field's `type` property says "email". Every other
// input gets the browser's own answer.
(() => {
  'use strict';
  if (globalThis.__smoothCaretPageLoaded) return;
  globalThis.__smoothCaretPageLoaded = true;

  const proto = HTMLInputElement.prototype;
  const type = Object.getOwnPropertyDescriptor(proto, 'type');
  if (!type || !type.get) return;
  const realType = type.get;
  const hasAttribute = Element.prototype.hasAttribute;
  Object.defineProperty(proto, 'type', {
    ...type,
    get() {
      const t = realType.call(this);
      return t === 'text' && hasAttribute.call(this, 'data-smooth-caret-email') ? 'email' : t;
    },
  });
})();
