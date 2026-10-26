/* Starts Clicky Lite in Sedi from the embedded pack (clicky-pack.js), so nothing is fetched at
   run time. A normal install is the one-line data-clicky-pack script tag; this form is for hosts
   that sandbox the page (opaque origin, strict CSP).

   The optional chooser: when Clicky Lite's on-device matcher isn't sure what a question means,
   and this page runs inside Claude (which offers the "sample" capability), Claude picks ONE entry
   from Sedi's own documented list. It can't invent steps or buttons: those always come from the
   help docs. Anywhere else (GitHub Pages, no consent) it quietly falls back to the matcher. */
(function () {
  'use strict';
  var api = window.ClickyLite;
  if (!api) return;

  var samplePromise = null;
  function getSample() {
    if (!samplePromise) {
      samplePromise = (window.claude && typeof window.claude.use === 'function')
        ? window.claude.use('sample').catch(function () { return null; })
        : Promise.resolve(null);
    }
    return samplePromise;
  }
  var declined = false;

  function chooser(question, options) {
    if (declined) return Promise.resolve(null);
    return getSample().then(function (sample) {
      if (!sample) return null;
      var list = options.map(function (o) { return o.id + ' | ' + o.kind + ' | ' + o.title; }).join('\n');
      var prompt =
        'You route questions for the in-app help button of Sedi, a workspace web app with tools called ' +
        'Taskly (tasks in columns), Boardly (goals and boards), Timely (calendar, routines, reminders), ' +
        'Brainly (notes, links, files), Home, the Universal Board and the assistant (Atom). ' +
        'A user typed the question below. Pick the ONE entry from the list that best answers it. ' +
        'Only use ids from the list. If nothing in the list fits, answer null.\n\n' +
        'Question: ' + question + '\n\nEntries (id | kind | title):\n' + list + '\n\n' +
        'Reply with JSON only: {"id": "<id from the list>"} or {"id": null}.';
      return sample.json(prompt, { modelTier: 'quick' }).then(function (r) {
        return r && typeof r.id === 'string' ? r.id : null;
      }, function (err) {
        if (err && err.code === 'not_granted') declined = true;
        return null;
      });
    });
  }

  api.init({ pack: window.CLICKY_DEMO_PACK || 'clicky-pack.json', accent: '#2F6FEA', panelPosition: 'top-right', chooser: chooser })
    .catch(function (err) { console.warn('[Clicky Lite demo]', err && err.message ? err.message : err); });
})();
