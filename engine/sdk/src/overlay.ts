/**
 * Overlay engine: one isolated shadow root for all Navoro UI, a spotlight ring
 * around the current target and an anchored step card.
 *
 * READ-ONLY BOUNDARY: the overlay only *reads* host geometry and *scrolls* the
 * target into view. It never clicks, focuses, types into, submits or mutates any
 * host element, and every overlay surface except the step card itself is
 * pointer-events:none, so the host app stays fully usable underneath.
 */
import type { GuidanceStep } from '../../packages/contracts/src/sdk-types.ts';
import { HOST_ATTR, isVisible } from './dom.ts';
import type { Reveal } from './reveal.ts';
import { btn, closeBtn, h, prefersReducedMotion, svg } from './h.ts';
import { BUDDY_SVG, STYLES } from './styles.ts';

export interface NavoroRoot {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** Container for every Navoro surface (carries theme variables). */
  container: HTMLDivElement;
  destroy(): void;
}

/** Creates the single host element (appended to <body>) with an open shadow root. */
export function createRoot(
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left',
  offset: number | null = null,
  accent: { accent: string; onAccent: string } | null = null,
): NavoroRoot {
  const host = document.createElement('clicky-lite-root');
  host.setAttribute(HOST_ATTR, '');
  host.setAttribute('data-clicky-ignore', '');
  // `all: initial` isolates from inherited host styles; huge z-index keeps us on top.
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'open' });
  const classes = ['root'];
  if (position.endsWith('left')) classes.push('left');
  if (position.startsWith('top')) classes.push('top');
  const container = h('div', { class: classes.join(' ') });
  // Host apps pass their header height so the panel sits just under it.
  if (offset) container.style.setProperty('--edge', `${offset}px`);
  // The host's brand colour replaces Navoro's lime for highlights, progress and checkmarks.
  if (accent) {
    container.style.setProperty('--lime', accent.accent);
    container.style.setProperty('--on-accent', accent.onAccent);
  }
  // Constructable stylesheets are not subject to the host page's style-src CSP, so Navoro
  // works on hosts that forbid inline styles. Fall back to a <style> element elsewhere.
  let adopted = false;
  try {
    if ('adoptedStyleSheets' in shadow && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      shadow.adoptedStyleSheets = [sheet];
      adopted = true;
    }
  } catch {
    adopted = false;
  }
  if (!adopted) {
    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.append(style);
  }
  shadow.append(container);
  document.body.append(host);
  return {
    host,
    shadow,
    container,
    destroy: () => host.remove(),
  };
}

export interface StepView {
  step: GuidanceStep;
  index: number;
  total: number;
  /** Resolved element, or null when the target could not be found. */
  element: Element | null;
  /** Plain-text name of what we were looking for (for the missing message). */
  lookingFor: string | null;
  onBack(): void;
  onNext(): void;
  onClose(): void;
  /** Re-run the resolver; return the new element or null. */
  relocate(): Element | null;
  /** Optional context line, e.g. "You're already past step 2 — picking up here." */
  note?: string | null;
  /** Clicky Lite: the target exists but is tucked away; point at what reveals it first. */
  reveal?: Reveal | null;
  /** Clicky Lite: the highlighted control went away (the user navigated); re-plan instead of stopping. */
  onLost?: () => void;
}

const GAP = 40; // room for the buddy between the control and its speech bubble
const MARGIN = 8;

type Placement = 'below' | 'above' | 'right' | 'left';

/** Pure placement maths: picks the first side that fits, then clamps into the viewport. */
export function placeCard(
  target: { top: number; left: number; bottom: number; right: number; width: number; height: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; placement: Placement } {
  const fits: Record<Placement, boolean> = {
    below: target.bottom + GAP + card.height <= viewport.height - MARGIN,
    above: target.top - GAP - card.height >= MARGIN,
    right: target.right + GAP + card.width <= viewport.width - MARGIN,
    left: target.left - GAP - card.width >= MARGIN,
  };
  const order: Placement[] = ['below', 'above', 'right', 'left'];
  const placement = order.find((p) => fits[p]) ?? 'below';
  let top: number;
  let left: number;
  if (placement === 'below' || placement === 'above') {
    top = placement === 'below' ? target.bottom + GAP : target.top - GAP - card.height;
    left = target.left + target.width / 2 - card.width / 2;
  } else {
    left = placement === 'right' ? target.right + GAP : target.left - GAP - card.width;
    top = target.top + target.height / 2 - card.height / 2;
  }
  const clamp = (v: number, max: number) => Math.min(Math.max(v, MARGIN), Math.max(MARGIN, max - MARGIN));
  return { top: clamp(top, viewport.height - card.height), left: clamp(left, viewport.width - card.width), placement };
}

export class Overlay {
  readonly #root: NavoroRoot;
  readonly #layer: HTMLDivElement;
  #ring: HTMLDivElement | null = null;
  #card: HTMLDivElement | null = null;
  #target: Element | null = null;
  #view: StepView | null = null;
  #raf = 0;
  #resizeObs: ResizeObserver | null = null;
  #mutationObs: MutationObserver | null = null;
  #listening = false;
  #pulsed = new WeakSet<Element>();
  /** Clicky Lite: the cursor buddy that flies to each control and points at it. */
  readonly #buddy: HTMLDivElement;
  readonly #onFrame = () => this.#schedule();

  constructor(root: NavoroRoot) {
    this.#root = root;
    this.#layer = h('div', { class: 'layer', 'data-clicky-layer': '' });
    this.#buddy = h('div', { class: 'buddy home', 'aria-hidden': 'true', 'data-clicky-buddy': '' }, svg(BUDDY_SVG));
    root.container.append(this.#layer, this.#buddy);
    this.#goHome();
  }

  /** Parks the buddy on the app's Clicky button (or the floating launcher), hidden, ready to fly out. */
  #goHome(): void {
    const b = this.#buddy;
    b.classList.add('home');
    const trigger = document.querySelector('[data-clicky-trigger]')?.getBoundingClientRect();
    const x = trigger && trigger.width > 0 ? trigger.left + trigger.width / 2 - 22 : innerWidth - 64;
    const y = trigger && trigger.width > 0 ? trigger.top + trigger.height / 2 - 22 : innerHeight - 64;
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(.4)`;
  }

  /** Flies the buddy next to the target, on the side facing the speech bubble, pointing at it. */
  #flyTo(r: DOMRect, placement: Placement): void {
    const b = this.#buddy;
    const size = 44;
    let x: number;
    let y: number;
    let angle: number; // direction the pointer nub faces (deg, 0 = up)
    // Like a cursor: perch on the target's corner nearest the speech bubble, nub pointing in.
    if (placement === 'below') {
      x = r.left + Math.min(r.width - 18, 150);
      y = r.bottom - 10;
      angle = -45;
    } else if (placement === 'above') {
      x = r.left + Math.min(r.width - 18, 150);
      y = r.top - size + 10;
      angle = -135;
    } else if (placement === 'right') {
      x = r.right - 10;
      y = r.top + r.height / 2 - 4;
      angle = -60;
    } else {
      x = r.left - size + 10;
      y = r.top + r.height / 2 - 6;
      angle = 45;
    }
    const vw = document.documentElement.clientWidth || innerWidth;
    x = Math.min(Math.max(4, x), vw - size - 4);
    y = Math.min(Math.max(4, y), innerHeight - size - 4);
    b.classList.remove('home');
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    b.style.setProperty('--nub', `${angle}deg`);
  }

  /** The step being shown (Clicky Lite: used to re-plan after the target goes away). */
  get view(): StepView | null {
    return this.#view;
  }

  /** The step card element (for focus management and tests). */
  get card(): HTMLDivElement | null {
    return this.#card;
  }

  get active(): boolean {
    return this.#view !== null;
  }

  /** Shows a step: highlights the element when present, otherwise a docked card. */
  show(view: StepView, focusCard = this.#root.shadow.activeElement !== null): void {
    this.#teardownTracking();
    this.#ring?.remove();
    this.#ring = null;
    this.#view = view;
    this.#revealing = false;
    if (view.element) this.#attach(view.element);
    else if (view.reveal) {
      this.#revealing = true;
      this.#attach(view.reveal.anchor);
    } else {
      this.#renderCard(null);
      this.#goHome();
    }
    // Focus only ever moves between Navoro's own controls, never away from host inputs.
    if (focusCard) this.#focusPrimary();
  }

  /** Clicky Lite: while a step's control is missing, update where we point to reveal it. */
  updateReveal(reveal: Reveal | null): void {
    const view = this.#view;
    if (!view || view.element) return;
    if ((view.reveal?.anchor ?? null) === (reveal?.anchor ?? null)) return;
    this.show({ ...view, reveal }, false);
  }

  /** Re-resolves the current step's target (e.g. after navigation) and re-attaches if found. */
  relocate(): boolean {
    const view = this.#view;
    if (!view) return false;
    const element = view.relocate();
    if (!element) return false;
    this.show({ ...view, element }, false);
    return true;
  }

  /** Removes ring, card and every listener/observer. */
  hide(): void {
    this.#teardownTracking();
    this.#view = null;
    this.#layer.replaceChildren();
    this.#goHome();
    this.#ring = null;
    this.#card = null;
  }

  destroy(): void {
    this.hide();
    this.#layer.remove();
    this.#buddy.remove();
  }

  #focusPrimary(): void {
    const btn = this.#card?.querySelector<HTMLButtonElement>('[data-primary]');
    btn?.focus({ preventScroll: true });
  }

  #revealing = false;

  #attach(element: Element): void {
    this.#target = element;
    const reduced = prefersReducedMotion();
    const rect = element.getBoundingClientRect();
    const offscreen = rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth;
    const partially = rect.top < 0 || rect.bottom > innerHeight;
    if (offscreen || partially) {
      // Scrolling is the only side effect we have on the host page — viewing, not acting.
      element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
    this.#ring = h('div', { class: 'ring', 'data-clicky-spotlight': '', 'aria-hidden': 'true' });
    this.#ring.style.pointerEvents = 'none';
    this.#renderCard(element);
    this.#layer.prepend(this.#ring);
    if (!reduced && !this.#pulsed.has(element)) {
      this.#pulsed.add(element);
      this.#ring.classList.add('pulse');
      // The "Found it." tag rides on the ring, so it needs no positioning of its own.
      // Clicky Lite: the buddy itself says "here"; no text tag on the ring.
    }
    this.#startTracking(element);
    this.#position();
  }

  #renderCard(element: Element | null): void {
    const view = this.#view;
    if (!view) return;
    const { step, index, total } = view;
    const isLast = index >= total - 1;
    const revealing = this.#revealing && !!view.reveal;
    const missing = !element;
    const titleId = 'navoro-step-title';
    // A server note without a target explains why the control was withheld (e.g. a broken
    // mapping awaiting review); don't also claim the step has no control.
    const missingText = missing && !(view.note ?? '').startsWith('Already done')
      ? [
          view.lookingFor
            ? /\bhover\b/i.test(step.instruction)
              ? `“${view.lookingFor}” shows up when you hover over one of your items. I never read your items, so hover one and I’ll point at it as soon as it appears.`
              : `I can’t see “${view.lookingFor}” yet. Do the step before this one, and I’ll point at it as soon as it appears.`
            : step.targetNote ? '' : 'This step doesn’t point at a specific control.',
          step.targetNote ?? '',
        ]
          .join(' ')
          .trim()
      : '';
    const card = h(
      'div',
      { class: missing ? 'card docked' : 'card', role: 'group', 'aria-labelledby': titleId, 'data-clicky-card': '' },
      h(
        'div',
        { class: 'top' },
        h('span', { class: 'count' }, `Step ${index + 1} of ${total}`),
        closeBtn('Close walkthrough', () => view.onClose()),
      ),
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round(((index + 1) / total) * 100)}%` })),
      view.note ? h('div', { class: 'resume' }, view.note) : null,
      h('h3', { id: titleId }, step.title),
      h('p', {}, step.instruction),
      revealing ? h('div', { class: 'first', role: 'status' }, h('b', {}, 'first: '), view.reveal!.say) : missing && missingText ? h('div', { class: 'miss', role: 'status' }, missingText) : null,
      h(
        'div',
        { class: 'nav' },
        btn('btn ghost', 'Back', () => view.onBack(), { disabled: index === 0 }),
        btn('btn primary', isLast ? 'Done' : 'Next', () => view.onNext(), { 'data-primary': true }),
      ),
    );
    this.#card?.remove();
    this.#card = card;
    this.#layer.append(card);
  }

  #renderLost(): void {
    const view = this.#view;
    const card = this.#card;
    if (!view || !card) return;
    if (view.onLost) {
      this.#teardownTracking();
      view.onLost();
      return;
    }
    this.#teardownTracking();
    this.#ring?.remove();
    this.#ring = null;
    card.classList.add('docked');
    this.#goHome();
    card.style.top = '';
    card.style.left = '';
    card.querySelector('.miss')?.remove();
    const retry = btn('btn secondary', 'Find it again', () => {
      const el = view.relocate();
      if (el) this.show({ ...view, element: el }, true);
    });
    const msg = h('div', { class: 'miss', role: 'status' }, 'That control isn’t on screen anymore.');
    card.querySelector('.nav')?.before(msg, h('div', { class: 'actions' }, retry));
  }

  #startTracking(element: Element): void {
    if (!this.#listening) {
      addEventListener('scroll', this.#onFrame, { capture: true, passive: true });
      addEventListener('resize', this.#onFrame, { passive: true });
      this.#listening = true;
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObs = new ResizeObserver(this.#onFrame);
      this.#resizeObs.observe(element);
    }
    // Only while a target is highlighted: detect it being removed or hidden.
    this.#mutationObs = new MutationObserver(this.#onFrame);
    this.#mutationObs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'open'],
    });
  }

  #teardownTracking(): void {
    if (this.#listening) {
      removeEventListener('scroll', this.#onFrame, { capture: true });
      removeEventListener('resize', this.#onFrame);
      this.#listening = false;
    }
    this.#resizeObs?.disconnect();
    this.#resizeObs = null;
    this.#mutationObs?.disconnect();
    this.#mutationObs = null;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#target = null;
  }

  #schedule(): void {
    if (this.#raf) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#position();
    });
  }

  #position(): void {
    const target = this.#target;
    if (!target || !this.#ring || !this.#card) return;
    const box = target.getBoundingClientRect();
    if (this.#revealing ? box.width <= 0 || box.height <= 0 : !isVisible(target)) {
      this.#renderLost();
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 4;
    Object.assign(this.#ring.style, {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const card = this.#card;
    const size = { width: card.offsetWidth || 300, height: card.offsetHeight || 160 };
    const spot = placeCard(
      { top: r.top - pad, left: r.left - pad, bottom: r.bottom + pad, right: r.right + pad, width: r.width + pad * 2, height: r.height + pad * 2 },
      size,
      { width: document.documentElement.clientWidth || innerWidth, height: innerHeight },
    );
    card.style.top = `${spot.top}px`;
    card.style.left = `${spot.left}px`;
    card.dataset.side = spot.placement;
    this.#flyTo(r, spot.placement);
  }
}
