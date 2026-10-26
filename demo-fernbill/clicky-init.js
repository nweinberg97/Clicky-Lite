/* Starts Clicky Lite for the demo from the embedded pack (demo/clicky-pack.js), so nothing
   is fetched at run time. A normal install uses the one-line data-clicky-pack script tag;
   this form is for hosts that sandbox the page (opaque origin, strict CSP). */
(function () {
  'use strict';
  var api = window.ClickyLite;
  if (!api) return;
  var pack = window.FERNBILL_CLICKY_PACK || 'clicky-pack.json';
  function syncPlaces() {
    try { api.setPlaces(typeof window.fernbillPlaces === 'function' ? window.fernbillPlaces() : []); } catch (e) { /* finder just knows less */ }
  }
  api.init({ pack: pack, accent: '#3D5AFE' }).then(syncPlaces, function (err) {
    console.warn('[Clicky Lite demo]', err && err.message ? err.message : err);
  });
  syncPlaces();
  window.addEventListener('fernbill:change', syncPlaces);
})();
