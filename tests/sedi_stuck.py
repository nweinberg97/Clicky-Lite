"""Hand-off and private feedback: "stuck?" on a step card opens the full-Clicky sheet showing only
the question, the app and the step; a question the docs don't cover can be sent to the maker
(opt-in, exact text); the maker's view shows counts and only the sent text.
Run tests/sandbox_server.py first. Usage: python3 tests/sedi_stuck.py [width] [shots-dir]"""
import sys
from playwright.sync_api import sync_playwright
W = int(sys.argv[1]) if len(sys.argv) > 1 else 1280
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
checks = []
def check(name, cond, info=''):
    checks.append(bool(cond)); print('PASS' if cond else 'FAIL', name, ('| ' + info) if info and not cond else '')
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': W, 'height': 860}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.goto('http://localhost:8766/?page=demo/index.html'); pg.wait_for_timeout(2200)
    f = pg.frame_locator('#f'); fr = pg.frames[1]; root = f.locator('clicky-lite-root')
    fr.evaluate("window.ClickyLiteDemoInsights && window.ClickyLiteDemoInsights.reset()")
    f.locator('.clicky-help').click(); pg.wait_for_timeout(400)
    check('stuck bar under the input', root.locator('.stuckbar').is_visible())
    inp = root.locator('.form input'); inp.fill('how do i set a reminder'); inp.press('Enter'); pg.wait_for_timeout(1300)
    if not root.locator('.card').count(): root.locator('.actions .primary').first.click(); pg.wait_for_timeout(900)
    check('walkthrough started', root.locator('.card').count() > 0)
    check('step card has stuck?', root.locator('.card .stuck').count() == 1)
    if SHOTS: pg.screenshot(path=f'{SHOTS}/stuck-card-{W}.png')
    popups = []; navs = []
    pg.context.on('page', lambda pp: popups.append(pp))
    pg.context.on('request', lambda r: r.is_navigation_request() and navs.append(r.url))
    check('stuck? is a link to heyclicky.com', root.locator('.card a.stuck').get_attribute('href') == 'https://www.heyclicky.com/')
    root.locator('.card .stuck').click(); pg.wait_for_timeout(1200)
    check('one click opens heyclicky.com in a new tab', len(popups) == 1 and 'https://www.heyclicky.com/' in navs, str(navs))
    for pp in popups: pp.close()
    popups.clear(); navs.clear()
    txt = root.locator('.sheet').inner_text() if root.locator('.sheet').count() else ''
    check('panel then says what was passed', 'how do i set a reminder' in txt and "you’re in Sedi" in txt and 'step 1 of 5' in txt, txt[:300])
    check('mockup note', 'mockup' in txt, txt[:200])
    if SHOTS: pg.screenshot(path=f'{SHOTS}/stuck-sheet-{W}.png')
    href = root.locator('.sheet a').first.get_attribute('href') if root.locator('.sheet a').count() else ''
    check('backup link is heyclicky.com', href == 'https://www.heyclicky.com/', str(href))
    root.locator('.sheet .actions button').click(); pg.wait_for_timeout(300)
    check('back closes sheet', root.locator('.sheet').count() == 0)
    # a question the docs don't cover
    inp.fill('can i sync sedi with my fitbit'); inp.press('Enter'); pg.wait_for_timeout(1500)
    body = root.locator('.body').inner_text()
    has_tell = root.locator('.handoff button', has_text='maker').count() > 0
    check('unanswered offers tell maker + full clicky', has_tell and root.locator('.handoff a', has_text='heyclicky.com').get_attribute('href') == 'https://www.heyclicky.com/', body[:300])
    check('bar under input links to heyclicky.com', root.locator('.stuckbar a').get_attribute('href') == 'https://www.heyclicky.com/')
    if has_tell:
        root.locator('.handoff button', has_text='maker').click(); pg.wait_for_timeout(300)
        check('share sheet shows exact text', root.locator('.sheet textarea').input_value() == 'can i sync sedi with my fitbit')
        if SHOTS: pg.screenshot(path=f'{SHOTS}/share-sheet-{W}.png')
        root.locator('.sheet .primary').click(); pg.wait_for_timeout(300)
        check('sent confirmation', 'sent' in root.locator('.sheet').inner_text())
    d = fr.evaluate("window.ClickyLiteDemoInsights.read()")
    check('counted answer by doc title', d['answered'].get('Add a reminder', 0) >= 1, str(d['answered']))
    check('counted unanswered without text', d['missing'] >= 1 and 'fitbit' not in str({k: v for k, v in d.items() if k != 'shared'}), str(d))
    check('shared text kept only because sent', any('fitbit' in s['text'] for s in d['shared']))
    check('hand-off counted', d['handoffs'] == 1, str(d['handoffs']))
    check('reminder never in counts as text', 'how do i set' not in str(d))
    root.locator('.head .icon-btn').first.click(); pg.wait_for_timeout(300)
    f.locator('#cl-maker').click(); pg.wait_for_timeout(400)
    mv = f.locator('.mv-card').inner_text()
    check('maker view opens with counts', 'add a reminder' in mv.lower() and 'fitbit' in mv, mv[:300])
    if SHOTS: pg.screenshot(path=f'{SHOTS}/maker-view-{W}.png')
    b.close()
print(f'\nwidth={W}: {sum(checks)}/{len(checks)}  page errors: {errs or "none"}')
