/* Starts Clicky Lite in Sedi from the embedded pack (clicky-pack.js), so nothing is fetched at
   run time. A normal install is the one-line data-clicky-pack script tag; this form is for hosts
   that sandbox the page (opaque origin, strict CSP). */
(function () {
  'use strict';
  var api = window.ClickyLite;
  if (!api) return;
  api.init({ pack: window.CLICKY_DEMO_PACK || 'clicky-pack.json', accent: '#2F6FEA', panelPosition: 'top-right' })
    .catch(function (err) { console.warn('[Clicky Lite demo]', err && err.message ? err.message : err); });
})();
