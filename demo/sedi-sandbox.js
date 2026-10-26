/* Clicky Lite demo: tells Sedi it's running as a sandboxed preview (its own data, runs inside a frame). */
window.SEDI_SANDBOX = true;
/* Sandboxed frames refuse storage checks outright (sometimes by throwing before a promise exists).
   Make them answer "unknown" quietly so the demo's console stays clean. */
(function () {
  try {
    var st = navigator.storage;
    if (!st) return;
    ['estimate', 'persist', 'persisted'].forEach(function (k) {
      var f = st[k];
      if (typeof f !== 'function') return;
      var fallback = k === 'estimate' ? { quota: 0, usage: 0 } : false;
      st[k] = function () {
        try { return Promise.resolve(f.apply(st, arguments)).catch(function () { return fallback; }); }
        catch (e) { return Promise.resolve(fallback); }
      };
    });
  } catch (e) { /* nothing to do */ }
})();
