"""Question bank: does each everyday phrasing land on the right Sedi walkthrough?
Run tests/sandbox_server.py first (uses the site port directly)."""
import json, re, sys
from playwright.sync_api import sync_playwright
Q = json.load(open('tests/sedi_questions_fresh4.json'))
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower().replace('’', "'")).strip()
ok = 0; bad = []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 820})
    pg.goto('http://localhost:8765/demo/index.html'); pg.wait_for_timeout(1800)
    for q, want in Q:
        pg.evaluate("q=>ClickyLite.ask(q)", q); pg.wait_for_timeout(350)
        ans = pg.evaluate("(()=>{const a=document.querySelector('clicky-lite-root').shadowRoot.querySelectorAll('.answer');return a.length?a[a.length-1].innerText:''})()")
        m = re.search(r"here.s how to (.+?): \d+ steps?", ans, re.I) or re.search(r"here.s (your data): \d+ steps?", ans, re.I)
        got = m.group(1) if m else ans[:70]
        if m and (norm(got) == norm(want) or norm(want).startswith(norm(got))): ok += 1
        else: bad.append((q, want, got))
    b.close()
for q, want, got in bad: print(f"MISS {q!r}\n     want: {want}\n     got:  {got}")
print(f"\n{ok}/{len(Q)} questions land on the right walkthrough")
