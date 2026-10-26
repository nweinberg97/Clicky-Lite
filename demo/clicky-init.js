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

  /* Private feedback for Sedi's maker. Clicky Lite only reports ids and doc titles (which answer
     was shown, where a walkthrough stopped). Words leave only when the user taps "send" on exactly
     that text. A real install would send these counts to the maker; this demo keeps them in this
     browser so you can see them under "maker's view". */
  var KEY = 'clicky-lite-demo-insights';
  var mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { mem = null; }
    if (!mem || typeof mem !== 'object') mem = { answered: {}, missing: 0, started: {}, finished: {}, stopped: {}, handoffs: 0, shared: [] };
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* memory only */ } }
  function bump(obj, k) { obj[k] = (obj[k] || 0) + 1; }
  var titles = {};
  ((window.CLICKY_DEMO_PACK && window.CLICKY_DEMO_PACK.workflows) || []).forEach(function (w) { titles[w.id] = w.title; });
  var lastStep = null;
  function insights(e) {
    var d = load();
    var wf = e.workflowId ? (titles[e.workflowId] || e.workflowId) : null;
    if (e.type === 'guidance_shown') { if (e.answered && e.topic) bump(d.answered, e.topic); else if (!e.answered) d.missing++; }
    else if (e.type === 'step_viewed' && wf) { if (e.stepIndex === 0) bump(d.started, wf); lastStep = { wf: wf, i: e.stepIndex }; }
    else if (e.type === 'workflow_completed' && wf) { bump(d.finished, wf); lastStep = null; }
    else if (e.type === 'guidance_dismissed' && lastStep) { bump(d.stopped, lastStep.wf + ' · step ' + (lastStep.i + 1)); lastStep = null; }
    else if (e.type === 'handed_to_clicky') d.handoffs++;
    else return;
    save();
  }
  function shareQuestion(text) { var d = load(); d.shared.unshift({ text: String(text).slice(0, 500), at: Date.now() }); d.shared = d.shared.slice(0, 50); save(); }
  var CLICKY_SITE = 'https://www.heyclicky.com/';
  function fullClicky() {
    // A real version would open the Clicky app with the hand-off filled in. This mockup isn't
    // connected to Clicky, so the button is a plain link to Clicky's website.
    return {
      note: 'This mockup isn’t connected to Clicky, so it opened Clicky’s website in a new tab. In a real version, the Clicky app would open with only this:',
      linkLabel: 'Didn’t open? heyclicky.com',
      linkUrl: CLICKY_SITE
    };
  }


  window.ClickyLiteDemoInsights = { read: function () { return JSON.parse(JSON.stringify(load())); }, reset: function () { mem = null; try { localStorage.removeItem(KEY); } catch (e) {} } };

  api.init({ pack: window.CLICKY_DEMO_PACK || 'clicky-pack.json', accent: '#2F6FEA', panelPosition: 'top-right', chooser: chooser,
             insights: insights, fullClicky: fullClicky, fullClickyUrl: CLICKY_SITE, shareQuestion: shareQuestion })
    .catch(function (err) { console.warn('[Clicky Lite demo]', err && err.message ? err.message : err); });
})();
