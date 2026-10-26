/**
 * Clicky Lite: hidden targets. When a step's control exists but is tucked away (a folded
 * menu, a toolbar that fades in on hover, a collapsed panel), point at what reveals it
 * first instead of giving up. Clicky Lite still never clicks: it only shows the way.
 *
 * How the revealer is found, most specific first:
 * 1. The app says so: a hidden container (or an ancestor) carries data-clicky-reveal="<selector>"
 *    and optionally data-clicky-reveal-say="what to tell the user".
 * 2. Standard disclosure markup: a visible control with aria-controls pointing at the hidden
 *    container, or a visible aria-expanded="false" control right next to it.
 * 3. Otherwise the hidden area itself is the place to hover (menus that appear on hover).
 */
import { accessibleName } from './dom.ts';

export interface Reveal {
  /** What to point at: the revealing control, or the hidden area to hover. */
  anchor: Element;
  /** True when the anchor is the hidden area itself (hover), not a control to click. */
  hover: boolean;
  /** One sentence for the step card. */
  say: string;
}

function shown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || Number.parseFloat(s.opacity) < 0.05 || n.hasAttribute('hidden')) return false;
  }
  return true;
}

/** The outermost ancestor (or the element) whose own styles hide it. */
function hidingAncestor(el: Element): Element | null {
  let found: Element | null = null;
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.display === 'none' || Number.parseFloat(s.opacity) < 0.05 || n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true' || s.visibility === 'hidden') found = n;
  }
  return found;
}

function laidOut(el: Element | null): Element | null {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return n;
  }
  return null;
}

export function findReveal(target: Element): Reveal | null {
  const hider = hidingAncestor(target);
  if (!hider) return null;
  const tagged = target.closest('[data-clicky-reveal],[data-clicky-reveal-say]');
  const say = tagged?.getAttribute('data-clicky-reveal-say') || '';
  // 1. The app names the revealer.
  const sel = tagged?.getAttribute('data-clicky-reveal');
  if (sel) {
    try {
      const el = document.querySelector(sel);
      if (el && shown(el)) return { anchor: el, hover: false, say: say || `It’s tucked away. Click ${accessibleName(el) || 'here'} first to show it.` };
    } catch { /* bad selector: fall through */ }
  }
  // 2. Disclosure controls: aria-controls, or a collapsed toggle next to the hidden part.
  const ids = [hider, ...hider.querySelectorAll('[id]')].map((n) => n.id).filter(Boolean);
  for (const id of ids) {
    const ctl = document.querySelector(`[aria-controls~="${CSS.escape(id)}"]`);
    if (ctl && shown(ctl)) return { anchor: ctl, hover: false, say: `It’s tucked away. Click ${accessibleName(ctl) || 'this'} first to show it.` };
  }
  for (let scope: Element | null = hider.parentElement, depth = 0; scope && depth < 3; scope = scope.parentElement, depth++) {
    const toggle = [...scope.querySelectorAll('[aria-expanded="false"]')].find((c) => !hider.contains(c) && shown(c));
    if (toggle) {
      const name = accessibleName(toggle);
      return { anchor: toggle, hover: false, say: `It’s tucked away. Click ${name ? `“${name}”` : 'this'} first to show it.` };
    }
  }
  // 3. Hover: point at the hidden area itself.
  const area = laidOut(hider);
  if (!area) return null;
  return { anchor: area, hover: true, say: say || 'It’s tucked away here. Move your pointer over this spot to show it.' };
}
