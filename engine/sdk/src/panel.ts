/**
 * Launcher button and assistance panel. A pure view: it renders a SessionState
 * and reports user intent through callbacks. All server-provided text is set via
 * textContent (see h.ts) — never innerHTML.
 *
 * The panel is a non-modal dialog (aria-modal="false"): it never traps focus or
 * blocks the host page.
 */
import type { GuidanceResult, PublicSdkConfig, SanitizedContext } from '../../packages/contracts/src/sdk-types.ts';
import { btn, closeBtn, h, ICON_CHECK, svg } from './h.ts';
import type { NavoroRoot } from './overlay.ts';
import { IN_FLIGHT, type SessionState } from './state-machine.ts';
import { markSvg } from './styles.ts';
import { safeHttpUrl, safeLinkUrl } from './text.ts';

export interface PanelCallbacks {
  onOpen(): void;
  onClose(): void;
  onAsk(question: string): void;
  onStop(): void;
  onRetry(): void;
  onStartWalkthrough(): void;
  onFeedback(helpful: boolean): void;
  /** Fired whenever the panel opens or closes, by any path. */
  onToggle?(open: boolean): void;
  /** Mic pressed: start or stop a spoken question. */
  onVoice?(): void;
  /** Clicky Lite: hand off to the full Clicky with only what the sheet shows. May return a note to show. */
  onStuck?(handoff: StuckHandoff): StuckResult | void;
  /** Clicky Lite: the user chose to send this exact text to the app's maker. */
  onShare?(text: string): void;
  /** Clicky Lite: where "open the full clicky" goes (a real link, so it works even in sandboxed pages). */
  stuckUrl?: string;
}

export interface StuckHandoff {
  question: string;
  app: string;
  step: string | null;
}
export interface StuckResult {
  note: string;
  linkLabel?: string;
  linkUrl?: string;
}

type Sheet =
  | { kind: 'stuck'; question: string; step: string | null; result?: StuckResult | null; opened?: boolean }
  | { kind: 'share'; text: string; sent?: boolean };

export interface PanelExtras {
  /** Last transmitted payload — shown only in development. */
  lastPayload: SanitizedContext | null;
  showInspector: boolean;
  feedbackGiven: 'helpful' | 'not_helpful' | null;
  /** Local mode: answers come from the on-device engine and nothing is sent. */
  local: boolean;
}

const ICON_MIC =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><rect x="5.5" y="1.75" width="5" height="8" rx="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

const PHASE_TEXT: Record<string, string> = {
  retrieving: 'Looking through the docs…',
  reasoning: 'Working out the steps…',
  validating: 'Checking it against this page…',
};

export class Panel {
  readonly launcher: HTMLButtonElement;
  readonly #panel: HTMLDivElement;
  readonly #body: HTMLDivElement;
  readonly #input: HTMLInputElement;
  readonly #submit: HTMLButtonElement;
  readonly #live: HTMLDivElement;
  readonly #cb: PanelCallbacks;
  readonly #config: PublicSdkConfig;
  #open = false;
  #lastAnnounced = '';
  #sheet: Sheet | null = null;
  #last: { state: SessionState; extras: PanelExtras } | null = null;
  #stuckBar: HTMLDivElement | null = null;

  #hiddenLauncher: boolean;
  #head!: HTMLDivElement;
  #ghost!: HTMLDivElement;
  #moved: { x: number; y: number } | null = null;
  #home: DOMRect | null = null;
  readonly #mic: HTMLButtonElement;
  /** Host element that opened the panel (hidden-launcher mode) so focus can return to it. */
  #opener: HTMLElement | null = null;

  constructor(root: NavoroRoot, config: PublicSdkConfig, hiddenLauncher: boolean, cb: PanelCallbacks) {
    this.#cb = cb;
    this.#config = config;
    this.#hiddenLauncher = hiddenLauncher;
    const titleId = 'navoro-panel-title';
    this.launcher = h(
      'button',
      {
        class: 'launcher',
        type: 'button',
        'aria-label': 'Ask Clicky',
        'aria-expanded': 'false',
        'aria-controls': 'navoro-panel',
        'data-clicky-launcher': '',
        onclick: () => (this.#open ? cb.onClose() : cb.onOpen()),
      },
      svg(markSvg(26)),
    );
    this.#input = h('input', {
      type: 'text',
      autocomplete: 'off',
      enterkeyhint: 'send',
      maxlength: 500,
      placeholder: 'Ask Clicky how to do something…',
      'aria-label': 'Your question',
    });
    this.#submit = h('button', { class: 'btn primary', type: 'submit' }, 'Ask');
    this.#mic = h('button', { class: 'mic', type: 'button', 'aria-label': 'Ask by voice', 'aria-pressed': 'false', hidden: true, onclick: () => cb.onVoice?.() }, svg(ICON_MIC));
    const form = h('form', { class: 'form', novalidate: true }, this.#input, this.#mic, this.#submit);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = this.#input.value.trim();
      if (q) cb.onAsk(q);
    });
    this.#body = h('div', { class: 'body' });
    this.#live = h('div', { class: 'sr', role: 'status', 'aria-live': 'polite' });
    this.#panel = h(
      'div',
      {
        id: 'navoro-panel',
        class: 'panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-labelledby': titleId,
        hidden: true,
        'data-clicky-panel': '',
      },
      (this.#head = h(
        'div',
        { class: 'head', title: 'Drag to move · double-click to put back' },
        svg(markSvg(28, true)),
        h('div', { class: 'name' }, h('h2', { id: titleId }, 'clicky lite'), h('div', { class: 'by' }, `Your guide in ${config.applicationName || 'this app'}`)),
        closeBtn('Close Clicky', () => cb.onClose()),
      )),
      this.#body,
      form,
      (this.#stuckBar = cb.onStuck
        ? h('div', { class: 'stuckbar' },
            h('span', {}, `Stuck, or not about ${config.applicationName || 'this app'}? The full Clicky lives on your computer and can help with anything.`),
            this.#stuckAction('link', () => this.#last?.state ?? null))
        : null),
      this.#live,
    );
    root.container.append(this.#panel);
    if (!hiddenLauncher) root.container.append(this.launcher);
    this.#ghost = h('div', { class: 'home-ghost', 'aria-hidden': 'true' });
    root.container.append(this.#ghost);
    this.#makeMovable();
  }

  /**
   * Desktop: drag the panel by its header so it never sits on top of what you need.
   * The spot is kept only in memory for this page (Navoro stores nothing). While dragging, a
   * dashed outline marks the panel's usual place; dropping near it, or double-clicking the
   * header, puts it back exactly. Phones keep the full-width sheet.
   */
  #makeMovable(): void {
    const head = this.#head;
    const panel = this.#panel;
    const phone = () => matchMedia('(max-width:480px)').matches;
    let start: { x: number; y: number; ox: number; oy: number; moved: boolean; id: number } | null = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || phone() || (e.target as Element).closest('button')) return;
      const r = panel.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false, id: e.pointerId };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
      if (!start.moved) {
        start.moved = true;
        this.#showHome();
        panel.classList.add('moving', 'placed');
      }
      this.#place(e.clientX - start.ox, e.clientY - start.oy);
      this.#nearHome();
    });
    const end = () => {
      if (!start) return;
      if (start.moved) {
        if (this.#nearHome()) this.resetPosition();
        this.#ghost.classList.remove('show', 'hot');
        panel.classList.remove('moving');
      }
      start = null;
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (e) => {
      if (!(e.target as Element).closest('button')) this.resetPosition();
    });
    addEventListener('resize', () => {
      if (phone()) this.resetPosition();
      else if (this.#moved) this.#place(this.#moved.x, this.#moved.y);
    });
  }

  /** Puts the panel back in its usual place. */
  resetPosition(): void {
    this.#moved = null;
    this.#panel.classList.remove('placed');
    for (const prop of ['left', 'top', 'right', 'bottom']) this.#panel.style.removeProperty(prop);
  }

  #place(x: number, y: number): void {
    const r = this.#panel.getBoundingClientRect();
    const cx = Math.min(Math.max(8, x), Math.max(8, innerWidth - r.width - 8));
    const cy = Math.min(Math.max(8, y), Math.max(8, innerHeight - Math.min(r.height, 120) - 8));
    this.#moved = { x: cx, y: cy };
    const s = this.#panel.style;
    s.setProperty('left', `${cx}px`);
    s.setProperty('top', `${cy}px`);
    s.setProperty('right', 'auto');
    s.setProperty('bottom', 'auto');
  }

  #showHome(): void {
    const s = this.#panel.style;
    const saved = ['left', 'top', 'right', 'bottom'].map((p) => [p, s.getPropertyValue(p)] as const);
    for (const [p] of saved) s.removeProperty(p);
    this.#home = this.#panel.getBoundingClientRect();
    for (const [p, v] of saved) if (v) s.setProperty(p, v);
    const g = this.#ghost.style;
    g.setProperty('left', `${this.#home.left}px`);
    g.setProperty('top', `${this.#home.top}px`);
    g.setProperty('width', `${this.#home.width}px`);
    g.setProperty('height', `${this.#home.height}px`);
    this.#ghost.classList.add('show');
  }

  #nearHome(): boolean {
    if (!this.#home) return false;
    const r = this.#panel.getBoundingClientRect();
    const hot = Math.hypot(r.left - this.#home.left, r.top - this.#home.top) < 56;
    this.#ghost.classList.toggle('hot', hot);
    return hot;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Shows the mic when voice is available; `title` says where recognition happens. */
  setVoice(available: boolean, title = ''): void {
    this.#mic.hidden = !available;
    if (title) this.#mic.title = title;
  }

  setListening(listening: boolean): void {
    this.#mic.setAttribute('aria-pressed', String(listening));
    this.#mic.setAttribute('aria-label', listening ? 'Stop listening' : 'Ask by voice');
    this.#input.placeholder = listening ? 'Listening…' : 'Ask Clicky how to do something…';
    if (listening) this.#announce('Listening');
  }

  /** Puts recognised speech into the input so the user can see (and edit) what was heard. */
  /** The host page now offers its own Help button: drop the floating launcher. */
  useHostTrigger(): void {
    if (this.#hiddenLauncher) return;
    this.#hiddenLauncher = true;
    this.launcher.remove();
  }

  setDraft(text: string): void {
    this.#input.value = text.slice(0, 500);
  }

  /** Shows the panel and moves focus to the question input (our own UI only). */
  show(focusInput = true): void {
    if (!this.#open && this.#hiddenLauncher) {
      // Remember the host's trigger (whatever had focus outside Navoro) to restore focus on close.
      const active = document.activeElement;
      this.#opener = active instanceof HTMLElement && !active.closest('clicky-lite-root') ? active : null;
    }
    this.#setOpen(true);
    if (focusInput) this.#input.focus({ preventScroll: true });
  }

  /** Hides the panel; optionally returns focus to the launcher (or the host's trigger). */
  hide(returnFocus = true): void {
    this.#setOpen(false);
    if (!returnFocus) return;
    if (this.#hiddenLauncher) {
      if (this.#opener?.isConnected) this.#opener.focus({ preventScroll: true });
    } else {
      this.launcher.focus({ preventScroll: true });
    }
  }

  #setOpen(open: boolean): void {
    const changed = this.#open !== open;
    this.#open = open;
    this.#panel.hidden = !open;
    this.launcher.setAttribute('aria-expanded', String(open));
    this.launcher.setAttribute('aria-label', open ? 'Close Clicky' : 'Ask Clicky');
    if (changed) this.#cb.onToggle?.(open);
  }

  /** True when focus is currently inside the panel. */
  hasFocus(): boolean {
    const root = this.#panel.getRootNode();
    return root instanceof ShadowRoot && root.activeElement !== null && this.#panel.contains(root.activeElement);
  }

  #announce(text: string): void {
    if (text && text !== this.#lastAnnounced) {
      this.#lastAnnounced = text;
      this.#live.textContent = text;
    }
  }

  get #app(): string {
    return this.#config.applicationName || 'this app';
  }

  /** Clicky Lite: what a hand-off to the full Clicky carries: the question, the app, the step. */
  #handoffOf(state: SessionState | null): StuckHandoff {
    let step: string | null = null;
    if (state?.result && state.stepIndex !== null && state.result.steps[state.stepIndex]) {
      step = `step ${state.stepIndex + 1} of ${state.result.steps.length}: ${state.result.steps[state.stepIndex]!.title}`;
    }
    return { question: (state?.question ?? this.#input.value).trim(), app: this.#app, step };
  }

  /** Clicky Lite: hand off now, then show what was (or in a real version would be) passed on. */
  handOff(state: SessionState | null): void {
    const handoff = this.#handoffOf(state);
    const res = this.#cb.onStuck?.(handoff);
    this.#sheet = { kind: 'stuck', question: handoff.question, step: handoff.step, opened: true, result: res ?? null };
    this.#rerender();
  }

  /** Kept for callers: same as handOff. */
  openStuck(state: SessionState | null): void {
    this.handOff(state);
  }

  /** "ask the full clicky": a real link when there's a URL (works in sandboxed pages), else a button. */
  #stuckAction(cls: string, getState: () => SessionState | null): HTMLElement {
    const url = this.#cb.stuckUrl;
    if (url && safeHttpUrl(url)) {
      let host = url;
      try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* keep url */ }
      return h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer', onclick: () => setTimeout(() => this.handOff(getState()), 0) }, `ask the full clicky at ${host} ↗`);
    }
    return btn(cls, 'ask the full clicky', () => this.handOff(getState()));
  }


  #openShare(text: string): void {
    this.#sheet = { kind: 'share', text };
    this.#rerender();
  }

  #closeSheet(): void {
    this.#sheet = null;
    this.#rerender();
  }

  #rerender(): void {
    if (this.#last) this.render(this.#last.state, this.#last.extras);
    else this.#body.replaceChildren(...this.#sheetNodes());
  }

  #sheetNodes(): HTMLElement[] {
    const sheet = this.#sheet;
    if (!sheet) return [];
    const app = this.#app;
    if (sheet.kind === 'stuck') {
      if (sheet.opened) {
        const r = sheet.result;
        const knows = [
          sheet.question ? `your question: “${sheet.question}”` : null,
          sheet.step ? `you were on ${sheet.step}` : null,
        ].filter((x): x is string => !!x);
        return [
          h('div', { class: 'sheet' },
            h('h3', {}, 'here’s the full clicky ^-^'),
            r ? h('p', {}, r.note) : null,
            knows.length
              ? h('p', {}, `In a real version, the Clicky app on your computer would open already knowing you came from ${app}, plus:`)
              : h('p', {}, `In a real version, the Clicky app on your computer would open knowing only that you came from ${app}.`),
            knows.length ? h('div', { class: 'passes' }, ...knows.map((k) => h('div', { class: 'row' }, k))) : null,
            h('p', { class: 'small' }, `Nothing from inside ${app} is shared: not your cards, notes, or anything you’ve typed.`),
            r?.linkUrl && safeHttpUrl(r.linkUrl) ? this.#extLink(r.linkLabel || 'Open it again', r.linkUrl) : null,
            h('div', { class: 'actions' }, btn('btn primary', '← back to ' + app, () => this.#closeSheet())),
          ),
        ];
      }
      const q = h('textarea', { rows: 2, maxlength: 500, 'aria-label': 'Your question for Clicky', placeholder: 'What do you need help with?' });
      q.value = sheet.question;
      const go = () => {
        const handoff: StuckHandoff = { question: q.value.trim(), app, step: sheet.step };
        const res = this.#cb.onStuck?.(handoff);
        this.#sheet = { ...sheet, question: handoff.question, opened: true, result: res ?? null };
        this.#rerender();
      };
      return [
        h('div', { class: 'sheet' },
          h('h3', {}, 'ask the full clicky'),
          h('p', {}, `Clicky Lite only knows ${app}. The full Clicky runs on your computer and can help with anything.`),
          h('div', { class: 'passes' },
            h('b', {}, 'It gets only this:'),
            h('label', {}, h('span', {}, 'your question (edit it if you like)'), q),
            h('div', { class: 'row' }, `you’re in ${app}`),
            sheet.step ? h('div', { class: 'row' }, `you were on ${sheet.step}`) : null,
          ),
          h('p', { class: 'small' }, `Nothing else from ${app}: not your cards, notes, or anything you’ve typed there.`),
          h('div', { class: 'actions' },
            this.#cb.stuckUrl && safeHttpUrl(this.#cb.stuckUrl)
              ? h('a', { class: 'btn primary', href: this.#cb.stuckUrl, target: '_blank', rel: 'noopener noreferrer', onclick: () => setTimeout(go, 0) }, 'open the full clicky ↗')
              : btn('btn primary', 'open the full clicky', go),
            btn('btn ghost', 'back', () => this.#closeSheet())),
        ),
      ];
    }
    if (sheet.sent) {
      return [
        h('div', { class: 'sheet' },
          h('h3', {}, 'sent, thank you ^-^'),
          h('p', {}, `That’s how ${app}’s help docs get better, and Clicky Lite with them.`),
          h('div', { class: 'actions' }, btn('btn ghost', '← back', () => this.#closeSheet())),
        ),
      ];
    }
    const t = h('textarea', { rows: 3, maxlength: 500, 'aria-label': 'What to send' });
    t.value = sheet.text;
    return [
      h('div', { class: 'sheet' },
        h('h3', {}, `tell ${app}’s maker`),
        h('p', {}, 'The help docs don’t cover this yet. Send it so they can add it?'),
        h('label', {}, h('span', {}, 'exactly what gets sent (edit it first if you like)'), t),
        h('p', { class: 'small' }, 'Only this text. No name, no account, nothing else from the page.'),
        h('div', { class: 'actions' },
          btn('btn primary', 'send', () => {
            const text = t.value.trim();
            if (!text) return;
            this.#cb.onShare?.(text);
            this.#sheet = { kind: 'share', text, sent: true };
            this.#rerender();
          }),
          btn('btn ghost', 'back', () => this.#closeSheet()),
        ),
      ),
    ];
  }

  /** Re-renders the body for the given session state. */
  render(state: SessionState, extras: PanelExtras): void {
    if (this.#last && this.#sheet && state.question !== this.#last.state.question) this.#sheet = null; // a new question closes the sheet
    this.#last = { state, extras };
    if (this.#stuckBar) this.#stuckBar.hidden = !!this.#sheet;
    if (this.#sheet) {
      const busy = IN_FLIGHT.has(state.status);
      this.#input.disabled = busy;
      this.#submit.disabled = busy;
      this.#body.replaceChildren(...this.#sheetNodes());
      return;
    }
    const busy = IN_FLIGHT.has(state.status);
    this.#input.disabled = busy;
    this.#submit.disabled = busy;
    if (state.status === 'showing_guidance' && state.question) this.#input.value = '';

    const nodes: (Node | null)[] = [];
    const cfg = this.#config;
    if (!state.question || state.status === 'idle' || state.status === 'opening') {
      nodes.push(h('p', { class: 'greet' }, cfg.launcher.greeting || 'What are you trying to do?'));
      if (cfg.launcher.suggestions.length > 0) {
        nodes.push(
          h(
            'div',
            { class: 'chips', role: 'list', 'aria-label': 'Suggestions' },
            ...cfg.launcher.suggestions.slice(0, 6).map((s) =>
              h('div', { role: 'listitem' }, btn('chip', s, () => this.#cb.onAsk(s))),
            ),
          ),
        );
      }
    } else {
      nodes.push(h('div', { class: 'q' }, h('span', { class: 'sr' }, 'You asked: '), state.question));
    }

    if (busy) {
      const text = PHASE_TEXT[state.phase ?? 'retrieving'] ?? PHASE_TEXT.retrieving!;
      nodes.push(
        h(
          'div',
          { class: 'loading', 'aria-busy': 'true' },
          h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
          h('span', { class: 'grow' }, text),
          btn('btn secondary', 'Stop', () => this.#cb.onStop()),
        ),
      );
      this.#announce(text);
    } else if (state.status === 'cancelled') {
      nodes.push(
        h(
          'div',
          { class: 'note' },
          'Stopped. ',
          btn('link', 'Ask again', () => this.#cb.onRetry()),
        ),
      );
      this.#announce('Request stopped.');
    } else if (state.status === 'error' && state.error) {
      nodes.push(
        h(
          'div',
          { class: 'err', role: 'alert' },
          h('span', {}, state.error.message || 'Something went wrong.'),
          state.error.retryable ? btn('btn secondary', 'Try again', () => this.#cb.onRetry()) : null,
        ),
      );
      if (cfg.supportUrl && safeHttpUrl(cfg.supportUrl)) nodes.push(this.#extLink('Contact support', cfg.supportUrl));
    } else if (state.result && (state.status === 'showing_guidance' || state.status === 'completed')) {
      if (state.status === 'completed') nodes.push(this.#completion(state.result));
      nodes.push(...this.#answer(state, state.result, extras));
    }

    if (extras.showInspector && extras.lastPayload) {
      nodes.push(
        h(
          'details',
          { class: 'inspect' },
          h('summary', {}, extras.local ? 'What Clicky read to answer this (it never leaves this device)' : 'Inspect payload (dev only)'),
          h('pre', {}, JSON.stringify(extras.lastPayload, null, 2)),
        ),
      );
    }
    this.#body.replaceChildren(...nodes.filter((n): n is Node => n !== null));
  }

  #completion(result: GuidanceResult): HTMLElement {
    const title = result.workflow ? 'nice, that’s done ^-^' : 'all done ^-^';
    this.#announce(title);
    return h(
      'div',
      { class: 'done', role: 'status' },
      h('span', { class: 'tick' }, svg(ICON_CHECK)),
      h('div', {}, h('strong', {}, title), h('span', {}, result.workflow ? `Finished “${result.workflow.title}”.` : 'Ask anything else.')),
    );
  }

  #answer(state: SessionState, result: GuidanceResult, extras: PanelExtras): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (result.mode === 'demo') {
      out.push(h('span', { class: 'badge' }, 'Demo mode — answer assembled from your docs without a language model'));
    } else if (result.mode === 'local') {
      out.push(h('span', { class: 'local' }, 'Answered in your browser. Nothing was sent anywhere.'));
    }
    if (state.status !== 'completed') {
      out.push(h('p', { class: 'answer' }, result.answer));
      this.#announce(result.answer.slice(0, 200));
    }
    const handoff = result.kind === 'unresolved' || result.confidence < 0.5 || extras.feedbackGiven === 'not_helpful';
    const lowNote = !result.suggestions?.length;
    if (lowNote && (!result.grounded || result.confidence < 0.5) && result.kind !== 'unresolved') {
      out.push(
        h(
          'div',
          { class: 'note' },
          result.grounded
            ? 'I’m not fully certain about this one — double-check before relying on it.'
            : 'I couldn’t find this in your documentation, so treat this as a best guess.',
        ),
      );
    }
    if (result.suggestions?.length && state.status !== 'completed') {
      // Clicky Lite: never a dead end. Offer the closest things as tappable questions.
      out.push(
        h(
          'div',
          { class: 'chips', role: 'list', 'aria-label': 'Did you mean' },
          ...result.suggestions.slice(0, 3).map((q) => h('div', { role: 'listitem' }, btn('chip', q, () => this.#cb.onAsk(q)))),
        ),
      );
    }
    const n = result.steps.length;
    if (n > 0 && state.stepIndex === null) {
      const label = state.status === 'completed' ? 'Walk me through it again' : n === 1 ? 'Show me' : `Show me (${n} steps)`;
      out.push(h('div', { class: 'actions' }, btn('btn primary', label, () => this.#cb.onStartWalkthrough())));
    }
    if (result.fallback && handoff) {
      // Hand-off to a human: the user reviews and sends the pre-filled email themselves.
      const url = safeLinkUrl(result.fallback.url);
      const lead =
        extras.feedbackGiven === 'not_helpful' && result.kind !== 'unresolved'
          ? 'Sorry that didn’t solve it. Support can take it from here:'
          : result.suggestions?.length
            ? 'Or ask a person. Support can take it from here:'
            : 'Support can take it from here:';
      out.push(h('div', { class: 'handoff' }, h('p', {}, lead), url ? this.#extLink(result.fallback.label, url) : h('div', { class: 'note' }, result.fallback.label)));
    }
    // Clicky Lite: never a dead end. Tell the app's maker it's missing (opt-in) or ask the full Clicky.
    const missing = result.kind === 'unresolved' || extras.feedbackGiven === 'not_helpful';
    const canShare = this.#cb.onShare && missing && state.question;
    if (state.status !== 'completed' && handoff && (canShare || this.#cb.onStuck)) {
      out.push(
        h('div', { class: 'handoff' },
          h('p', {}, missing ? `Not in ${this.#app}’s help docs yet.` : 'Not sure this is it?'),
          h('div', { class: 'row-btns' },
            this.#cb.onStuck ? this.#stuckAction('btn secondary', () => state) : null,
            canShare ? btn('btn secondary', `tell ${this.#app}’s maker`, () => this.#openShare(state.question ?? '')) : null,
          ),
        ),
      );
    }
    if (result.citations.length > 0) {
      out.push(
        h(
          'details',
          { class: 'cites' },
          h('summary', {}, `Sources (${result.citations.length})`),
          ...result.citations.slice(0, 5).map((c) => h('div', { class: 'cite' }, h('b', {}, `From: ${c.sourceTitle}`), h('p', {}, c.excerpt))),
        ),
      );
    }
    out.push(
      extras.feedbackGiven
        ? h('div', { class: 'fb', role: 'status' }, extras.feedbackGiven === 'helpful' ? 'Glad that helped.' : 'Thanks for telling us.')
        : h(
            'div',
            { class: 'fb' },
            h('span', { class: 'grow' }, 'Was this helpful?'),
            btn('btn ghost', 'Yes', () => this.#cb.onFeedback(true)),
            btn('btn ghost', 'No', () => this.#cb.onFeedback(false)),
          ),
    );
    return out;
  }

  #extLink(label: string, url: string): HTMLAnchorElement {
    if (url.startsWith('mailto:')) {
      // Opened as a popup: a sandboxed frame may refuse to navigate itself to mailto:.
      // The address is shown too, so there's always a way to reach a person.
      const address = decodeURIComponent(url.slice(7).split('?')[0] ?? '');
      const link = h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer' }, `${label} →`);
      return address ? (h('span', { class: 'mail' }, link, h('span', { class: 'addr' }, ` or write to ${address}`)) as unknown as HTMLAnchorElement) : link;
    }
    return h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer' }, `${label} ↗`);
  }
}
