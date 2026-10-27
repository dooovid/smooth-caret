// Test-only: keeps a handle on closed shadow roots so checks can look inside
// the caret overlay and the menu. Loaded before the bundle.
window.closedRoots = new WeakMap();
const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  const root = attachShadow.call(this, init);
  closedRoots.set(this, root);
  return root;
};
window.cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => cspViolations.push(`${e.violatedDirective}: ${e.blockedURI || e.sample}`));
