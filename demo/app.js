/* Fernbill: a fictional invoicing app used as the host for the Clicky Lite demo.
   Everything here is sample data held in memory; nothing is saved or sent. */
(function () {
  'use strict';

  var TODAY = new Date(2026, 9, 23);
  var state = {
    clients: [
      { id: 'c1', name: 'Juniper & Co', email: 'accounts@juniper.example', note: 'Pays fast. Prefers PDF copies.' },
      { id: 'c2', name: 'Harbor Ceramics', email: 'studio@harborceramics.example', note: 'Card on file expired in August.' },
      { id: 'c3', name: 'Pebble Lane Studio', email: 'hello@pebblelane.example', note: 'Retainer through December.' },
      { id: 'c4', name: 'Oakridge Bakery', email: '', note: 'New client. Still waiting on their billing email.' }
    ],
    invoices: [
      { no: 1046, client: 'c3', desc: 'Packaging system, phase 2', amount: 3800, status: 'Sent', due: '14 Nov' },
      { no: 1045, client: 'c2', desc: 'Product photography, spring line', amount: 1150, status: 'Overdue', due: '9 Oct' },
      { no: 1044, client: 'c1', desc: 'Brand refresh, round 1', amount: 2400, status: 'Paid', due: '2 Oct' },
      { no: 1043, client: 'c4', desc: 'Menu and window signage', amount: 640, status: 'Draft', due: '' }
    ],
    payments: [
      { id: 'p1', inv: 1045, client: 'c2', amount: 1150, when: 'Today, 9:12', status: 'Failed', reason: 'Card declined' },
      { id: 'p2', inv: 1044, client: 'c1', amount: 2400, when: '1 Oct', status: 'Succeeded' }
    ],
    settings: { reminders: false, interval: '3' }
  };

  var view = document.getElementById('view');
  var title = document.getElementById('page-title');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function client(id) { return state.clients.find(function (c) { return c.id === id; }); }
  function initials(name) { return name.split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); }).slice(0, 2).map(function (w) { return w[0]; }).join(''); }
  function avatar(name) {
    var hue = 0; for (var i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
    return '<span class="av" aria-hidden="true" style="--h:' + hue + '">' + esc(initials(name)) + '</span>';
  }
  function badge(status) { return '<span class="st st-' + status.toLowerCase() + '">' + esc(status) + '</span>'; }

  function toast(msg) {
    var box = document.getElementById('toasts');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.append(t);
    setTimeout(function () { t.classList.add('out'); }, 3200);
    setTimeout(function () { t.remove(); }, 3600);
  }

  // ---- views -------------------------------------------------------------
  var views = {
    home: function () {
      var outstanding = state.invoices.filter(function (i) { return i.status === 'Sent' || i.status === 'Overdue'; }).reduce(function (s, i) { return s + i.amount; }, 0);
      var overdue = state.invoices.filter(function (i) { return i.status === 'Overdue'; }).length;
      var paid = state.invoices.filter(function (i) { return i.status === 'Paid'; }).reduce(function (s, i) { return s + i.amount; }, 0);
      return { title: 'Good morning, Mara', html:
        '<section class="kpis" aria-label="This month">' +
          '<div class="kpi"><span>Waiting to be paid</span><b>' + money(outstanding) + '</b></div>' +
          '<div class="kpi"><span>Overdue invoices</span><b>' + overdue + '</b></div>' +
          '<div class="kpi"><span>Paid in October</span><b>' + money(paid) + '</b></div>' +
        '</section>' +
        '<section class="panel-card"><h2>Needs your attention</h2><ul class="todo">' +
          '<li><span class="dot red" aria-hidden="true"></span><span><b>A payment from Harbor Ceramics failed</b> this morning. Invoice #1045, ' + money(1150) + '.</span><a class="lnk" href="#/payments">View payment</a></li>' +
          '<li><span class="dot amber" aria-hidden="true"></span><span><b>Oakridge Bakery</b> has a draft invoice that hasn\'t been sent.</span><a class="lnk" href="#/invoices">Open invoices</a></li>' +
          '<li><span class="dot" aria-hidden="true"></span><span>Reminders are off, so overdue clients aren\'t being nudged.</span><a class="lnk" href="#/settings">Settings</a></li>' +
        '</ul></section>' +
        '<section class="panel-card"><h2>Recent invoices</h2>' + invoiceTable(state.invoices.slice(0, 3)) + '</section>' };
    },
    invoices: function () {
      return { title: 'Invoices', html:
        '<div class="toolbar"><p class="muted">' + state.invoices.length + ' invoices</p>' +
        '<a class="btn primary" href="#/invoices/new" role="button" data-clicky-id="invoices.new"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>New invoice</a></div>' +
        '<section class="panel-card flush">' + invoiceTable(state.invoices) + '</section>' };
    },
    'invoices/new': function () {
      var opts = state.clients.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      return { title: 'New invoice', html:
        '<a class="back" href="#/invoices">Invoices</a>' +
        '<form class="panel-card form" id="invoice-form" novalidate>' +
          '<div class="form-head"><h2>Invoice #' + (state.invoices[0].no + 1) + '</h2><span class="muted">Dated 23 Oct 2026</span></div>' +
          '<div class="field"><label for="f-client">Client</label><select id="f-client" data-clicky-id="invoice.client"><option value="">Choose a client</option>' + opts + '</select></div>' +
          '<div class="row">' +
            '<div class="field grow"><label for="f-desc">Description</label><input id="f-desc" type="text" autocomplete="off" data-clicky-id="invoice.description" placeholder="What did you do?"></div>' +
            '<div class="field amt"><label for="f-amount">Amount</label><div class="prefix"><span aria-hidden="true">$</span><input id="f-amount" type="number" min="0" step="0.01" inputmode="decimal" data-clicky-id="invoice.amount" placeholder="0.00"></div></div>' +
          '</div>' +
          '<div class="row">' +
            '<div class="field"><label for="f-terms">Payment terms</label><select id="f-terms" data-clicky-id="invoice.terms"><option value="0">Due on receipt</option><option value="15">Net 15</option><option value="30" selected>Net 30</option></select></div>' +
            '<div class="field"><span class="lbl">Due date</span><output id="f-due" class="due">22 Nov 2026</output></div>' +
          '</div>' +
          '<div class="form-error" id="form-error" hidden></div>' +
          '<div class="form-foot"><span class="total">Total <b id="f-total">$0</b></span><button class="btn ghost" type="button" id="save-draft">Save draft</button><button class="btn primary" type="submit" data-clicky-id="invoice.send">Send invoice</button></div>' +
        '</form>', after: bindInvoiceForm };
    },
    clients: function () {
      var rows = state.clients.map(function (c) {
        return '<tr><td><span class="who">' + avatar(c.name) + esc(c.name) + '</span></td><td>' + (c.email ? esc(c.email) : '<span class="warn">No billing email</span>') + '</td><td class="note" data-fernbill-private>' + esc(c.note) + '</td></tr>';
      }).join('');
      return { title: 'Clients', html:
        '<div class="toolbar"><p class="muted">' + state.clients.length + ' clients</p><button class="btn primary" type="button" id="add-client" data-clicky-id="clients.add"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>Add client</button></div>' +
        '<form class="panel-card form" id="client-form" hidden novalidate>' +
          '<h2>New client</h2>' +
          '<div class="row"><div class="field grow"><label for="c-name">Client name</label><input id="c-name" type="text" autocomplete="off" data-clicky-id="client.name"></div>' +
          '<div class="field grow"><label for="c-email">Billing email</label><input id="c-email" type="email" autocomplete="off" data-clicky-id="client.email"></div></div>' +
          '<div class="form-foot"><button class="btn ghost" type="button" id="cancel-client">Cancel</button><button class="btn primary" type="submit" data-clicky-id="client.save">Save client</button></div>' +
        '</form>' +
        '<section class="panel-card flush"><div class="scroll"><table class="tbl"><thead><tr><th scope="col">Client</th><th scope="col">Billing email</th><th scope="col">Private notes</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>', after: bindClients };
    },
    payments: function () {
      var rows = state.payments.map(function (p) {
        var c = client(p.client);
        var failed = p.status === 'Failed';
        return '<li class="pay' + (failed ? ' failed' : '') + '">' +
          '<span class="who">' + avatar(c.name) + '<span><b>' + esc(c.name) + '</b><small>Invoice #' + p.inv + ' · ' + esc(p.when) + '</small></span></span>' +
          '<span class="pay-amt">' + money(p.amount) + '</span>' +
          (failed
            ? '<span class="pay-err" data-clicky-error="PAYMENT_DECLINED" data-clicky-error-for="payments.resend"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 6v5M10 13.6v.2"/></svg>Payment failed: card declined</span><button class="btn secondary" type="button" data-clicky-id="payments.resend" data-pay="' + p.id + '">Resend payment link</button>'
            : badge(p.status)) +
        '</li>';
      }).join('');
      return { title: 'Payments', html: '<p class="muted lede">Every payment your clients have tried to make, including the ones that didn\'t go through.</p><section class="panel-card flush"><ul class="pays">' + rows + '</ul></section>', after: bindPayments };
    },
    settings: function () {
      var s = state.settings;
      return { title: 'Settings', html:
        '<form class="panel-card form" id="settings-form" novalidate>' +
          '<h2>Reminders</h2>' +
          '<p class="muted">Fernbill can email clients when an invoice is past due, so you don\'t have to chase.</p>' +
          '<label class="switch"><input type="checkbox" id="s-rem" role="switch" data-clicky-id="settings.reminders"' + (s.reminders ? ' checked' : '') + '><span class="track" aria-hidden="true"></span><span>Automatic reminders</span></label>' +
          '<div class="field narrow"><label for="s-int">Remind every</label><select id="s-int" data-clicky-id="settings.interval"><option value="3"' + (s.interval === '3' ? ' selected' : '') + '>3 days</option><option value="7"' + (s.interval === '7' ? ' selected' : '') + '>7 days</option><option value="14"' + (s.interval === '14' ? ' selected' : '') + '>14 days</option></select></div>' +
          '<div class="form-foot"><button class="btn primary" type="submit" data-clicky-id="settings.save">Save settings</button></div>' +
        '</form>' +
        '<section class="panel-card" data-clicky-id="settings.payout" aria-labelledby="payout-h">' +
          '<h2 id="payout-h">Payout account</h2>' +
          '<p class="muted">Where Fernbill sends your money, two business days after a payment succeeds.</p>' +
          '<div class="bank"><span class="bank-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3 8l7-4 7 4M4 8v7M8 8v7M12 8v7M16 8v7M3 16h14"/></svg></span><span><b>Cedar Valley Credit Union</b><small>Checking ending 4821 · Lindqvist Design LLC</small></span><span class="lock">Clicky Lite never reads this card</span></div>' +
        '</section>', after: bindSettings };
    }
  };

  function invoiceTable(list) {
    var rows = list.map(function (i) {
      var c = client(i.client);
      return '<tr><td class="num">#' + i.no + '</td><td><span class="who">' + avatar(c.name) + esc(c.name) + '</span></td><td class="desc">' + esc(i.desc) + '</td><td class="num">' + money(i.amount) + '</td><td>' + badge(i.status) + '</td><td class="muted">' + (i.due ? 'Due ' + esc(i.due) : '') + '</td></tr>';
    }).join('');
    return '<div class="scroll"><table class="tbl"><thead><tr><th scope="col">No.</th><th scope="col">Client</th><th scope="col">Description</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Due</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  // ---- behaviour ---------------------------------------------------------
  function dueFrom(days) {
    var d = new Date(TODAY); d.setDate(d.getDate() + Number(days));
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function bindInvoiceForm() {
    var form = document.getElementById('invoice-form');
    var terms = document.getElementById('f-terms');
    var due = document.getElementById('f-due');
    var amount = document.getElementById('f-amount');
    var total = document.getElementById('f-total');
    var err = document.getElementById('form-error');
    terms.addEventListener('change', function () { due.textContent = Number(terms.value) === 0 ? 'On receipt' : dueFrom(terms.value); });
    amount.addEventListener('input', function () { total.textContent = money(Number(amount.value) || 0); });
    function showError(code, msg, forId) {
      err.hidden = false;
      err.setAttribute('data-clicky-error', code);
      if (forId) err.setAttribute('data-clicky-error-for', forId); else err.removeAttribute('data-clicky-error-for');
      err.textContent = msg;
    }
    function save(status) {
      var c = client(document.getElementById('f-client').value);
      var desc = document.getElementById('f-desc').value.trim() || 'Services';
      var amt = Number(amount.value) || 0;
      if (!c) return showError('CLIENT_REQUIRED', 'Choose a client for this invoice.', 'invoice.client');
      if (status === 'Sent' && !c.email) return showError('CLIENT_EMAIL_MISSING', 'This client has no billing email. Saved as a draft instead.', 'invoice.client');
      if (status === 'Sent' && amt <= 0) return showError('AMOUNT_REQUIRED', 'Enter an amount above $0.', 'invoice.amount');
      state.invoices.unshift({ no: state.invoices[0].no + 1, client: c.id, desc: desc, amount: amt, status: status, due: status === 'Sent' ? dueFrom(terms.value).replace(/ \d{4}$/, '') : '' });
      location.hash = '#/invoices';
      toast(status === 'Sent' ? 'Invoice sent to ' + c.name + '. (Demo: no email was sent.)' : 'Draft saved.');
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); save('Sent'); });
    document.getElementById('save-draft').addEventListener('click', function () { save('Draft'); });
  }

  function bindClients() {
    var form = document.getElementById('client-form');
    var add = document.getElementById('add-client');
    add.addEventListener('click', function () { form.hidden = false; add.hidden = true; });
    document.getElementById('cancel-client').addEventListener('click', function () { form.hidden = true; add.hidden = false; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('c-name').value.trim();
      if (!name) { document.getElementById('c-name').focus(); return; }
      state.clients.push({ id: 'c' + (state.clients.length + 1), name: name, email: document.getElementById('c-email').value.trim(), note: '' });
      render();
      toast(name + ' added.');
    });
  }

  function bindPayments() {
    view.querySelectorAll('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = state.payments.find(function (x) { return x.id === b.getAttribute('data-pay'); });
        b.textContent = 'Link sent';
        b.disabled = true;
        toast('New payment link sent to ' + client(p.client).name + '. (Demo: nothing was sent.)');
      });
    });
  }

  function bindSettings() {
    var form = document.getElementById('settings-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      state.settings.reminders = document.getElementById('s-rem').checked;
      state.settings.interval = document.getElementById('s-int').value;
      toast(state.settings.reminders ? 'Saved. Reminders go out every ' + state.settings.interval + ' days for overdue invoices.' : 'Saved. Reminders are off.');
    });
  }

  // ---- router ------------------------------------------------------------
  function render() {
    var route = (location.hash.replace(/^#\/?/, '') || 'home');
    if (!views[route]) route = 'home';
    var v = views[route]();
    title.textContent = v.title;
    document.title = v.title + ' · Fernbill (Clicky Lite demo)';
    view.innerHTML = v.html;
    if (v.after) v.after();
    var top = route.split('/')[0];
    document.querySelectorAll('.fb-nav a').forEach(function (a) {
      if (a.getAttribute('data-route') === top) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  addEventListener('hashchange', function () { render(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  render();

  // ---- demo bar height drives the sticky offsets -------------------------
  var bar = document.querySelector('.demobar');
  function measure() { document.documentElement.style.setProperty('--demo-h', bar.offsetHeight + 'px'); }
  measure();
  if (window.ResizeObserver) new ResizeObserver(measure).observe(bar); else addEventListener('resize', measure);

  // ---- demo bar: suggested questions go straight to Clicky ---------------
  document.querySelectorAll('[data-ask]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (window.ClickyLite) window.ClickyLite.ask(b.getAttribute('data-ask'));
    });
  });
})();
