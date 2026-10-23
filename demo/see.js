/* "What Clicky Lite can see on this page": a live view of exactly what the SDK may read
   here, from window.ClickyLite.see(), plus the regions its privacy rules never read. */
(function () {
  'use strict';
  var panel = document.getElementById('see-panel');
  var toggle = document.getElementById('see-toggle');
  var body = document.getElementById('see-body');
  var outline = document.getElementById('see-outline');
  var timer = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function group(title, items, empty) {
    var g = el('section', 'see-group');
    g.append(el('h3', '', title));
    if (!items.length) { g.append(el('p', 'see-empty', empty)); return g; }
    var ul = el('ul');
    items.forEach(function (it) {
      var li = el('li');
      if (typeof it === 'string') li.textContent = it;
      else { li.append(el('span', 'k', it.k)); li.append(el('span', 'v', it.v)); }
      ul.append(li);
    });
    g.append(ul);
    return g;
  }

  function refresh() {
    var api = window.ClickyLite;
    var ctx = api && api.see ? api.see() : null;
    body.replaceChildren();
    if (!ctx) { body.append(el('p', 'see-empty', 'Clicky Lite is still loading.')); return; }
    var page = [];
    if (ctx.route) page.push({ k: 'Page', v: ctx.route });
    if (ctx.pageTitle) page.push({ k: 'Title', v: ctx.pageTitle });
    (ctx.headings || []).forEach(function (h) { page.push({ k: 'Heading', v: h }); });
    body.append(group('The page', page, 'Nothing.'));
    var controls = (ctx.elements || []).map(function (e) {
      var state = [e.disabled ? 'disabled' : '', e.invalid ? 'invalid' : ''].filter(Boolean).join(', ');
      return { k: e.label || '(no label)', v: (e.role || 'element') + (state ? ', ' + state : '') };
    });
    body.append(group('Controls it can point at (' + controls.length + ')', controls, 'No tagged controls on this screen.'));
    var errs = (ctx.visibleErrors || []).map(function (e) { return { k: e.code || 'Error', v: e.message || '' }; });
    body.append(group('Errors on screen', errs, 'None.'));
    var blocked = api.blockedRegions ? api.blockedRegions() : [];
    var seen = {};
    var rules = [];
    blocked.forEach(function (b) { if (!seen[b.reason]) { seen[b.reason] = 1; rules.push({ k: 'Never read', v: b.reason }); } });
    body.append(group('Blocked on this screen', rules, 'Nothing blocked here. Try Settings or Clients.'));
    var never = el('section', 'see-group');
    never.append(el('h3', '', 'Never read, anywhere'));
    never.append(el('p', 'see-empty', 'What you type into fields, passwords, card numbers, keystrokes, screenshots. Clicky Lite also never clicks or types for you.'));
    body.append(never);
    paintOutlines(blocked);
  }

  function paintOutlines(blocked) {
    document.querySelectorAll('[data-see-blocked]').forEach(function (n) { n.removeAttribute('data-see-blocked'); });
    if (!outline.checked) return;
    (blocked || []).forEach(function (b) { b.element.setAttribute('data-see-blocked', ''); });
  }

  function open(on) {
    panel.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    document.body.classList.toggle('seeing', on);
    clearInterval(timer);
    if (on) { refresh(); timer = setInterval(refresh, 1200); }
    else paintOutlines([]);
  }

  toggle.addEventListener('click', function () { open(panel.hidden); });
  document.getElementById('see-close').addEventListener('click', function () { open(false); toggle.focus(); });
  outline.addEventListener('change', refresh);
  addEventListener('hashchange', function () { if (!panel.hidden) setTimeout(refresh, 0); });
})();
