/* "maker's view": what Sedi's maker would see from Clicky Lite. Counts only: which documented
   answer was shown, where walkthroughs stopped, how many questions the docs didn't cover, and the
   questions people chose to send. In this demo it's read from this browser; nothing is sent. */
(function () {
  'use strict';
  var btn = document.getElementById('cl-maker');
  if (!btn) return;
  var dlg = null;
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function top(obj, n) { return Object.keys(obj).map(function (k) { return [k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n); }
  function sum(obj) { return Object.keys(obj).reduce(function (t, k) { return t + obj[k]; }, 0); }
  function list(rows, empty) {
    if (!rows.length) return el('p', 'mv-empty', empty);
    var ul = el('ul', 'mv-list');
    rows.forEach(function (r) { var li = el('li'); li.append(el('span', null, r[0]), el('b', null, String(r[1]))); ul.append(li); });
    return ul;
  }
  function section(title, body) { var s = el('section', 'mv-sec'); s.append(el('h3', null, title), body); return s; }
  function render() {
    var d = window.ClickyLiteDemoInsights ? window.ClickyLiteDemoInsights.read() : null;
    var box = dlg.querySelector('.mv-body'); box.replaceChildren();
    if (!d) { box.append(el('p', 'mv-empty', 'Clicky Lite hasn’t started yet.')); return; }
    var answered = sum(d.answered), started = sum(d.started), finished = sum(d.finished);
    var stats = el('div', 'mv-stats');
    [[answered, 'answered from the docs'], [d.missing, 'not in the docs yet'], [finished + ' / ' + started, 'walkthroughs finished'], [d.handoffs, 'handed to the full clicky']]
      .forEach(function (s) { var c = el('div', 'mv-stat'); c.append(el('b', null, String(s[0])), el('span', null, s[1])); stats.append(c); });
    box.append(stats);
    box.append(section('most asked about', list(top(d.answered, 5), 'Ask Clicky Lite something, then check back.')));
    box.append(section('where people stopped', list(top(d.stopped, 5), 'Nobody has stopped part-way.')));
    var shared = el('div');
    if (!d.shared.length) shared.append(el('p', 'mv-empty', 'None yet. When the docs don’t have an answer, people can choose to send their question.'));
    else { var ul = el('ul', 'mv-list mv-q'); d.shared.slice(0, 6).forEach(function (q) { ul.append(el('li', null, '“' + q.text + '”')); }); shared.append(ul); }
    box.append(section('questions people chose to send', shared));
    var never = el('p', 'mv-never');
    never.append(el('b', null, 'never collected: '), document.createTextNode('names or accounts, what people type into Sedi (cards, notes, links), or their questions unless they press send.'));
    box.append(never);
  }
  function open() {
    if (!dlg) {
      dlg = el('div', 'mv'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'mv-h'); dlg.setAttribute('data-clicky-ignore', '');
      var card = el('div', 'mv-card');
      var head = el('div', 'mv-head');
      var h = el('h2', null, 'what sedi’s maker would see'); h.id = 'mv-h';
      var x = el('button', 'mv-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = close;
      head.append(h, x);
      var sub = el('p', 'mv-sub', 'Private by design: counts, not conversations. In this demo they’re kept in your browser, so try a few questions and check back.');
      var foot = el('div', 'mv-foot');
      var reset = el('button', 'mv-reset', 'clear'); reset.type = 'button'; reset.onclick = function () { window.ClickyLiteDemoInsights && window.ClickyLiteDemoInsights.reset(); render(); };
      var done = el('button', 'mv-done', 'done'); done.type = 'button'; done.onclick = close;
      foot.append(reset, done);
      card.append(head, sub, el('div', 'mv-body'), foot);
      dlg.append(card);
      dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg && !dlg.hidden) close(); });
      document.body.append(dlg);
    }
    render(); dlg.hidden = false; dlg.querySelector('.mv-done').focus();
  }
  function close() { if (dlg) dlg.hidden = true; btn.focus(); }
  btn.addEventListener('click', open);
})();
