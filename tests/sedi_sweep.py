"""Sweep: every Sedi walkthrough, started from a screen other than where it begins.
For each step, Clicky must either point at the control, or point at the way to it ("first: ..."),
or the step must be one the docs give no control for. Clicks along like a user would.
Run tests/sandbox_server.py first."""
import json, sys
from playwright.sync_api import sync_playwright
pack=json.load(open('demo/clicky-pack.json'))
STATE="""() => { const sr=document.querySelector('clicky-lite-root').shadowRoot; const t=s=>{const e=sr.querySelector(s);return e?e.innerText.replace(/\\s+/g,' ').trim():''};
 const ring=sr.querySelector('.ring'); let r=ring?ring.getBoundingClientRect():null;
 return {count:t('.card .count'), title:t('.card h3'), first:t('.first'), miss:t('.miss'), ring: r?[r.x+r.width/2, r.y+r.height/2]:null, card:!!sr.querySelector('.card')}; }"""
starts=['brainly','taskly','home']
results=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'])
    pg=b.new_page(viewport={'width':int(sys.argv[1]) if len(sys.argv)>1 else 1280,'height':820}); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)[:160]))
    for wi,wf in enumerate(pack['workflows']):
      try:
          start=starts[wi%3]
          pg.goto(f'http://localhost:8766/?page=demo/index.html'); pg.wait_for_timeout(1600)
          f=pg.frame_locator('#f'); fr=pg.frames[1]
          fr.evaluate(f"location.hash='#/{start}'"); pg.wait_for_timeout(500)
          fr.evaluate("q=>ClickyLite.ask(q)", wf['title']); pg.wait_for_timeout(1000)
          fr.evaluate("(()=>{const b=document.querySelector('clicky-lite-root').shadowRoot.querySelector('.actions .primary'); if(b) b.click();})()"); pg.wait_for_timeout(500)
          dead=[]
          for k in range(len(wf['steps'])):
              s=fr.evaluate(STATE)
              if not s['card']: break
              if not s['ring'] and s['miss'] and 'specific control' not in s['miss']:
                  dead.append(f"{s['count']} {s['title']}: {s['miss'][:60]}")
              # act like a user: click what is pointed at (only buttons/links), else press next
              clicked=False
              if s['ring']:
                  tag=fr.evaluate("([x,y])=>{const e=document.elementFromPoint(x,y);const c=e&&e.closest('button,a,[role=button],[role=tab]');return c?c.tagName:null}", s['ring'])
                  if tag and not s['first']:
                      pg.mouse.click(s['ring'][0], s['ring'][1]+ (pg.frames[1]==fr and 0)); clicked=True
                  elif tag and s['first']:
                      pg.mouse.click(s['ring'][0], s['ring'][1]); pg.wait_for_timeout(700); continue
              if not clicked:
                  fr.evaluate("(()=>{const b=document.querySelector('clicky-lite-root').shadowRoot.querySelector('.card [data-primary]'); if(b) b.click();})()")
              pg.wait_for_timeout(650)
              # dismiss any Sedi dialog the click opened, so the next step isn't blocked
              fr.evaluate("document.querySelectorAll('.modal .close, .popover .close').length")
          results.append((wf['title'], start, dead))
          print(('DEAD ' if dead else 'ok   ')+f"[{start}] {wf['title']}" + (f" -> {dead}" if dead else ''), flush=True)
      except Exception as e:
        print('ERR  '+wf['title']+' '+str(e)[:100], flush=True); results.append((wf['title'],'?',['error']))
    b.close()
bad=[r for r in results if r[2]]
print(f"\n{len(results)-len(bad)}/{len(results)} walkthroughs with no dead ends. page errors: {errs[:3] or 'none'}")
