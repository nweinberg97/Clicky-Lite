"""Clicky Lite regression run, inside a sandboxed iframe that mimics Claude's artifact viewer.

Start the harness first:  python3 tests/sandbox_server.py
Then:                     python3 tests/regression.py [--same] [--width 1280] [--shots DIR]

Each case starts on a page, asks a question (typed, or a demo-bar chip), and checks the
outcome: which walkthrough, which element the buddy points at, a refusal, a handoff, or
suggestions. Prints a pass rate and exits non-zero on any failing chip.
"""
import argparse, json, sys
from playwright.sync_api import sync_playwright

# (start page, question, expected)
# expected kinds:
#   ('wf', 'Send an invoice')        walkthrough with that title
#   ('point', 'text')                buddy points at an element whose text contains `text`
#   ('route', 'Clients', 'Harbor')   first step points at nav item, then (after clicking) at `text`
#   ('answer', 'substring')          panel answer text contains substring, no walkthrough required
#   ('handoff',)                     support email offered
#   ('limit', 'pdf')                 "can't do that" + support handoff
#   ('blocked',)                     says it never looks there, points at nothing inside
#   ('suggest',)                     unresolved with 2-3 suggestion chips
CASES = [
    # --- the original weak ones ---
    ('home', 'create an invoice', ('wf', 'Send an invoice')),
    ('home', 'where are my payments', ('point', 'Payments')),
    ('invoices', 'find invoice 1045', ('point', '#1045')),
    ('home', 'download an invoice as pdf', ('limit', 'PDF')),
    # --- how-to paraphrases ---
    ('home', 'make an invoice', ('wf', 'Send an invoice')),
    ('home', 'bill a client', ('wf', 'Send an invoice')),
    ('home', 'how do i bill someone for my work', ('wf', 'Send an invoice')),
    ('home', 'write an invoice for juniper', ('wf', 'Send an invoice')),
    ('home', 'how to send invoce', ('wf', 'Send an invoice')),
    ('home', 'new invoice', ('route', 'Invoices', 'New invoice')),
    ('home', 'remind clients', ('wf', 'Set up payment reminders')),
    ('home', 'chase late payments', ('wf', 'Set up payment reminders')),
    ('home', 'how can i nudge clients who havent paid', ('wf', 'Set up payment reminders')),
    ('home', 'turn on reminders', ('wf', 'Set up payment reminders')),
    ('home', 'add a customer', ('wf', 'Add a client')),
    ('home', 'how do i add a cusotmer', ('wf', 'Add a client')),
    ('home', 'NEW CLIENT', ('wf', 'Add a client')),
    ('payments', 'resend the payment link', ('wf', 'Resend a payment link')),
    ('home', 'my client cant pay, how do i let them pay again', ('wf', 'Resend a payment link')),
    ('home', 'Hi Clicky, I was wondering if you could please tell me how I would go about sending an invoice to one of my clients?', ('wf', 'Send an invoice')),
    # --- troubleshooting and terms ---
    ('payments', 'why did the payment fail', ('point', 'Resend payment link')),
    ('payments', "what's wrong?", ('point', 'Resend payment link')),
    ('home', 'card declined', ('answer', 'declined')),
    ('home', 'what does net 30 mean', ('answer', 'Net 30')),
    ('home', 'net 30', ('answer', 'Net 30')),
    ('home', 'what is overdue', ('answer', 'Overdue')),
    ('home', 'whats a payout account', ('answer', 'Payout account')),
    # --- finder: on screen ---
    ('home', "where's the settings", ('point', 'Settings')),
    ('home', 'settings', ('point', 'Settings')),
    ('home', 'Harbor Ceramics', ('point', 'Harbor Ceramics')),
    ('invoices', 'invoice 1045', ('point', '#1045')),
    ('invoices', 'show me the overdue invoice', ('point', 'Overdue')),
    ('invoices', 'find the 3800 one', ('point', '3,800')),
    ('home', 'take me to clients', ('point', 'Clients')),
    ('clients', 'where is the add client button', ('point', 'Add client')),
    ('invoices/new', 'where do i put the amount', ('point', 'Amount')),
    ('invoices/new', 'payment terms', ('point', 'Payment terms')),
    ('home', 'open payments', ('point', 'Payments')),
    # --- finder: routes ---
    ('settings', 'find pebble lane studio', ('route', 'Clients', 'Pebble Lane Studio')),
    ('settings', 'where is invoice 1043', ('route', 'Invoices', '#1043')),
    ('settings', 'show me the failed payment', ('route', 'Payments', 'Harbor Ceramics')),
    ('home', 'where is the reminders setting', ('route', 'Settings', 'Automatic reminders')),
    # --- privacy ---
    ('settings', 'where is my payout account', ('blocked',)),
    ('clients', "show me harbor ceramics' private notes", ('blocked_or_row',)),
    # --- handoff, limits, unknowns ---
    ('home', 'I was charged twice, can I get a refund?', ('handoff',)),
    ('home', 'i want to talk to a human', ('handoff',)),
    ('home', 'export to quickbooks', ('limit', 'accounting')),
    ('home', 'delete an invoice', ('limit', 'delete')),
    ('home', 'how do i change the font to comic sans', ('suggest',)),
]

CHIPS = [
    ('home', 'How do I send an invoice?', ('wf', 'Send an invoice')),
    ('payments', 'Why did my payment fail?', ('point', 'Resend payment link')),
    ('home', 'What does net 30 mean?', ('answer', 'Net 30')),
    ('settings', 'Where is Harbor Ceramics?', ('route', 'Clients', 'Harbor Ceramics')),
    ('home', 'How do I set up payment reminders?', ('wf', 'Set up payment reminders')),
    ('home', 'I was charged twice, can I get a refund?', ('handoff',)),
]

JS_STATE = """() => {
  const root = document.querySelector('clicky-lite-root');
  const sr = root && root.shadowRoot;
  if (!sr) return { ready: false };
  const q = (s) => sr.querySelector(s);
  const ring = q('.ring');
  let target = null;
  if (ring) {
    const r = ring.getBoundingClientRect();
    // The element whose box the ring surrounds (ring = target box + 4px padding).
    const near = (a, b) => Math.abs(a - b) < 3;
    let box = null;
    for (const e of document.body.querySelectorAll('*')) {
      if (e.closest('clicky-lite-root')) continue;
      const b = e.getBoundingClientRect();
      if (near(b.left - 4, r.left) && near(b.top - 4, r.top) && near(b.width + 8, r.width) && near(b.height + 8, r.height)) { box = e; }
    }
    target = box ? (box.innerText || box.getAttribute('aria-label') || box.textContent || '').trim().slice(0, 120) : null;
    if (box && /^(INPUT|SELECT|TEXTAREA)$/.test(box.tagName)) {
      const id = box.id; const lab = id && document.querySelector('label[for="' + id + '"]');
      target = (lab ? lab.textContent : box.getAttribute('aria-label') || '').trim();
    }
  }
  const card = q('.card');
  return {
    ready: true,
    answer: (q('.answer') || {}).textContent || '',
    note: (sr.querySelector('.card .miss') || {}).textContent || '',
    cardTitle: card ? (card.querySelector('h3') || {}).textContent : null,
    cardText: card ? card.textContent : null,
    count: card ? (card.querySelector('.count') || {}).textContent : null,
    target,
    handoff: !!sr.querySelector('.handoff a[href^="mailto:"]'),
    suggestions: [...sr.querySelectorAll('.chips[aria-label="Did you mean"] .chip')].map(b => b.textContent),
    walk: [...sr.querySelectorAll('.actions .primary')].map(b => b.textContent),
    panelOpen: !!(q('.panel') && !q('.panel').hidden),
  };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--same', action='store_true', help='add allow-same-origin to the sandbox')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--direct', action='store_true', help='load the demo directly, no iframe')
    ap.add_argument('--only', default=None)
    ap.add_argument('--shots', default=None)
    a = ap.parse_args()
    host = 'http://localhost:8766/?same=1' if a.same else 'http://localhost:8766/'
    results = []
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': a.width, 'height': 860})
        ctx.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(status=200, content_type='text/css', body=''))
        page = ctx.new_page()
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'fonts' not in m.text and 'ERR_TUNNEL' not in m.text else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:8765/demo/' if a.direct else host)
        frame = page.main_frame if a.direct else page.frame_locator('#f')
        fr = page.main_frame if a.direct else None

        def get_frame():
            if a.direct:
                return page.main_frame
            for f in page.frames:
                if f.url.startswith('http://localhost:8765/demo/'):
                    return f
            return None

        page.wait_for_timeout(900)
        f = get_frame()
        info = f.evaluate("() => ({origin: location.origin, cookie: (()=>{try{document.cookie; return 'ok'}catch(e){return 'blocked'}})(), ls: (()=>{try{localStorage.length; return 'ok'}catch(e){return 'blocked'}})(), ready: !!window.ClickyLite})")
        print('frame:', json.dumps(info))

        def go(route):
            f = get_frame()
            f.evaluate("(r) => { location.hash = '#/' + r; }", route)
            page.wait_for_timeout(250)
            # close anything open
            f.evaluate("() => { const sr = document.querySelector('clicky-lite-root')?.shadowRoot; const x = sr?.querySelector('.card .icon-btn'); if (x) x.click(); if (window.ClickyLite?.isOpen()) window.ClickyLite.close(); }")
            page.wait_for_timeout(150)
            return f

        def ask_typed(f, q):
            f.click('.ask-clicky')
            page.wait_for_timeout(150)
            inp = f.locator('clicky-lite-root').locator('.form input')
            inp.fill(q)
            inp.press('Enter')
            page.wait_for_timeout(700)

        def ask_chip(f, q):
            f.click(f'.try[data-ask="{q}"]')
            page.wait_for_timeout(800)

        def state(f):
            return f.evaluate(JS_STATE)

        def start_walk(f):
            btn = f.locator('clicky-lite-root').locator('.actions .primary')
            if btn.count():
                btn.first.click()
                page.wait_for_timeout(700)

        def check(f, exp, s):
            kind = exp[0]
            if kind == 'wf':
                ok = exp[1].lower() in (s['answer'] or '').lower() or ('step' in (s['count'] or '').lower() and exp[1].split()[-1].lower() in (s['answer'] + (s['cardText'] or '')).lower())
                return ok, f"answer={s['answer'][:70]!r} card={s['cardTitle']!r}"
            if kind == 'point':
                if not s['target'] and s['walk']:
                    start_walk(f); s = state(f)
                t = (s['target'] or '')
                return exp[1].lower() in t.lower(), f"target={t[:70]!r} answer={s['answer'][:60]!r}"
            if kind == 'route':
                if not s['target'] and s['walk']:
                    start_walk(f); s = state(f)
                t1 = s['target'] or ''
                if exp[1].lower() not in t1.lower():
                    return False, f'first target={t1[:60]!r} answer={s["answer"][:60]!r}'
                # user clicks the nav item themselves
                f.click(f'.fb-nav a:has-text("{exp[1]}")')
                page.wait_for_timeout(900)
                s2 = state(f)
                t2 = s2['target'] or ''
                return exp[2].lower() in t2.lower(), f'then target={t2[:60]!r}'
            if kind == 'answer':
                txt = (s['answer'] or '') + ' ' + (s['cardText'] or '')
                return exp[1].lower() in txt.lower(), f"answer={s['answer'][:80]!r}"
            if kind == 'handoff':
                return s['handoff'], f"answer={s['answer'][:70]!r}"
            if kind == 'limit':
                ok = s['handoff'] and "can't" in s['answer'].replace('’', "'") and exp[1].lower() in s['answer'].lower()
                return ok, f"answer={s['answer'][:90]!r}"
            if kind == 'blocked':
                ok = 'never' in s['answer'].lower() and not (s['target'] and 'Cedar' in s['target'])
                return ok, f"answer={s['answer'][:90]!r} target={s['target']!r}"
            if kind == 'blocked_or_row':
                # Notes are never read: pointing at the client row (outside the note) or refusing are both fine.
                t = s['target'] or ''
                ok = ('Pays fast' not in t and 'expired' not in t) and ('harbor' in t.lower() or 'never' in s['answer'].lower() or s['suggestions'])
                return bool(ok), f"target={t[:60]!r} answer={s['answer'][:60]!r}"
            if kind == 'suggest':
                return len(s['suggestions']) >= 2, f"suggestions={s['suggestions']}"
            return False, 'unknown expectation'

        suite = [('chip', c) for c in CHIPS] + [('typed', c) for c in CASES]
        for mode, (route, q, exp) in suite:
            if a.only and a.only.lower() not in q.lower():
                continue
            f = go(route)
            try:
                (ask_chip if mode == 'chip' else ask_typed)(f, q)
                s = state(f)
                ok, detail = check(f, exp, s)
            except Exception as e:  # noqa
                ok, detail = False, f'error {str(e)[:120]}'
            results.append((mode, route, q, exp, ok, detail))
            if a.shots and not ok:
                page.screenshot(path=f"{a.shots}/fail-{a.width}-{len(results)}.png")
        b.close()

    chips = [r for r in results if r[0] == 'chip']
    typed = [r for r in results if r[0] == 'typed']
    for mode, route, q, exp, ok, detail in results:
        print(('PASS' if ok else 'FAIL'), f'[{mode}] /{route} {q!r} -> {exp} | {detail}')
    print(f"\nwidth={a.width} sandbox={'allow-same-origin' if a.same else 'opaque'}{' (direct)' if a.direct else ''}")
    print(f"chips: {sum(r[4] for r in chips)}/{len(chips)}   phrasings: {sum(r[4] for r in typed)}/{len(typed)}")
    print('console errors:', errors or 'none')
    sys.exit(0 if all(r[4] for r in chips) and not errors else 1)


if __name__ == '__main__':
    main()
