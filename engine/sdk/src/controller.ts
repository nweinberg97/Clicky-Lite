/**
 * NavoroController: wires the state machine to networking, context collection,
 * target resolution and the UI. One instance per `init()`.
 *
 * READ-ONLY BY DESIGN: Navoro observes and points; it never acts. The SDK must
 * never click, type into, submit, change, or steal focus from host elements. The
 * only effect it has on the host page is (a) appending its own shadow host and
 * (b) scrolling a highlighted target into view. Focus only moves between
 * Navoro's own controls in response to the user interacting with them.
 */
import type {
  EnvironmentName,
  GuidanceResult,
  GuidanceStep,
  KnowledgePack,
  PackPlace,
  PublicSdkConfig,
  SanitizedContext,
  SdkEvent,
  SdkEventType,
} from '../../packages/contracts/src/sdk-types.ts';
import { ApiError, EventQueue, NavoroApi } from './api.ts';
import { collectContext } from './context-collector.ts';
import { DiscoveryScheduler } from './discovery.ts';
import { resolveAccent } from './theme.ts';
import { HelpButtons, type HelpButtonOptions } from './help-button.ts';
import { createRoot, Overlay, type NavoroRoot } from './overlay.ts';
import { Panel } from './panel.ts';
import { findHiddenTarget, resolveTarget } from './resolver.ts';
import { findReveal, type Reveal } from './reveal.ts';
import { accessibleName as accessibleNameOf } from './dom.ts';
import { IN_FLIGHT, SessionMachine, type SessionError, type SessionEvent, type SessionState } from './state-machine.ts';
import { LocalSource } from './local.ts';
import type { LocalAnswer } from '../../packages/engine/src/answer.ts';
import { answerFind, configureFinder, findOnScreen, hereStep, parseFind, type FinderAnswer } from './finder.ts';
import { listen, voiceAvailability, type Listening, type VoiceMode } from './voice.ts';
import { chooseStartStep } from '../../packages/engine/src/pack.ts';
import { workflowSteps } from '../../packages/engine/src/answer.ts';

export interface ControllerOptions {
  publicKey: string;
  environment: EnvironmentName;
  apiOrigin: string;
  debug: boolean;
  sdkVersion: string;
  /** 'hidden': the host renders its own trigger. */
  launcher: 'default' | 'hidden';
  panelPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | null;
  panelOffset: number | null;
  /** Brand colour override (CSS colour or var(--name)). */
  accent?: string | null;
  /** Where Navoro places its (?) Help button in the host page. */
  button?: HelpButtonOptions | null;
  /** Local mode: knowledge pack URL or object. Null → hosted mode. */
  pack: string | KnowledgePack | null;
  voice: VoiceMode;
  /** Clicky Lite: optional model that picks one documented entry when the matcher isn't sure. */
  chooser?: ((question: string, options: Array<{ id: string; title: string; kind: string }>) => Promise<string | null>) | null;
}

export type StateListener = (state: SessionState) => void;
export type PanelListener = (open: boolean) => void;

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Too many questions at once. Try again shortly.',
  timeout: 'That took longer than expected.',
  network: 'Couldn’t reach Clicky Lite. Check your connection.',
  provider_unavailable: 'The assistant is temporarily unavailable.',
  invalid_response: 'Clicky Lite got an unexpected response.',
  unauthorized: 'Your session expired.',
};

export class NavoroController {
  readonly options: ControllerOptions;
  readonly #m = new SessionMachine();
  readonly #api: NavoroApi;
  #config: PublicSdkConfig | null = null;
  #root: NavoroRoot | null = null;
  #buttons: HelpButtons | null = null;
  #panel: Panel | null = null;
  #overlay: Overlay | null = null;
  #events: EventQueue | null = null;
  #discovery: DiscoveryScheduler | null = null;
  #abort: AbortController | null = null;
  #lastPayload: SanitizedContext | null = null;
  #feedbackGiven: 'helpful' | 'not_helpful' | null = null;
  readonly #local: LocalSource | null;
  #listening: Listening | null = null;
  #voiceHow: 'local' | 'local-download' | 'cloud' | null = null;
  /** "Start where you are": the step a walkthrough began at, shown once with a note. */
  #resume: { requestId: string; index: number } | null = null;
  #shownStepKey = '';
  #followCleanup: (() => void) | null = null;
  #destroyed = false;
  /** Places the host app registers at runtime (its clients, invoices…) for the finder. */
  #places: PackPlace[] = [];
  readonly #stateListeners: ReadonlySet<StateListener>;
  readonly #onKeyDown = (ev: KeyboardEvent) => this.#handleKey(ev);
  readonly #onPageHide = () => this.#events?.flush(true);

  readonly #panelListeners: ReadonlySet<PanelListener>;

  /** Listener sets are owned by the caller (index.ts) so subscriptions survive re-init. */
  constructor(options: ControllerOptions, listeners: ReadonlySet<StateListener>, panelListeners: ReadonlySet<PanelListener> = new Set()) {
    this.options = options;
    this.#stateListeners = listeners;
    this.#panelListeners = panelListeners;
    this.#api = new NavoroApi(options);
    this.#local = options.pack ? new LocalSource(options.pack, options.environment) : null;
  }

  get isDevelopment(): boolean {
    // Server config is authoritative once loaded; the script attribute is a hint until then.
    return (this.#config?.environment ?? this.options.environment) === 'development';
  }

  /** Fetches config and mounts the UI. Resolves once ready (or once disabled on 403). */
  async start(): Promise<void> {
    let config: PublicSdkConfig;
    try {
      config = this.#local ? await this.#local.load() : await this.#api.init();
    } catch (err) {
      if (this.#local) {
        console.warn(`[Clicky Lite] ${err instanceof Error ? err.message : 'Knowledge pack could not be loaded.'} Clicky Lite stays hidden.`);
        return;
      }
      if (err instanceof ApiError && err.kind === 'origin_not_allowed') {
        console.warn(`[Clicky Lite] Origin ${location.origin} is not allowed for this key; add it in the dashboard. Clicky Lite stays hidden.`);
        return;
      }
      throw err;
    }
    if (this.#destroyed) return;
    this.#config = config;
    configureFinder(config.privacy, this.#local?.pack ?? null, () => this.#places);
    this.#mount(config);
  }

  get isOpen(): boolean {
    return this.#panel?.isOpen ?? false;
  }

  #mount(config: PublicSdkConfig): void {
    const accent = resolveAccent([this.options.accent, config.theme?.accent]);
    // A placed (?) button or an app's own [data-clicky-trigger] replaces the floating launcher,
    // and the panel opens next to it unless the app chose a position.
    const buttonOpts = this.options.button ?? null;
    const buttons = new HelpButtons({ open: () => this.open(), close: () => this.close(), isOpen: () => this.isOpen }, buttonOpts, accent?.accent ?? null, () => {
      // The app's Help button appeared after Navoro loaded: switch over to it.
      this.#panel?.useHostTrigger();
      this.#placeNearButton();
    });
    this.#buttons = buttons;
    const useButtons = buttons.active;
    const root = createRoot(this.options.panelPosition ?? config.launcher.position, this.options.panelOffset, accent);
    this.#root = root;
    if (useButtons) this.#placeNearButton();
    this.#overlay = new Overlay(root);
    this.#panel = new Panel(root, config, this.options.launcher === 'hidden' || useButtons, {
      onOpen: () => this.open(),
      onClose: () => this.close(),
      onAsk: (q) => void this.ask(q),
      onStop: () => this.stop(),
      onRetry: () => this.#retry(),
      onStartWalkthrough: () => this.#startWalkthrough(),
      onFeedback: (helpful) => this.#feedback(helpful),
      onToggle: (open) => {
        if (open) this.#checkVoice();
        if (!open) this.#stopListening();
        this.#emitPanel(open);
      },
      onVoice: () => void this.#toggleVoice(),
    });
    this.#m.subscribe((state, event) => this.#onState(state, event));
    root.shadow.addEventListener('keydown', this.#onKeyDown as EventListener);
    document.addEventListener('keydown', this.#onKeyDown);
    if (config.analyticsEnabled) {
      this.#events = new EventQueue((events, keepalive) => void this.#api.postEvents(events, keepalive));
      addEventListener('pagehide', this.#onPageHide);
    }
    if (config.discoveryEnabled && config.environment === 'development') {
      this.#discovery = new DiscoveryScheduler(
        () => (this.#config ?? config).privacy,
        (req) => void this.#api.postDiscovery(req),
      );
    }
    this.#render();
  }

  /** Probes voice support once, lazily, the first time the panel opens (never at page load). */
  #voiceChecked = false;
  #checkVoice(): void {
    if (this.#voiceChecked || this.options.voice === 'off') return;
    this.#voiceChecked = true;
    void voiceAvailability(this.options.voice).then((how) => {
      if (this.#destroyed || !this.#panel) return;
      this.#voiceHow = how;
      const where = how === 'cloud' ? 'Speech is recognised by your browser’s speech service.' : 'Speech is recognised on this device.';
      this.#panel.setVoice(how !== null, how ? where : '');
    });
  }

  // ── voice ─────────────────────────────────────────────────────────────────

  async #toggleVoice(): Promise<void> {
    if (this.#listening) {
      this.#stopListening();
      return;
    }
    const panel = this.#panel;
    if (!panel || !this.#voiceHow) return;
    panel.setListening(true);
    let finalText = '';
    this.#listening = await listen(
      this.#voiceHow,
      (text, final) => {
        panel.setDraft(text);
        if (final) finalText = text;
      },
      (error) => {
        this.#listening = null;
        panel.setListening(false);
        if (!error && finalText) void this.ask(finalText);
      },
    );
  }

  #stopListening(): void {
    this.#listening?.stop();
    this.#listening = null;
    this.#panel?.setListening(false);
  }

  // ── public surface ────────────────────────────────────────────────────────

  open(): void {
    if (!this.#panel || this.#panel.isOpen) return;
    this.#m.send({ type: 'OPEN' });
    this.#panel.show();
    this.#track('launcher_opened');
    this.#render();
  }

  close(): void {
    if (!this.#panel) return;
    if (IN_FLIGHT.has(this.#m.state.status)) this.stop();
    const s = this.#m.state;
    if (s.result && s.status === 'showing_guidance') this.#track('guidance_dismissed');
    if (s.status === 'opening' || s.status === 'cancelled' || s.status === 'error') this.#m.send({ type: 'DISMISS' });
    if (this.#panel.isOpen) this.#panel.hide(true);
  }

  /** Stops the in-flight request (aborts the fetch). */
  stop(): void {
    if (!IN_FLIGHT.has(this.#m.state.status)) return;
    this.#abort?.abort();
    this.#abort = null;
    if (this.#m.send({ type: 'CANCEL' }).accepted) this.#track('request_cancelled');
  }

  /** Asks a question: collects sanitized context, streams guidance, resolves targets. */
  async ask(question: string): Promise<void> {
    const q = question.trim().slice(0, 500);
    if (!q || !this.#panel) return;
    if (!this.#panel.isOpen) {
      this.#m.send({ type: 'OPEN' });
      this.#panel.show(false);
    }
    if (IN_FLIGHT.has(this.#m.state.status)) this.stop();
    const requestId = newRequestId();
    if (!this.#m.send({ type: 'OPEN', question: q, requestId }).accepted) return;
    await this.#run(requestId, q);
  }

  /** Clicky Lite: the host app tells the finder about things that live on other pages. */
  setPlaces(places: PackPlace[]): void {
    this.#places = Array.isArray(places) ? places.filter((p) => p && typeof p.label === 'string' && Array.isArray(p.via)).slice(0, 500) : [];
  }

  /** What may be read on this page right now under the pack's privacy rules (local, read-only). */
  see(): SanitizedContext | null {
    if (!this.#config) return null;
    try {
      return collectContext(document, this.#config.privacy);
    } catch {
      return null;
    }
  }

  /** Regions on this page that are never read, with the rule that blocks each. */
  blockedRegions(): Array<{ element: Element; reason: string }> {
    const privacy = this.#config?.privacy;
    if (!privacy) return [];
    const out: Array<{ element: Element; reason: string }> = [];
    const seen = new Set<Element>();
    const add = (element: Element, reason: string) => {
      if (seen.has(element) || element.closest('clicky-lite-root')) return;
      seen.add(element);
      out.push({ element, reason });
    };
    for (const id of privacy.blockedNavoroIds) {
      for (const el of document.querySelectorAll(`[data-clicky-id="${CSS.escape(id)}"]`)) add(el, `data-clicky-id="${id}"`);
    }
    for (const selector of privacy.blockedSelectors) {
      try {
        for (const el of document.querySelectorAll(selector)) add(el, selector);
      } catch {
        // invalid selector: ignored, as the collector does
      }
    }
    for (const el of document.querySelectorAll('[data-clicky-sensitive]')) add(el, 'data-clicky-sensitive');
    for (const el of document.querySelectorAll('input[type=password],[autocomplete^="cc-"],[autocomplete="one-time-code"]')) add(el, 'built-in: password, payment or code field');
    return out;
  }

  getLastPayload(): SanitizedContext | null {
    if (!this.isDevelopment && !this.options.debug && !this.#local) return null;
    return this.#lastPayload ? (JSON.parse(JSON.stringify(this.#lastPayload)) as SanitizedContext) : null;
  }

  /** Removes every listener, observer, timer, overlay and DOM node. */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#abort?.abort();
    this.#abort = null;
    this.#stopFollowing();
    this.#stopListening();
    this.#events?.flush(true);
    this.#events?.dispose();
    this.#discovery?.dispose();
    this.#buttons?.destroy();
    this.#overlay?.destroy();
    this.#root?.shadow.removeEventListener('keydown', this.#onKeyDown as EventListener);
    document.removeEventListener('keydown', this.#onKeyDown);
    removeEventListener('pagehide', this.#onPageHide);
    this.#root?.destroy();
    this.#m.clear();
    this.#root = this.#panel = this.#overlay = this.#events = this.#discovery = null;
  }

  /** Current session state (read-only snapshot). */
  get state(): SessionState {
    return this.#m.state;
  }

  // ── request pipeline ──────────────────────────────────────────────────────

  async #run(requestId: string, question: string): Promise<void> {
    const config = this.#config;
    if (!config) return;
    this.#feedbackGiven = null;
    let context: SanitizedContext;
    try {
      context = collectContext(document, config.privacy);
    } catch {
      context = {};
    }
    this.#lastPayload = context;
    if (!this.#m.send({ type: 'CONTEXT_READY', requestId }).accepted) return;

    const controller = new AbortController();
    this.#abort = controller;
    if (this.#local) {
      // Local mode: the on-device engine answers; nothing is sent anywhere.
      this.#m.send({ type: 'REQUEST_SENT', requestId });
      this.#m.send({ type: 'STREAM_EVENT', requestId, phase: 'retrieving' });
      await new Promise((resolve) => setTimeout(resolve, 0)); // let the UI paint and Stop/Escape register
      if (controller.signal.aborted || this.#abort !== controller) return;
      this.#abort = null;
      try {
        const ask = (q: string) => this.#local!.answer({ question: q, context, requestId, ...(this.#m.state.sessionId ? { sessionId: this.#m.state.sessionId } : {}) });
        let local = ask(question);
        // Clicky Lite: not sure what they mean? Let the optional chooser pick a documented entry.
        const unsure =
          local.match === 'none' || local.match === 'chunk' || local.match === 'concept' ||
          (local.match === 'workflow' && local.coverage < 0.85 && !(local.result as { phrase?: boolean }).phrase) ||
          (local.match === 'error' && local.coverage < 0.95 && !(context.visibleErrors ?? []).length);
        const chooser = this.options.chooser;
        const pack = this.#local.pack;
        if (unsure && chooser && pack && parseFind(question).intent !== 'explicit') {
          this.#m.send({ type: 'STREAM_EVENT', requestId, phase: 'composing' });
          const catalog = [
            ...pack.workflows.map((w) => ({ id: `w:${w.id}`, title: w.title, kind: 'how-to' })),
            ...pack.items.filter((i) => i.kind === 'feature').map((i) => ({ id: `f:${i.id}`, title: `What ${i.title} is and how it works`, kind: 'overview' })),
            ...pack.items.filter((i) => i.kind === 'known_error').map((i) => ({ id: `e:${i.id}`, title: `Problem: ${i.title}`, kind: 'troubleshooting' })),
          ];
          let picked: string | null = null;
          try {
            picked = await Promise.race([chooser(question, catalog), new Promise<null>((r) => setTimeout(() => r(null), 12000))]);
          } catch {
            picked = null;
          }
          if (controller.signal.aborted || this.#abort !== null) return;
          const hit = picked ? catalog.find((c) => c.id === picked) : undefined;
          if (hit) {
            const raw = hit.id.slice(2);
            const w = hit.id.startsWith('w:') ? pack.workflows.find((x) => x.id === raw) : null;
            const f = hit.id.startsWith('f:') ? pack.items.find((x) => x.id === raw) : null;
            const e = hit.id.startsWith('e:') ? pack.items.find((x) => x.id === raw) : null;
            const q = w ? `how do i ${w.title.toLowerCase()}` : f ? `how does ${f.title.replace(/^the\s+/i, '').toLowerCase()} work` : e ? `why does it say ${e.title}` : question;
            const again = ask(q);
            if (again.match !== 'none') local = again;
          }
        }
        this.#handleResult(requestId, this.#withFinder(question, local));
      } catch {
        this.#m.send({ type: 'FAIL', requestId, error: { code: 'invalid_response', message: 'Clicky Lite couldn’t read its knowledge pack.', retryable: false } });
      }
      return;
    }
    const fail = (error: SessionError) => this.#m.send({ type: 'FAIL', requestId, error });
    let settled = false;
    const send = (event: SessionEvent) => this.#m.send(event);
    try {
      const pending = this.#api.streamGuidance(
        { question, context, requestId, ...(this.#m.state.sessionId ? { sessionId: this.#m.state.sessionId } : {}) },
        controller.signal,
        (event) => {
          if (controller.signal.aborted || settled) return;
          if (event.type === 'status') send({ type: 'STREAM_EVENT', requestId, phase: event.phase });
          else if (event.type === 'result') {
            settled = true;
            this.#handleResult(requestId, event.result);
          } else {
            settled = true;
            fail({ code: event.code, message: ERROR_MESSAGES[event.code] ?? event.message, retryable: event.retryable });
          }
        },
      );
      send({ type: 'REQUEST_SENT', requestId });
      await pending;
      if (!settled && !controller.signal.aborted) fail({ code: 'invalid_response', message: ERROR_MESSAGES.invalid_response!, retryable: true });
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof ApiError && err.kind === 'timeout')) return;
      if (err instanceof ApiError && err.kind === 'origin_not_allowed') {
        console.warn('[Clicky Lite] This origin is no longer allowed. Clicky Lite will stay hidden.');
        this.destroy();
        return;
      }
      const kind = err instanceof ApiError ? err.kind : 'network';
      const code = kind === 'timeout' ? 'timeout' : kind === 'unauthorized' ? 'unauthorized' : kind === 'invalid_response' ? 'invalid_response' : 'network';
      fail({ code, message: ERROR_MESSAGES[code] ?? 'Something went wrong.', retryable: true });
    } finally {
      if (this.#abort === controller) this.#abort = null;
    }
  }

  #handleResult(requestId: string, result: GuidanceResult): void {
    // Clicky Lite: a single "here it is" pointer (an error fix or a term) is only offered when
    // that control is on this screen right now. Otherwise the answer stands on its own text.
    if (result.kind !== 'workflow' && result.steps.length > 0 && result.steps.every((step) => !step.target || resolveTarget(step.target).element === null)) {
      result = { ...result, steps: this.#routeTo(result.steps[0]?.target?.key ?? null) };
    }
    if (!this.#m.send({ type: 'RESULT', requestId, result }).accepted) return; // stale → dropped
    this.#track('guidance_shown');
    if (result.steps.length === 0) return;
    // "Start where you are": check which steps' controls are on screen right now and
    // begin at the step the user has already reached. Read-only, local.
    let startAt = 0;
    if (result.kind === 'workflow') {
      // Clicky Lite: always start at step 1 so nothing seems skipped; if they're already there, one click moves on.
      startAt = 0;
    }
    this.#resume = startAt > 0 ? { requestId, index: startAt } : null;
    // Later targets are resolved lazily per step because the host DOM changes as the
    // user moves through a workflow; see #syncSteps.
    this.#m.send({ type: 'TARGETS_RESOLVED', requestId, startAt });
  }

  /**
   * Clicky Lite: a step's control isn't usable right now. Find the way to it:
   *  1. it's on screen but tucked away (folded menu, hover toolbar) → what reveals it;
   *  2. it's on another screen → the help docs know the route: any walkthrough that reaches
   *     this control, and the step before it whose control IS on screen now (e.g. "Choose
   *     Timely" before "Click Reminders"). Point there first; repeat until the control appears.
   */
  #revealFor(step: GuidanceStep): Reveal | null {
    if (!step.target) return this.#itemsArea(step);
    const hidden = findHiddenTarget(step.target);
    const tucked = hidden ? findReveal(hidden) : null;
    if (tucked) return tucked;
    const pack = this.#local?.pack;
    if (!pack) return null;
    const sig = (s: GuidanceStep | undefined) => (s?.target ? JSON.stringify(s.target.strategies) : '');
    const want = sig(step);
    const mappings = new Map(pack.mappings.map((mapping) => [mapping.key, mapping]));
    let best: { step: GuidanceStep; el: Element; dist: number } | null = null;
    for (const workflow of pack.workflows) {
      const steps = workflowSteps(workflow, mappings);
      for (let k = 1; k < steps.length; k++) {
        if (sig(steps[k]) !== want) continue;
        for (let j = k - 1; j >= 0 && k - j <= 4; j--) {
          const prev = steps[j];
          if (!prev?.target || sig(prev) === want) continue;
          const el = resolveTarget(prev.target).element;
          if (el) {
            if (!best || k - j < best.dist) best = { step: prev, el, dist: k - j };
            break;
          }
        }
      }
    }
    if (!best) return null;
    const say = best.step.instruction.replace(/\.$/, '');
    return { anchor: best.el, hover: false, say: `${say}, then I’ll show you the next bit.` };
  }

  /**
   * Clicky Lite: a step about the user's own things ("Double-click the card", "Hover the item")
   * has no button to point at. Point at the area that holds them (never reading inside it);
   * if there's none on this screen, point at the way to a screen that has them.
   */
  #itemsArea(step: GuidanceStep): Reveal | null {
    const words = /\b(card|cards|goal|goals|note|notes|task|tasks|item|items|link|links|file|files|event|events|reminder|tile)\b/i;
    if (!words.test(`${step.title} ${step.instruction}`)) return null;
    const pack = this.#local?.pack;
    const selectors = pack?.privacy.blockedSelectors ?? [];
    let best: { el: Element; area: number } | null = null;
    for (const sel of selectors) {
      let found: Element[] = [];
      try { found = [...document.querySelectorAll(sel)]; } catch { continue; }
      for (const el of found) {
        if (el.closest('[data-clicky-ignore], .modal, .popover')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 40 || r.bottom < 0 || r.top > innerHeight) continue;
        if (getComputedStyle(el).visibility === 'hidden' || Number.parseFloat(getComputedStyle(el).opacity) < 0.05) continue;
        if (!el.querySelector('[data-id], [draggable="true"], li, article')) continue; // only areas that hold something
        const area = r.width * r.height;
        if (!best || area > best.area) best = { el, area };
      }
    }
    if (best) {
      return { anchor: best.el, hover: true, say: 'Your things are in here. I never read them, so pick the one you mean yourself.' };
    }
    // Nothing to pick on this screen: point at the first tool the app's own walkthroughs open.
    const tool = document.querySelector('[data-clicky-id^="nav."]:not(.active):not([aria-current="page"])');
    if (tool) return { anchor: tool, hover: false, say: `There’s nothing to pick on this screen. Open ${accessibleNameOf(tool)} (or any tool with your things in it) first.` };
    return null;
  }

  /**
   * Clicky Lite: the control a fix needs isn't on this screen. If a documented workflow
   * reaches that control, walk the user there (its steps up to and including that control).
   */
  #routeTo(key: string | null): GuidanceStep[] {
    const pack = this.#local?.pack;
    if (!pack || !key) return [];
    const mappings = new Map(pack.mappings.map((mapping) => [mapping.key, mapping]));
    for (const workflow of pack.workflows) {
      const at = workflow.steps.findIndex((step) => step.targetKey === key);
      if (at < 0) continue;
      return workflowSteps(workflow, mappings).slice(0, at + 1);
    }
    return [];
  }

  /**
   * Clicky Lite: decide between the help-doc answer and the on-screen finder.
   *  - "where is / find / show me / take me to …" → the finder first.
   *  - a bare noun ("invoice 1045", "settings") → an exact help term or task wins, else the finder.
   *  - a how-to the docs don't cover → the finder, then 2-3 close suggestions.
   */
  #withFinder(question: string, local: LocalAnswer): GuidanceResult {
    const result = local.result;
    if (local.match === 'handoff') return result;
    const parsed = parseFind(question);
    const asFinder = (found: FinderAnswer, confidence = 0.85): GuidanceResult => ({
      ...result,
      kind: found.steps.length ? 'workflow' : 'answer',
      answer: found.answer,
      grounded: true,
      confidence,
      workflow: null,
      steps: found.steps.map((step, index) => ({ ...step, index })),
      citations: [],
      pointNow: found.steps.length > 0,
      suggestions: undefined,
    });
    const docsStrong = local.match === 'term' || local.match === 'error' || local.match === 'limit' || (local.match === 'workflow' && local.coverage >= 0.75);
    if (parsed.intent === 'explicit') {
      if (local.match === 'limit') return result;
      const found = answerFind(parsed.subject);
      if (found) return asFinder(found);
      if (docsStrong || local.match === 'workflow') return result;
      return this.#noMatch(result, parsed.subject);
    }
    if (parsed.intent === 'bare') {
      if (local.match === 'term' || local.match === 'limit' || local.match === 'error') return result;
      const confident = local.match !== 'none' && local.coverage >= 0.75;
      if (confident) {
        // A task or doc matches the words exactly: only something right on this screen beats it.
        const hit = findOnScreen(parsed.subject);
        if (hit && hit.quality >= 0.5) return asFinder({ answer: `Here’s “${hit.label}” on this page.`, steps: [hereStep(hit.label, 0, parsed.subject)] });
        return result;
      }
      const found = answerFind(parsed.subject, false);
      if (found) return asFinder(found);
      if (local.match !== 'none') return result;
      return this.#noMatch(result, parsed.subject);
    }
    if (local.match !== 'none') return result;
    const found = answerFind(question, true);
    if (found) return asFinder(found, 0.7);
    return this.#noMatch(result, question);
  }

  #noMatch(result: GuidanceResult, subject: string): GuidanceResult {
    void subject;
    return {
      ...result,
      kind: 'unresolved',
      answer: 'I couldn’t find that in Fernbill’s help or on this screen. Did you mean one of these?'.replace('Fernbill', this.#config?.applicationName ?? 'this app'),
      steps: [],
    };
  }

  #retry(): void {
    const requestId = newRequestId();
    const question = this.#m.state.question;
    if (question && this.#m.send({ type: 'RETRY', requestId }).accepted) void this.#run(requestId, question);
  }

  #startWalkthrough(): void {
    // From the answer view or the completion view (restart); both start at step 0.
    if (this.#m.state.stepIndex === null) this.#m.send({ type: 'NEXT_STEP' });
  }

  /** Unless the app chose a panel position, open the panel right next to its Help button. */
  #placeNearButton(): void {
    const rect = this.#buttons?.anchor?.getBoundingClientRect();
    const container = this.#root?.container;
    if (this.options.panelPosition || !container || !rect || rect.height <= 0) return;
    const top = rect.top < window.innerHeight / 2;
    container.classList.toggle('top', top);
    container.classList.remove('left');
    const offset = this.options.panelOffset ?? Math.round(top ? rect.bottom + 8 : window.innerHeight - rect.top + 8);
    container.style.setProperty('--edge', `${offset}px`);
  }

  #emitPanel(open: boolean): void {
    this.#buttons?.setOpen(open);
    for (const listener of [...this.#panelListeners]) {
      try {
        listener(open);
      } catch (err) {
        console.error('[Clicky Lite] panel listener failed', err);
      }
    }
  }

  #feedback(helpful: boolean): void {
    this.#feedbackGiven = helpful ? 'helpful' : 'not_helpful';
    this.#track(helpful ? 'feedback_helpful' : 'feedback_not_helpful');
    this.#render();
  }

  // ── state → view ──────────────────────────────────────────────────────────

  #onState(state: SessionState, event: SessionEvent): void {
    this.#syncSteps(state, event);
    this.#render();
    if (this.#destroyed) return;
    for (const listener of [...this.#stateListeners]) {
      try {
        listener(state);
      } catch (err) {
        console.error('[Clicky Lite] state listener failed', err);
      }
    }
  }

  #syncSteps(state: SessionState, event: SessionEvent): void {
    const overlay = this.#overlay;
    const panel = this.#panel;
    if (!overlay || !panel) return;
    const result = state.result;
    if (state.status !== 'showing_guidance' || state.stepIndex === null || !result) {
      this.#stopFollowing();
      if (overlay.active) {
        const cardHadFocus = this.#root?.shadow.activeElement && overlay.card?.contains(this.#root.shadow.activeElement);
        overlay.hide();
        this.#shownStepKey = '';
        if (state.status === 'completed' || event.type === 'DISMISS') {
          panel.show(Boolean(cardHadFocus));
        }
      }
      if (state.status === 'completed' && event.type === 'COMPLETE') this.#track('workflow_completed');
      return;
    }
    const key = `${state.requestId}:${state.stepIndex}`;
    if (key === this.#shownStepKey) return;
    this.#shownStepKey = key;
    this.#stopFollowing();
    const index = state.stepIndex;
    const step = result.steps[index];
    if (!step) return;
    // The panel gives way to the step card so it never covers the target.
    // Clicky Lite: the input is disabled while answering, so focus may have dropped to <body>;
    // if the panel was open, the user was talking to Clicky: carry focus to the step card.
    const panelHadFocus = panel.hasFocus() || (panel.isOpen && (document.activeElement === document.body || document.activeElement === this.#root?.host));
    if (panel.isOpen) panel.hide(false);
    const resolve = () => resolveTarget(step.target).element;
    const element = resolve();
    // Clicky Lite: if the control is there but tucked away, show how to reveal it first.
    const reveal = element ? null : this.#revealFor(step);
    let alreadyNote: string | null = null;
    // Clicky Lite: "Show tool buttons" when they're already showing (the button now says "Hide …") is done.
    const name = this.#lookingFor(step);
    if (!element && name && /^show\s/i.test(name)) {
      const inverse = name.replace(/^show\s/i, 'hide ').toLowerCase();
      const done = [...document.querySelectorAll('button,[role=button],a')].some((el) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim().toLowerCase() === inverse);
      if (done) alreadyNote = `Already done: you can see “${name.replace(/^show\s/i, '')}” already. Click next.`;
    }
    overlay.show(
      {
        step,
        index,
        total: result.steps.length,
        element,
        lookingFor: this.#lookingFor(step),
        onBack: () => this.#m.send({ type: 'PREV_STEP' }),
        onNext: () => {
          const cur = this.#m.state;
          if (cur.result && cur.stepIndex !== null && cur.stepIndex >= cur.result.steps.length - 1) this.#m.send({ type: 'COMPLETE' });
          else this.#m.send({ type: 'NEXT_STEP' });
        },
        onClose: () => this.#dismissSteps(),
        relocate: resolve,
        note: alreadyNote ?? this.#resumeNote(state.requestId, index),
        reveal: alreadyNote ? null : reveal,
        onLost: () => {
          // The control vanished (they went to another screen). Show the way back and wait for it.
          if (key !== this.#shownStepKey) return;
          this.#stopFollowing();
          const again = resolve();
          overlay.show({ ...overlay.view!, element: again, reveal: again ? null : this.#revealFor(step) }, false);
          if (again) this.#follow(key, again);
          else this.#awaitTarget(key, index, step, resolve);
        },
      },
      panelHadFocus || undefined,
    );
    this.#track('step_viewed', index, step);
    // Clicky Lite: never move on by itself; every step waits for the user's own click.
    if (element) this.#follow(key, element);
    else this.#awaitTarget(key, index, step, resolve);
  }

  #advanceFrom(key: string): void {
    if (key !== this.#shownStepKey) return;
    const cur = this.#m.state;
    if (!cur.result || cur.stepIndex === null) return;
    if (cur.stepIndex >= cur.result.steps.length - 1) this.#m.send({ type: 'COMPLETE' });
    else this.#m.send({ type: 'NEXT_STEP' });
  }

  /**
   * Follow-along: while a step is highlighted, passively notice when the user
   * activates that exact control (click for buttons/links, change for fields)
   * and move to the next step. Navoro never reads values and never acts itself;
   * listeners are scoped to the one highlighted element and removed on step change.
   */
  #follow(key: string, element: Element): void {
    const isField = element.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), select, textarea, fieldset, [role=radiogroup], [role=combobox], [role=textbox]');
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Clicky Lite: once they've pressed the control, the step is done, even if the app redraws
    // the control in the next instant (which tears down this listener). So a press is never cancelled.
    let pressed = false;
    const advance = () => {
      if (timer) clearTimeout(timer);
      if (!isField) pressed = true;
      timer = setTimeout(() => this.#advanceFrom(key), isField ? 150 : 60);
    };
    const type = isField ? 'change' : 'click';
    element.addEventListener(type, advance, { passive: true });
    // Clicky Lite: apps often redraw a button the moment it's pressed (a tab that's already
    // selected, a nav that re-renders), so the click never lands on the element we're watching.
    // Also count a press on this element, or on its redrawn twin (same tag and label).
    const label = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').trim().toLowerCase();
    const want = { tag: element.tagName, label: label(element) };
    const onPress = (e: Event) => {
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return;
      if (element.contains(t)) return advance();
      const twin = t.closest(element.tagName);
      if (twin && !element.isConnected && twin.tagName === want.tag && label(twin) === want.label && want.label) advance();
    };
    if (!isField) document.addEventListener('pointerdown', onPress, { capture: true, passive: true });
    this.#followCleanup = () => {
      element.removeEventListener(type, advance);
      if (!isField) document.removeEventListener('pointerdown', onPress, { capture: true } as EventListenerOptions);
      if (timer && !pressed) clearTimeout(timer);
    };
  }

  /** The target may appear shortly after navigation; wait briefly before reporting it missing. */
  #awaitTarget(key: string, index: number, step: GuidanceStep, resolve: () => Element | null): void {
    if (!step.target) return;
    const started = Date.now();
    let reported = false;
    let ticks = 0;
    const reportMissing = () => {
      if (reported) return;
      reported = true;
      this.#track('step_target_missing', index, step);
    };
    const interval = setInterval(() => {
      if (key !== this.#shownStepKey) return clearInterval(interval);
      const element = resolve();
      if (element) {
        clearInterval(interval);
        reported = true; // found in time: nothing to report
        this.#overlay?.relocate();
        this.#follow(key, element);
      } else {
        // Clicky Lite: keep showing the way while it's not there yet (the route can change as they click).
        if (++ticks % 3 === 0) this.#overlay?.updateReveal(this.#revealFor(step));
      }
      if (!element && Date.now() - started > 2500) {
        // Keep looking (the user may open the menu later); just record that it was slow to appear.
        reportMissing();
      }
    }, 150);
    // Leaving the step (next/back/dismiss/complete) before the target appeared still counts as missing.
    this.#followCleanup = () => {
      clearInterval(interval);
      reportMissing();
    };
  }

  #stopFollowing(): void {
    this.#followCleanup?.();
    this.#followCleanup = null;
  }

  #resumeNote(requestId: string | null, index: number): string | null {
    const resume = this.#resume;
    if (!resume || resume.requestId !== requestId || resume.index !== index) return null;
    this.#resume = null; // only the first time this step is shown
    return index === 1 ? 'You’ve already done step 1, so let’s pick up here.' : `You’ve already done steps 1–${index}, so let’s pick up here.`;
  }

  #dismissSteps(): void {
    if (this.#m.send({ type: 'DISMISS', scope: 'steps' }).accepted) this.#track('guidance_dismissed');
  }

  #lookingFor(step: GuidanceStep): string | null {
    const t = step.target;
    if (!t) return null;
    const text = t.strategies.find((s) => s.type !== 'navoro_id');
    return t.label || text?.value || null;
  }

  #render(): void {
    if (!this.#panel) return;
    this.#panel.render(this.#m.state, {
      lastPayload: this.#lastPayload,
      // Local mode always lets people see what was read: it never leaves the device.
      showInspector: this.isDevelopment || this.#local !== null,
      feedbackGiven: this.#feedbackGiven,
      local: this.#local !== null,
    });
  }

  #handleKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape' || ev.defaultPrevented) return;
    const host = this.#root?.host;
    const fromNavoro = host ? ev.composedPath().includes(host) : false;
    // Document-level listener also receives events from our shadow root; handle once.
    if (fromNavoro && ev.currentTarget === document) return;
    const s = this.#m.state;
    if (IN_FLIGHT.has(s.status)) {
      this.stop();
    } else if (this.#overlay?.active) {
      this.#dismissSteps();
    } else if (fromNavoro && this.#panel?.isOpen) {
      this.close();
    } else {
      return;
    }
    if (fromNavoro) ev.stopPropagation();
  }

  #track(type: SdkEventType, stepIndex?: number, step?: GuidanceStep): void {
    if (!this.#events) return;
    const s = this.#m.state;
    const event: SdkEvent = { type };
    if (s.sessionId) event.sessionId = s.sessionId;
    if (s.result?.workflow) event.workflowId = s.result.workflow.id;
    if (typeof stepIndex === 'number') event.stepIndex = stepIndex;
    if (step?.target) event.mappingKey = step.target.key;
    this.#events.push(event);
  }
}
