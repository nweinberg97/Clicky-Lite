# Clicky Lite: an embeddable Clicky for web apps (a mockup)

> **Not affiliated with Clicky.** Clicky Lite is a mockup by Nitai Weinberg, a paying Clicky user, made to share an idea and as a product sense case study. It isn't something he's launching, and it isn't a real or planned Clicky product, nor endorsed by or connected to Clicky (Hey Clicky) or its makers. Clicky and Hey Clicky are trademarks of their respective owner. The cursor buddy and mark here are original drawings, not Clicky's. The demo app, Sedi, is Nitai's own. Built on Navoro, Nitai's own separate project.

**If you're a builder, your users get a Clicky too.** Clicky Lite is an embeddable Clicky for web apps. The app maker adds it; the app's users don't install anything. It only sees that one app, already knows it from the app's own docs, and when someone asks "how do I…?", a small buddy shows them on screen, step by step.

**[Open the landing page and live demo →](https://nweinberg97.github.io/Clicky-Lite/)**

## Where this came from

I'm non-technical by background and mostly use Clicky to get unstuck: when I don't know how to do something, it shows me on screen. It's helped me build [40 prototypes](https://nweinberg97.github.io/Case-Studies/).

Then I wanted Clicky to really understand one of my own web apps, without connecting all my GitHub (some of it is private). In Claude I can link one specific repo; in Clicky I can't. So I wondered: what if Clicky lived *inside* the web app, already knowing that app and only seeing that app? And once you embed it, anyone using the app could get Clicky's help without downloading anything.

I'd already built this for my own apps as [Navoro](https://github.com/nweinberg97/Navoro). This repo is a mockup of what it could look like as Clicky. The demo is **Sedi**, one of my apps, which so far has a handful of users, mostly friends and family.

## The idea

- **Private by design.** It only sees that one app, nothing else: no other tabs, no files, no GitHub.
- **Knows the app already.** It learns from the app's docs and README, so users don't have to explain their situation.
- **Shows, doesn't just tell.** Ask how to do something and it walks you through it on screen, moving on as you actually click.
- **A growth loop for Clicky.** People try Clicky inside apps they already use, with no download. If they love it, they get the full Clicky.
- **Better than what's out there.** In-app tours (Pendo, WalkMe, Intercom) are scripted by hand and break when the app changes. Support chatbots repeat the docs back at you.

The full case (problem, who it's for, metrics, risks, rollout, what's deliberately left out) is on the landing page.

## The demo: Sedi with Clicky Lite as its help button

Open the demo, press **help** in Sedi's top right, and ask anything about Sedi. Things to try:

| Ask | What happens |
|---|---|
| How do I add a reminder? | A 5-step walkthrough. The buddy points at Timely, then Reminders, then each control, and moves on as you click. |
| Hey, how do I move cards between tools? | Open the card, Move to…, pick the tool, Save, with pointing at each step. |
| How do I use Taskly? | A short overview of Taskly, with a "show me" button that points at it. |
| Where is Brainly? | Points right at it. |
| Why can't I add more tasks? | Explains that Taskly columns never scroll on purpose, and what to do. |
| I found a bug | Hands off to Sedi's support, with the question filled in. |

If you wander off mid-walkthrough, Clicky Lite points at the way back ("first: Choose Timely…") and picks up where you left off. Steps about your own cards ("double-click the card") point at where your cards are without ever reading them.

Answers come from Sedi's real help center (75 walkthroughs). Most questions are matched right in the browser. Inside Claude's artifact viewer, a question it isn't sure about can be handed to Claude, which may only pick one of Sedi's own documented walkthroughs; it never invents a step or a button. On GitHub Pages it uses the in-browser matcher only.

**What it can't see:** anything you've written. Sedi's config blocks cards, notes, links, editors and the assistant; Clicky Lite reads only button names, the current tool and error messages.

## How it's built

Clicky Lite runs on the **Navoro engine** in its fully local mode, reskinned:

- `engine/sdk/src/`: the browser SDK (forked from Navoro). Clicky Lite adds the cursor buddy and step cards, the on-screen finder (`finder.ts`), routing to controls that are hidden or on another screen (`reveal.ts`), and an optional `chooser` hook.
- `engine/packages/engine/`: the on-device answer engine. Clicky Lite adds everyday-wording synonyms, overview answers ("how do I use Taskly?") and tie-breaks.
- `engine/server/knowledge/` and `engine/scripts/clicky-pack.ts`: turn Markdown help docs into a static knowledge pack, including `Also asked as:` phrasings.

### Files

| Path | What it is |
|---|---|
| `index.html`, `site.css`, `site.js`, `assets/` | Landing page and case study |
| `demo/` | Sedi (bundled into `demo/sedi.bundle.js`) with Clicky Lite as its help button |
| `demo/help/help-center.md` | Sedi's help center, the only source of answers |
| `demo/clicky.config.json` | Clicky Lite config: docs, privacy rules, greeting |
| `demo/clicky-pack.json`, `demo/clicky-pack.js` | Built knowledge pack (committed; the `.js` copy works in sandboxed viewers) |
| `sdk/clicky-lite.js` | Built SDK bundle (committed) |
| `engine/` | TypeScript sources (forked from Navoro) |
| `scripts/build.mjs`, `scripts/bundle-sedi.mjs` | Rebuild the SDK and pack; re-bundle Sedi |
| `tests/` | A viewer-like sandbox server and the test suites below |
| `demo-fernbill/` | An earlier demo on a made-up invoicing app, kept for reference |

## Running it

It's a static site; the built files are committed:

```sh
python3 -m http.server 8000
# open http://localhost:8000/ and http://localhost:8000/demo/
```

To change the help docs or the SDK (Node 22.18+, esbuild):

```sh
node scripts/build.mjs        # SDK + knowledge pack
node scripts/bundle-sedi.mjs  # after editing demo/js
```

### Testing

```sh
python3 tests/sandbox_server.py &          # strict-CSP site on :8765, sandboxed host on :8766
python3 tests/sedi_questions.py            # 120 everyday phrasings → right walkthrough
python3 tests/sedi_questions_fresh.py      # fresh phrasing sets (also _fresh2, _fresh3, _fresh4)
python3 tests/sedi_other.py                # troubleshooting, definitions, overviews, hand-offs, finder
python3 tests/sedi_sweep2.py 1280          # all 75 walkthroughs, clicked through from other screens
python3 tests/sedi_sweep2.py 600           # same at side-panel width
```

### Publishing on GitHub Pages

Settings → Pages → Deploy from a branch → `main`, `/ (root)`. The site appears at `https://nweinberg97.github.io/Clicky-Lite/`.

## Credits

Concept, mockup and case study by **Nitai Weinberg**. Built on Navoro. Sedi is Nitai's own app. No Clicky assets, logos or copy are used.
