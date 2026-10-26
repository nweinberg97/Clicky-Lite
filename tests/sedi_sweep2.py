"""Every Sedi walkthrough, started from another screen, clicked through like a person:
click what Clicky points at, type into fields it points at, and do the steps that have no
button (double-click a card, hover an item, open a link) the way the instruction says.
A step fails if Clicky shows neither a highlight nor a way to get there.
Run tests/sandbox_server.py first.  Usage: python3 tests/sedi_sweep2.py [width] [only-substring]"""
import json, sys
from playwright.sync_api import sync_playwright
pack = json.load(open('demo/clicky-pack.json'))
W = int(sys.argv[1]) if len(sys.argv) > 1 else 1280
ONLY = sys.argv[2].lower() if len(sys.argv) > 2 else None
STATE = """() => { const sr=document.querySelector('clicky-lite-root').shadowRoot; const t=s=>{const e=sr.querySelector(s);return e?e.innerText.replace(/\\s+/g,' ').trim():''};
 const ring=sr.querySelector('.ring'); let r=ring?ring.getBoundingClientRect():null; const card=sr.querySelector('.card');
 return {count:t('.card .count'), title:t('.card h3'), text:t('.card p'), first:t('.first'), miss:t('.miss'), ring: r?[r.x+r.width/2, r.y+r.height/2]:null, card:!!card, done:!!sr.querySelector('.done')}; }"""
KIND = """([x,y]) => { const e=document.elementFromPoint(x,y); if(!e) return null; if(e.closest('input,textarea,[contenteditable=true]')) return 'field'; if(e.closest('select')) return 'select'; if(e.closest('button,a,[role=button],[role=tab],summary,label')) return 'click'; return 'other'; }"""
NEXT = "(()=>{const b=document.querySelector('clicky-lite-root').shadowRoot.querySelector('.card [data-primary]'); if(b) b.click();})()"
FIRST_ITEM = """(sel) => { const els=[...document.querySelectorAll(sel)].filter(e=>{const r=e.getBoundingClientRect();return r.width>8&&r.height>8&&r.top>40&&r.bottom<innerHeight-10}); const e=els[0]; if(!e) return null; const r=e.getBoundingClientRect(); return [r.x+Math.min(r.width/2,60), r.y+Math.min(r.height/2,18)]; }"""
starts = ['brainly', 'taskly', 'home', 'boardly', 'timely']
ok = 0; fails = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'])
    pg = b.new_page(viewport={'width': W, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:160]))
    for wi, wf in enumerate(pack['workflows']):
        if ONLY and ONLY not in wf['title'].lower(): continue
        start = starts[wi % len(starts)]
        dead = []
        try:
            pg.goto('http://localhost:8766/?page=demo/index.html'); pg.wait_for_timeout(1500)
            fr = pg.frames[1]
            fr.evaluate(f"location.hash='#/{start}'"); pg.wait_for_timeout(500)
            fr.evaluate("q=>ClickyLite.ask(q)", wf['title']); pg.wait_for_timeout(900)
            fr.evaluate("(()=>{const b=document.querySelector('clicky-lite-root').shadowRoot.querySelector('.actions .primary'); if(b) b.click();})()"); pg.wait_for_timeout(500)
            seen = 0
            for guard in range(len(wf['steps']) * 3 + 2):
                s = fr.evaluate(STATE)
                if not s['card']: break
                seen += 1
                ins = (s['text'] + ' ' + s['title']).lower()
                items_step = 'your things are in here' in s['first'].lower()
                if s['ring'] and not items_step:
                    kind = fr.evaluate(KIND, s['ring'])
                    if s['first'] or kind == 'click':
                        pg.mouse.click(*s['ring']); pg.wait_for_timeout(900)
                        if s['first']: continue
                        after = fr.evaluate(STATE)
                        if after['card'] and after['count'] == s['count'] and not after['done']:
                            dead.append(f"{s['count']} {s['title']}: clicking the pointed control didn't move on")
                            fr.evaluate(NEXT)
                    elif kind == 'field':
                        pg.mouse.click(*s['ring']); pg.keyboard.type('Test'); pg.keyboard.press('Tab'); pg.wait_for_timeout(700)
                        after = fr.evaluate(STATE)
                        if after['card'] and after['count'] == s['count'] and not after['done']:
                            dead.append(f"{s['count']} {s['title']}: typing in the pointed field didn't move on")
                            fr.evaluate(NEXT)
                    else:
                        fr.evaluate(NEXT)
                else:
                    # a step with no button: do what it says, like a person would
                    did = False
                    if 'double-click' in ins or 'open it' in ins:
                        pt = fr.evaluate(FIRST_ITEM, '.task-card, .tile, [data-id]')
                        if pt: pg.mouse.dblclick(*pt); did = True
                    elif 'hover' in ins:
                        pt = fr.evaluate(FIRST_ITEM, '.task-card, .tile, [data-id]')
                        if pt: pg.mouse.move(*pt, steps=4); did = True
                    elif 'my links' in ins or 'preview' in ins:
                        pt = fr.evaluate(FIRST_ITEM, '.links-dash .link-list > *, .lf-stack > *')
                        if pt: pg.mouse.click(*pt); did = True
                    pg.wait_for_timeout(700)
                    s2 = fr.evaluate(STATE)
                    if s2['count'] == s['count'] and not s2['ring']:
                        if s['miss'] and 'specific control' not in s['miss'] and not did:
                            dead.append(f"{s['count']} {s['title']}: {s['miss'][:70]}")
                        fr.evaluate(NEXT)
                pg.wait_for_timeout(450)
            if seen == 0: dead.append('no walkthrough started')
        except Exception as e:
            dead.append('error ' + str(e)[:100])
        if dead: fails.append((wf['title'], start, dead))
        else: ok += 1
        print(('DEAD ' if dead else 'ok   ') + f"[{start}] {wf['title']}" + (f" -> {dead}" if dead else ''), flush=True)
    b.close()
total = ok + len(fails)
print(f"\nwidth={W}: {ok}/{total} walkthroughs with no dead ends. page errors: {errs[:3] or 'none'}")
