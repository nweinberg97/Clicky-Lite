"""Smoke test: Sedi with Clicky Lite as its help button, inside the sandboxed iframe harness.
Run tests/sandbox_server.py first. Usage: python3 tests/sedi_smoke.py [--width 1280] [--shots DIR]"""
import argparse, sys
from playwright.sync_api import sync_playwright

QS = [
  ('How do I add a reminder?', 'walk'),
  ('How do I move a card to another tool?', 'walk'),
  ('how do i add a goal in boardly', 'walk'),
  ('How do I download my data?', 'walk'),
  ('where is timely', 'point'),
  ('open brainly', 'point'),
  ('how do i add a task', 'walk'),
  ('make something repeat', 'walk'),
  ('switch to week view', 'walk'),
  ('can i export to notion', 'any'),
]
STATE = """() => { const r=document.querySelector('clicky-lite-root'); const sr=r&&r.shadowRoot; if(!sr) return {ready:false};
 const t=s=>{const e=sr.querySelector(s);return e?e.innerText.replace(/\\s+/g,' ').trim():''};
 return {ready:true, ring:!!sr.querySelector('.ring'), card:t('.card'), answer:t('.answer'), panel:!!sr.querySelector('.panel:not([hidden])')}; }"""

ap=argparse.ArgumentParser(); ap.add_argument('--width',type=int,default=1280); ap.add_argument('--same',action='store_true'); ap.add_argument('--shots')
a=ap.parse_args()
ok=0; errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':a.width,'height':860})
    pg.on('console', lambda m: m.type=='error' and 'fonts.g' not in m.text and errs.append(m.text))
    pg.on('pageerror', lambda e: errs.append('PAGEERROR '+str(e)))
    url=f'http://localhost:8766/?page=demo/index.html'+('&same=1' if a.same else '')
    for i,(q,kind) in enumerate(QS):
        pg.goto(url); pg.wait_for_timeout(2200)
        f=pg.frame_locator('#f'); fr=pg.frames[1]
        f.locator('.clicky-help').click(); pg.wait_for_timeout(500)
        inp=f.locator('clicky-lite-root').locator('.form input'); inp.fill(q); inp.press('Enter'); pg.wait_for_timeout(1300)
        s=fr.evaluate(STATE)
        if kind in ('walk','point') and not s['ring']:
            btn=f.locator('clicky-lite-root').locator('.actions .primary')
            if btn.count(): btn.first.click(); pg.wait_for_timeout(900); s=fr.evaluate(STATE)
        good = s['ring'] or (kind=='any' and (s['answer'] or s['card']))
        ok+=bool(good)
        print('PASS' if good else 'FAIL', repr(q), '| ring' if s['ring'] else '', '|', (s['card'] or s['answer'])[:110])
        if a.shots and i<3: pg.screenshot(path=f'{a.shots}/sedi-{a.width}-{i}.png')
    b.close()
print(f'\nwidth={a.width} sandbox={"same-origin" if a.same else "opaque"}  {ok}/{len(QS)}  errors: {errs[:5] or "none"}')
