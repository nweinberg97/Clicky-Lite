/**
 * Clicky Lite finder: "where is…", "find…", "show me…", "take me to…", or a bare noun
 * ("invoice 1045", "Harbor Ceramics", "settings") → the matching thing that is visible on
 * this screen, or a short route to it elsewhere in the app.
 *
 * READ-ONLY and LOCAL: it reads visible text and accessible names in memory, never input
 * values, and never anything inside a never-collect region (config ids/selectors,
 * data-clicky-sensitive, data-clicky-ignore). It only returns elements to point at.
 */
import type { GuidanceStep, KnowledgePack, PackPlace, PublicPrivacyPolicy } from '../../packages/contracts/src/sdk-types.ts';
import { stem } from '../../packages/engine/src/retrieve.ts';
import { cleanQuestion } from '../../packages/engine/src/answer.ts';
import { accessibleName, createBlinders, isInBlockedRegion, isNavoroUi, isVisible, type Blinders } from './dom.ts';

const STOP = new Set(
  'a an the my our your this that these those of to in on at for with from by and or is are was be it its me i we you please can could would will do does did should show find where wheres take bring go get open see look looking locate navigate point pointing at which what whats is there here page pages tab tabs screen section sections area menu list button buttons link links field fields thing stuff app fernbill one some any all just quickly again now currently'.split(
    ' ',
  ),
);
/** Words that describe the kind of thing rather than which one ("invoice 1045"). */
const SOFT = new Set(['invoic', 'client', 'payment', 'row', 'card', 'number', 'no', 'entry', 'record', 'item', 'name', 'amount', 'total']);

const LEAD =
  /^\s*(?:hey\s+clicky[,!]?\s+|clicky[,!]?\s+)?(?:please\s+)?(?:can|could|would)?\s*(?:you\s+)?(?:please\s+)?(?:where(?:'?s|\s+is|\s+are|\s+(?:do|can|should|would|could)\s+i(?:\s+(?:find|see|put|enter|type|add|change|set|pick|choose|go\s+to))?)?|find(?:\s+me)?|show\s+me|take\s+me(?:\s+to)?|bring\s+me(?:\s+to)?|go\s+to|get\s+me\s+to|open(?:\s+up)?|navigate\s+to|locate|point\s+(?:me\s+)?(?:at|to)|i(?:'?m|\s+am)\s+looking\s+for|look\s+for|how\s+do\s+i\s+(?:get\s+to|find|open)|i\s+can'?t\s+find)\b[\s:,]*/i;

const HOWTO = /^\s*(how|why|what|when|who|can i|should|does|do i|is it|are there|tell me|help|i need to|i want to)\b/i;
const VERB = /\b(send|create|make|add|set|turn|change|edit|update|delete|remove|resend|remind|chase|bill|charge|invite|download|export|print|pay|refund|cancel|save|connect|write|fix|cancel)\b/i;

export type FindIntent = 'explicit' | 'bare' | null;

export interface FindQuery {
  intent: FindIntent;
  /** What to look for, with "where is the…" stripped. */
  subject: string;
}

/** Splits "where's the payout account?" into intent + subject. */
export function parseFind(question: string): FindQuery {
  const q = question.trim().replace(/[?!.]+$/g, '');
  const lead = LEAD.exec(q);
  if (lead && lead[0].trim()) {
    const subject = q.slice(lead[0].length).trim();
    // "show me how to send an invoice" is a how-to, not a find.
    if (!subject || HOWTO.test(subject)) return { intent: null, subject: q };
    return { intent: 'explicit', subject };
  }
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && !HOWTO.test(q) && !VERB.test(q)) return { intent: 'bare', subject: q };
  return { intent: null, subject: q };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[’‘]/g, "'");
}

export function tokens(text: string): string[] {
  return (normalize(text).normalize('NFKD').match(/[a-z0-9]+/g) ?? []).filter((t) => !STOP.has(t)).map(stem);
}

interface Candidate {
  el: Element;
  name: string;
  toks: string[];
  interactive: boolean;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'IFRAME']);
const INTERACTIVE = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=switch],input:not([type=hidden]),select,textarea,summary';
const INLINE = new Set(['SPAN', 'B', 'STRONG', 'SMALL', 'EM', 'I', 'OUTPUT', 'CODE', 'MARK']);

/** Visible text of `el`, skipping hidden subtrees, form controls and every blocked region. */
function visibleText(el: Element, blinders: Blinders, max = 300): string {
  const view = el.ownerDocument.defaultView;
  let out = '';
  const walk = (node: Node): void => {
    if (out.length > max) return;
    if (node.nodeType === Node.TEXT_NODE) {
      out += ` ${node.nodeValue ?? ''}`;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as Element;
    if (SKIP.has(child.tagName.toUpperCase())) return;
    if (child.hasAttribute('hidden') || child.getAttribute('aria-hidden') === 'true') return;
    if (child !== el && isInBlockedRegion(child, blinders)) return;
    if (view && child !== el) {
      const style = view.getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'hidden') return;
    }
    for (const c of child.childNodes) walk(c);
  };
  walk(el);
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

function hasOwnText(el: Element): boolean {
  for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim()) return true;
  return false;
}

let policy: PublicPrivacyPolicy | null = null;
let extraPlaces: () => PackPlace[] = () => [];
let packRef: KnowledgePack | null = null;

/** Called once by the controller with the pack's privacy policy and the app's dynamic places. */
export function configureFinder(p: PublicPrivacyPolicy, pack: KnowledgePack | null, places?: () => PackPlace[]): void {
  policy = p;
  packRef = pack;
  if (places) extraPlaces = places;
}

function blinders(): Blinders {
  return createBlinders(document, policy?.blockedNavoroIds ?? [], policy?.blockedSelectors ?? []);
}

/** Everything on screen the finder may match against: visible, outside Clicky's UI and outside blocked regions. */
function collect(b: Blinders): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<Element>();
  const consider = (el: Element, interactive: boolean) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (isNavoroUi(el) || isInBlockedRegion(el, b) || !isVisible(el)) return;
    // Form controls are named by their label, never by their value.
    const name = interactive || el.matches('[data-clicky-id]') ? accessibleName(el) || visibleText(el, b) : visibleText(el, b);
    if (!name) return;
    const toks = tokens(name);
    if (toks.length) out.push({ el, name, toks, interactive });
  };
  for (const el of document.body.querySelectorAll(INTERACTIVE)) consider(el, true);
  for (const el of document.body.querySelectorAll('[data-clicky-id],h1,h2,h3,h4,label,th,td,li,dt,dd,legend')) consider(el, false);
  for (const el of document.body.querySelectorAll('span,b,strong,small,p,div,output')) if (hasOwnText(el)) consider(el, false);
  return out;
}

/** Moves a match to the thing a person would call "it": the table row, the card, the control. */
function promote(el: Element, b: Blinders): Element {
  const row = el.closest('tr');
  if (row && row.closest('tbody') && !isInBlockedRegion(row, b)) {
    // Don't draw a highlight around a never-read cell (private notes): point at the cell instead.
    const holdsBlocked = [...row.querySelectorAll('*')].some((child) => isInBlockedRegion(child, b));
    return holdsBlocked ? (el.closest('td,th') ?? el) : row;
  }
  let cur = el;
  for (let i = 0; i < 3 && INLINE.has(cur.tagName); i += 1) {
    const up = cur.closest('a[href],button,label,li,[data-clicky-id],h1,h2,h3');
    if (up && up !== cur && !isInBlockedRegion(up, b) && !isNavoroUi(up)) return up;
    const parent = cur.parentElement;
    if (!parent || parent === document.body || isInBlockedRegion(parent, b)) break;
    if (tokens(visibleText(parent, b)).length > 14) break;
    cur = parent;
  }
  return cur;
}

export interface ScreenHit {
  element: Element;
  label: string;
  quality: number;
}

/** Best visible match for `subject` on this screen, or null. */
export function findOnScreen(subject: string): ScreenHit | null {
  const b = blinders();
  const cands = collect(b);
  const vocab = new Set<string>();
  for (const c of cands) for (const w of normalize(c.name).match(/[a-z]+/g) ?? []) vocab.add(w);
  for (const p of allPlaces()) for (const w of normalize(p.label).match(/[a-z]+/g) ?? []) vocab.add(w);
  const cleaned = packRef ? cleanQuestion(packRef, subject, vocab) : subject;
  const q = [...new Set(tokens(cleaned))];
  if (!q.length) return null;
  const hard = q.filter((t) => !SOFT.has(t));
  const need = hard.length ? hard : q;
  const want = normalize(cleaned).replace(/[^a-z0-9]+/g, ' ').trim();
  let best: { c: Candidate; score: number; quality: number } | null = null;
  for (const c of cands) {
    const set = new Set(c.toks);
    if (!need.every((t) => set.has(t))) continue;
    const soft = q.filter((t) => SOFT.has(t) && set.has(t)).length;
    const quality = (need.length + (hard.length ? soft : 0)) / c.toks.length;
    const exact = normalize(c.name).replace(/[^a-z0-9]+/g, ' ').trim() === want;
    const score = quality + (exact ? 1 : 0) + (c.interactive ? 0.3 : 0) + (c.el.hasAttribute('data-clicky-id') ? 0.2 : 0);
    if (!best || score > best.score + 1e-9) best = { c, score, quality };
  }
  if (!best) return null;
  return { element: promote(best.c.el, b), label: best.c.name.slice(0, 60), quality: best.quality };
}

function allPlaces(): PackPlace[] {
  let dynamic: PackPlace[] = [];
  try {
    dynamic = extraPlaces() ?? [];
  } catch {
    dynamic = [];
  }
  // The app's own places (specific records) first, so they win ties against general pages.
  return [...dynamic, ...(packRef?.places ?? [])];
}

export interface PlaceHit {
  place: PackPlace;
  score: number;
}

/** Best known place (from the pack or the app) for `subject`. */
export function findPlace(subject: string): PlaceHit | null {
  const places = allPlaces();
  const vocab = new Set<string>();
  for (const p of places) for (const w of normalize([p.label, ...(p.keywords ?? [])].join(' ')).match(/[a-z]+/g) ?? []) vocab.add(w);
  const cleaned = packRef ? cleanQuestion(packRef, subject, vocab) : subject;
  const q = [...new Set(tokens(cleaned))];
  if (!q.length) return null;
  const hard = q.filter((t) => !SOFT.has(t));
  const need = hard.length ? hard : q;
  let best: PlaceHit | null = null;
  for (const place of places) {
    for (const phrase of [place.label, ...(place.keywords ?? [])]) {
      const pt = new Set(tokens(phrase));
      if (!pt.size) continue;
      const covered = need.every((t) => pt.has(t));
      const contained = [...pt].every((t) => q.includes(t));
      if (!covered && !contained) continue;
      const overlap = q.filter((t) => pt.has(t)).length;
      const score = overlap / new Set([...q, ...pt]).size + (covered && contained ? 1 : 0);
      if (!best || score > best.score) best = { place, score };
    }
  }
  return best;
}

function regionOnScreen(place: PackPlace): boolean {
  const region = (place as PackPlace & { region?: string }).region;
  if (!region) return false;
  try {
    const el = /^[.#[]/.test(region) ? document.querySelector(region) : document.querySelector(`[data-clicky-id="${CSS.escape(region)}"]`);
    return Boolean(el && isVisible(el));
  } catch {
    return false;
  }
}

function navStep(id: string, index: number, place: PackPlace): GuidanceStep {
  const el = document.querySelector(`[data-clicky-id="${CSS.escape(id)}"]`);
  const name = (el ? accessibleName(el) : '') || id;
  return {
    index,
    title: `Open ${name}`,
    instruction: `${place.label} is on the ${name} page. Open ${name} and I’ll show you.`,
    target: { key: `nav:${id}`, label: name, strategies: [{ type: 'navoro_id', value: id }], confidence: 0.95, validation: 'valid' },
    targetNote: null,
  };
}

export function hereStep(label: string, index: number, subject: string): GuidanceStep {
  return {
    index,
    title: `Here’s “${label}”`,
    instruction: 'Found it. I only point; the clicking is up to you.',
    target: { key: `find:${subject}`, label, strategies: [{ type: 'find', value: subject }], confidence: 0.9, validation: 'valid' },
    targetNote: null,
  };
}

export interface FinderAnswer {
  answer: string;
  steps: GuidanceStep[];
  /** True when the user asked about a region Clicky Lite never reads. */
  blocked?: boolean;
}

/** Names of never-read regions, from their own labels or (for table cells) their column header. */
function blockedNames(b: Blinders): Array<{ name: string; toks: string[] }> {
  const out: Array<{ name: string; toks: string[] }> = [];
  const els = new Set<Element>();
  for (const id of b.blockedIds) for (const el of document.querySelectorAll(`[data-clicky-id="${CSS.escape(id)}"]`)) els.add(el);
  for (const sel of b.selectors) {
    try {
      for (const el of document.querySelectorAll(sel)) els.add(el);
    } catch {
      // ignore
    }
  }
  for (const el of document.querySelectorAll('[data-clicky-sensitive]')) els.add(el);
  for (const el of els) {
    let name = '';
    const by = el.getAttribute('aria-labelledby');
    if (by) name = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    name ||= el.getAttribute('aria-label') ?? '';
    if (!name && el instanceof HTMLTableCellElement) {
      const th = el.closest('table')?.querySelectorAll('thead th')[el.cellIndex];
      name = th?.textContent ?? '';
    }
    name = name.trim();
    if (name && !out.some((n) => n.name === name)) out.push({ name, toks: tokens(name) });
  }
  return out;
}

/**
 * Answers a find question: an on-screen hit, a route to a known place, a privacy refusal,
 * or null when nothing matches. `strict` (for questions that weren't phrased as a find)
 * only accepts strong on-screen matches and exact places.
 */
export function answerFind(subject: string, strict = false): FinderAnswer | null {
  const q = new Set(tokens(packRef ? cleanQuestion(packRef, subject) : subject));
  for (const blocked of blockedNames(blinders())) {
    if (blocked.toks.length && blocked.toks.every((t) => q.has(t))) {
      return { answer: `${blocked.name} is something Clicky Lite is set never to read or point at, so I can’t look there for you.`, steps: [], blocked: true };
    }
  }
  const place = findPlace(subject);
  // Private places first: say where it is, but never read or point inside it.
  if (place && place.place.private && place.score >= 1) {
    const label = place.place.label;
    if (regionOnScreen(place.place)) {
      return { answer: `${label} is on this page, but Clicky Lite is set never to read or point inside it, so you’ll need to look there yourself.`, steps: [], blocked: true };
    }
    const steps = place.place.via.map((id, i) => navStep(id, i, place.place));
    return { answer: `${label} is on another page. I can take you there, but I never look inside that section.`, steps, blocked: true };
  }
  const hit = findOnScreen(subject);
  const goodHit = hit && (hit.quality >= (strict ? 0.5 : 0.3) || !place);
  if (hit && goodHit && !(strict && hit.quality < 0.5)) {
    return { answer: `Here’s “${hit.label}” on this page.`, steps: [hereStep(hit.label, 0, subject)] };
  }
  if (place && (!strict || place.score >= 1)) {
    const find = place.place.find ?? place.place.label;
    const already = findOnScreen(find);
    if (already && already.quality >= 0.5) return { answer: `Here’s “${already.label}” on this page.`, steps: [hereStep(already.label, 0, find)] };
    const steps = place.place.via.map((id, i) => navStep(id, i, place.place));
    const viaOnly = place.place.via.length === 1 && normalize(find) === normalize(steps[0]?.target?.label ?? '');
    if (!viaOnly) steps.push(hereStep(place.place.label, steps.length, find));
    return { answer: viaOnly ? `Here’s ${place.place.label}.` : `${place.place.label} isn’t on this page. I’ll show you the way: ${steps.length} steps.`, steps };
  }
  if (hit && !strict) return { answer: `Here’s “${hit.label}” on this page.`, steps: [hereStep(hit.label, 0, subject)] };
  return null;
}

/** Resolver hook for `find` targets: the element to point at right now, if visible. */
export function resolveFind(subject: string): Element | null {
  return findOnScreen(subject)?.element ?? null;
}
