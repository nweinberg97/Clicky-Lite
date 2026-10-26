"""Troubleshooting, definitions, hand-offs and the finder: the right kind of answer for each.
Run tests/sandbox_server.py first."""
import json
from playwright.sync_api import sync_playwright
Q = json.load(open('tests/sedi_other.json')); ok = 0
STATE = """() => { const sr=document.querySelector('clicky-lite-root').shadowRoot; const a=sr.querySelectorAll('.answer'); const ring=sr.querySelector('.ring');
 return {answer:a.length?a[a.length-1].innerText:'', ring:!!ring, card:(sr.querySelector('.card h3')||{}).innerText||'', mail:!!sr.querySelector('.handoff')}; }"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 820})
    pg.goto('http://localhost:8765/demo/index.html'); pg.wait_for_timeout(1800)
    for q, kind, want in Q:
        pg.evaluate("q=>ClickyLite.ask(q)", q); pg.wait_for_timeout(800)
        s = pg.evaluate(STATE); a = s['answer'].replace('’', "'")
        if kind == 'error': good = want.lower() in a.lower() or any(w in a.lower() for w in want.lower().split()[:2]) and 'resolution' not in a.lower()[:0]
        if kind == 'error':
            # the answer must be that error's explanation (its description), not a walkthrough
            good = not a.lower().startswith("here's how to") and want.split()[0].lower() in (a + ' ' + s['card']).lower() or want.lower() in a.lower()
        elif kind == 'term': good = a.lower().startswith(want.lower() + ':')
        elif kind == 'handoff': good = 'support' in a.lower()
        else: good = s['ring'] and want.lower() in (a + s['card']).lower()
        ok += bool(good)
        if not good: print(f"MISS {q!r} ({kind}) -> {a[:100]!r}")
    b.close()
print(f"\n{ok}/{len(Q)} troubleshooting/definition/hand-off/finder questions answered the right way")
