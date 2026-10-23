/**
 * On-device guidance engine. Answers a question from a knowledge pack and the
 * sanitized screen context, with no network and no model. Pure and synchronous:
 * it runs in the browser SDK (local mode) and is unit-tested in Node.
 *
 * It uses context in three ways:
 *   1. Visible error codes/messages on screen select the matching troubleshooting rule
 *      ("what's wrong?" next to a validation error).
 *   2. Workflows whose controls are on the current screen rank higher, so ambiguous
 *      questions resolve to what the user is looking at.
 *   3. (In the SDK) walkthroughs start at the step matching where the user already is.
 *
 * It never invents: every step and target comes from the pack, and when nothing in
 * the pack matches it says so instead of guessing.
 */
import type {
  Citation,
  GuidanceKind,
  GuidanceResult,
  GuidanceStep,
  GuidanceTarget,
  KnowledgePack,
  PackChunk,
  PackItem,
  PackMapping,
  PackWorkflow,
  SanitizedContext,
} from '../../contracts/src/sdk-types.ts';
import { bm25, tokenize, type Scored } from './retrieve.ts';

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[“”"'’]/g, '').replace(/\s+/g, ' ').trim();
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const PROCEDURAL = /\b(how|where|create|add|make|new|connect|set|setup|change|edit|update|invite|find|open|start|configure|enable|turn|schedule|build|use|delete|remove|download|import|export|send|save|write|bill|charge|remind|chase|nudge|resend|get|let|request|invoice)\b/i;
const TROUBLE = /\b(why|error|can'?t|cannot|won'?t|doesn'?t|isn'?t|fail(ed|ing|s)?|broken|wrong|problem|issue|stuck|denied|declined?|bounced?|rejected|fix|full)\b/i;
const DEFINITION = /\b(what\s+(is|are|does|do)|what'?s|mean(s|ing)?|define|definition|difference)\b/i;
/**
 * Problems a how-to guide can't solve: the user wants a person, money or account
 * changes, or reports something broken that the docs don't cover. These go straight
 * to support instead of a guessed answer.
 */
const HANDOFF = /\b((talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|your\s+)?(human|person|someone|agent|support|rep(resentative)?)|contact\s+(support|you|someone|a\s+human)|customer\s+(service|support)|real\s+person|refund|charged|overcharged|invoice\s+is\s+wrong|billing\s+(issue|problem)|cancel\s+my\s+(account|subscription|plan)|delete\s+my\s+account|bug|crash(ed|es|ing)?|data\s+(is\s+)?(gone|lost|missing)|lost\s+(my\s+|all\s+(my\s+)?)?(data|work|everything|cards?|notes?|files?)|still\s+(broken|not\s+working|doesn'?t\s+work)|(didn'?t|doesn'?t|did\s+not)\s+help)\b/i;

/** Contact action for unsolved problems: a pre-filled email the user reviews and sends themselves. */
export function contactFallback(pack: Pick<KnowledgePack, 'application' | 'supportEmail' | 'supportUrl'>, question: string, context: SanitizedContext): GuidanceResult['fallback'] {
  const app = pack.application.name;
  if (pack.supportEmail && /^[^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+$/.test(pack.supportEmail)) {
    const subject = `Help with ${app}: ${question.slice(0, 80)}`;
    const body = [question, '', '—', context.route ? `Page: ${context.route}` : null, `Sent from ${app}'s in-app help. Edit anything before sending.`]
      .filter((line) => line !== null)
      .join('\n');
    return { label: 'Email support', url: `mailto:${pack.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
  }
  if (pack.supportUrl && /^https?:\/\//.test(pack.supportUrl)) return { label: 'Contact support', url: pack.supportUrl };
  return { label: `Contact ${app}'s support team`, url: null };
}

interface Candidates {
  workflows: Array<Scored<PackWorkflow>>;
  errors: Array<Scored<PackItem>>;
  contextErrors: PackItem[];
  limits: Array<Scored<PackItem>>;
  concepts: Array<Scored<PackItem>>;
  chunks: Array<Scored<PackChunk>>;
}

function confidenceFrom(hit: { score: number; coverage: number }): number {
  return Math.round(Math.min(0.95, 0.3 + 0.5 * hit.coverage + 0.15 * Math.min(1, hit.score / 6)) * 100) / 100;
}

function excerpt(text: string, max = 220): string {
  const clean = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function bestSentences(text: string, question: string, count = 2): string {
  const terms = new Set(tokenize(question));
  const sentences = text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  if (!sentences.length) return excerpt(text, 400);
  return sentences
    .map((sentence, index) => ({ sentence, index, score: tokenize(sentence).filter((token) => terms.has(token)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence)
    .join(' ');
}

/** Ids of approved controls currently on screen (from the sanitized context). */
function onScreen(context: SanitizedContext): Set<string> {
  return new Set((context.elements ?? []).map((element) => element.navoroId));
}

function navoroIdOf(mapping: PackMapping | undefined): string | null {
  const strategy = mapping?.strategies.find((entry) => entry.type === 'navoro_id');
  return strategy ? strategy.value : null;
}

function retrieve(pack: KnowledgePack, question: string, context: SanitizedContext, mappings: Map<string, PackMapping>): Candidates {
  const errorItems = pack.items.filter((item) => item.kind === 'known_error' || item.kind === 'troubleshooting');
  const visible = context.visibleErrors ?? [];
  const codes = visible.map((error) => error.code).filter((code): code is string => Boolean(code));
  const messages = visible.map((error) => error.message ?? '').filter(Boolean);
  const contextErrors = errorItems.filter((item) => {
    if (item.data.code && codes.includes(item.data.code)) return true;
    return messages.some((message) => normalizeLabel(message).includes(normalizeLabel(item.title)) || normalizeLabel(item.title).includes(normalizeLabel(message)));
  });

  // Context: favour workflows whose controls are on the current screen.
  const present = onScreen(context);
  const workflows = bm25(
    question,
    pack.workflows.map((workflow) => ({
      item: workflow,
      fields: [
        { text: workflow.title, weight: 3 },
        { text: (workflow.aliases ?? []).join(' '), weight: 2.5 },
        { text: workflow.summary, weight: 1 },
        { text: workflow.steps.map((step) => step.instruction).join(' '), weight: 0.5 },
      ],
    })),
  )
    .map((hit) => {
      // Clicky Lite: a question that contains a whole "Also asked as" phrase (or the title) is that task.
      const q = ` ${tokenize(question).join(' ')} `;
      const phrases = [hit.item.title, ...(hit.item.aliases ?? [])].map((a) => tokenize(a).join(' ')).filter((a) => a.includes(' '));
      if (phrases.some((a) => q.includes(` ${a} `))) hit = { ...hit, score: hit.score + 3, coverage: Math.max(hit.coverage, 0.9) };
      if (!present.size) return hit;
      const ids = hit.item.steps.map((step) => navoroIdOf(step.targetKey ? mappings.get(step.targetKey) : undefined)).filter(Boolean);
      const share = ids.length ? ids.filter((id) => present.has(id as string)).length / ids.length : 0;
      return { ...hit, score: hit.score * (1 + 0.2 * share) };
    })
    .sort((a, b) => b.score - a.score);

  return {
    workflows,
    errors: bm25(question, errorItems.map((item) => ({ item, fields: [{ text: item.title, weight: 3 }, { text: item.body, weight: 1 }] }))),
    contextErrors,
    // Only the title and "Also asked as" phrasings: body text mentions everyday words ("send", "invoice").
    limits: bm25(question, pack.items.filter((item) => item.kind === 'limitation').map((item) => ({ item, fields: [{ text: item.title, weight: 3 }, { text: (item.data.labels ?? []).join(' '), weight: 3 }] }))),
    concepts: bm25(
      question,
      pack.items.filter((item) => item.kind === 'ui_concept').map((item) => ({ item, fields: [{ text: item.title, weight: 4 }, { text: item.body, weight: 0.5 }] })),
    ),
    chunks: bm25(question, pack.chunks.map((chunk) => ({ item: chunk, fields: [{ text: chunk.heading ?? '', weight: 2 }, { text: chunk.text, weight: 1 }] }))),
  };
}

function toTarget(mapping: PackMapping | undefined): { target: GuidanceTarget | null; note: string | null } {
  if (!mapping) return { target: null, note: 'No interface control is mapped for this step.' };
  if (mapping.validation === 'broken') {
    return { target: null, note: `The control for this step (“${mapping.label}”) changed and is awaiting review, so it isn’t highlighted.` };
  }
  if (!mapping.strategies.length) return { target: null, note: 'No interface control is mapped for this step.' };
  return {
    target: { key: mapping.key, label: mapping.label, strategies: mapping.strategies, confidence: mapping.confidence, validation: mapping.validation },
    note: null,
  };
}

export function workflowSteps(workflow: PackWorkflow, mappings: Map<string, PackMapping>): GuidanceStep[] {
  return workflow.steps.map((step, index) => {
    const { target, note } = step.targetKey ? toTarget(mappings.get(step.targetKey)) : { target: null, note: null };
    return { index, title: step.title, instruction: step.instruction, target, targetNote: note };
  });
}

function singleTargetStep(mappings: Map<string, PackMapping>, labels: string[], nearNavoroId: string | null, title: string, instruction: string): GuidanceStep[] {
  let mapping: PackMapping | undefined;
  if (nearNavoroId) mapping = [...mappings.values()].find((entry) => navoroIdOf(entry) === nearNavoroId);
  for (const label of labels) {
    if (mapping) break;
    mapping = mappings.get(slug(label));
  }
  const { target, note } = toTarget(mapping);
  if (!target) return [];
  return [{ index: 0, title, instruction, target, targetNote: note }];
}

/** "How do I send an invoice?" style question for a workflow. */
export function workflowQuestion(workflow: PackWorkflow): string {
  return `How do I ${workflow.title.charAt(0).toLowerCase()}${workflow.title.slice(1)}?`;
}

/** Clicky Lite: the closest things to offer instead of a dead end (2-3 tappable questions). */
function suggestQuestions(pack: KnowledgePack, question: string, candidates: Candidates): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    if (!out.includes(q) && out.length < 3) out.push(q);
  };
  const scored: Array<{ q: string; score: number }> = [
    ...candidates.workflows.slice(0, 3).map((hit) => ({ q: workflowQuestion(hit.item), score: hit.score })),
    ...candidates.concepts.slice(0, 2).map((hit) => ({ q: `What does “${hit.item.title}” mean?`, score: hit.score * 0.8 })),
    ...candidates.errors.slice(0, 1).map((hit) => ({ q: `Why: ${hit.item.title}?`, score: hit.score * 0.7 })),
  ].sort((a, b) => b.score - a.score);
  for (const entry of scored) add(entry.q);
  for (const s of pack.launcher.suggestions) add(s);
  void question;
  return out;
}

/** Damerau (optimal string alignment) distance, capped: enough for one or two typos. */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

const vocabCache = new WeakMap<KnowledgePack, Set<string>>();
const COMMON = new Set('how do does can where what why when who is are was the a an my me i to of in on for and or with it this that you your show find take open go see get make new add send set turn up off out help please want need about any all some one two its im dont cant wont isnt there here which page tab'.split(' '));

function packVocab(pack: KnowledgePack): Set<string> {
  let vocab = vocabCache.get(pack);
  if (vocab) return vocab;
  vocab = new Set<string>();
  const add = (text: string | undefined | null) => {
    for (const word of (text ?? '').toLowerCase().match(/[a-z]+/g) ?? []) if (word.length >= 3) vocab!.add(word);
  };
  add(pack.application.name);
  for (const w of pack.workflows) {
    add(w.title);
    add(w.summary);
    for (const a of w.aliases ?? []) add(a);
    for (const step of w.steps) add(step.instruction);
  }
  for (const item of pack.items) {
    add(item.title);
    add(item.body);
    for (const l of item.data.labels ?? []) add(l);
  }
  for (const m of pack.mappings) add(m.label);
  for (const p of pack.places ?? []) {
    add(p.label);
    for (const k of p.keywords ?? []) add(k);
  }
  for (const [k, v] of Object.entries(pack.synonyms ?? {})) {
    add(k);
    add(v);
  }
  vocabCache.set(pack, vocab);
  return vocab;
}

/**
 * Clicky Lite: tidy a question before matching. Lower-cases, fixes small typos against the
 * words in the app's docs ("invoce" → "invoice"), and applies the pack's synonyms
 * ("customer" → "client"). `extra` adds words seen on screen (labels, names).
 */
export function cleanQuestion(pack: KnowledgePack, question: string, extra: Iterable<string> = []): string {
  const vocab = new Set(packVocab(pack));
  for (const word of extra) if (word.length >= 3) vocab.add(word.toLowerCase());
  const synonyms = pack.synonyms ?? {};
  return question
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[a-z]+/g, (word) => {
      let fixed = word;
      if (word.length >= 4 && !vocab.has(word) && !COMMON.has(word)) {
        const max = word.length >= 7 ? 2 : 1;
        let best: string | null = null;
        let bestD = max + 1;
        let tie = false;
        for (const candidate of vocab) {
          if (Math.abs(candidate.length - word.length) > max) continue;
          const d = editDistance(word, candidate, max);
          if (d < bestD) {
            bestD = d;
            best = candidate;
            tie = false;
          } else if (d === bestD && best && candidate !== best && candidate.slice(0, 4) !== best.slice(0, 4)) {
            tie = true;
          }
        }
        if (best && bestD <= max && !tie) fixed = best;
      }
      return synonyms[fixed] ?? fixed;
    });
}

export interface LocalAnswer {
  result: GuidanceResult;
  /** Short topic label (workflow / error / term title) for any on-device analytics the host keeps. */
  topic: string;
  match: 'handoff' | 'error' | 'term' | 'limit' | 'workflow' | 'concept' | 'chunk' | 'none';
  /** Share of the question's words the match covered (0-1). */
  coverage: number;
}

export function answerLocally(
  pack: KnowledgePack,
  input: { question: string; context: SanitizedContext; requestId: string; sessionId?: string },
): LocalAnswer {
  const question = cleanQuestion(pack, input.question.trim().slice(0, 500));
  const context = input.context;
  const mappings = new Map(pack.mappings.map((mapping) => [mapping.key, mapping]));
  const candidates = retrieve(pack, question, context, mappings);

  let kind: GuidanceKind = 'unresolved';
  let answer = `I couldn't find this in ${pack.application.name}'s help, so I'd rather not guess. Try naming the feature or screen you're working with.`;
  let grounded = false;
  let confidence = 0;
  let workflow: PackWorkflow | null = null;
  let steps: GuidanceStep[] = [];
  let citations: Citation[] = [];
  let topic = 'Unmatched questions';
  /** Clicky Lite: which rule answered, so the SDK can weigh it against the on-screen finder. */
  let match: LocalAnswer['match'] = 'none';
  let coverage = 0;

  const topWorkflow = candidates.workflows[0];
  const topLimit = candidates.limits[0];
  // Clicky Lite: a bare glossary term ("net 30", "overdue") is a definition question.
  const qTokens = tokenize(question).join(' ');
  const exactConcept = qTokens ? (candidates.concepts.find((hit) => tokenize(hit.item.title).join(' ') === qTokens)?.item ?? null) : null;
  const troubleIntent = TROUBLE.test(question);
  const contextError = candidates.contextErrors[0];
  const questionError = candidates.errors[0];
  // An error on screen only answers questions about a problem ("why", "what's wrong"),
  // vague ones ("help?"), or ones that match that error — never unrelated questions.
  // Vague = short and not clearly about any documented task ("help?", "what now").
  const vague = tokenize(question).length <= 3 && !(topWorkflow && topWorkflow.coverage >= 0.5);
  const handoffIntent = HANDOFF.test(question);
  // Clicky Lite: "resend the payment link" next to the error is a task, not "what's wrong?".
  const wantsTask = Boolean(topWorkflow && topWorkflow.coverage >= 0.75 && PROCEDURAL.test(question) && !troubleIntent);
  const errorPick = handoffIntent
    ? null
    : contextError && (troubleIntent || vague || (questionError?.item.id === contextError.id && !wantsTask))
    ? { item: contextError, confidence: 0.9 }
    : questionError && troubleIntent && questionError.coverage >= 0.4
      ? { item: questionError.item, confidence: confidenceFrom(questionError) }
      : null;

  if (handoffIntent) {
    kind = 'unresolved';
    answer = `That sounds like something the ${pack.application.name} support team needs to handle. I can only show you how to do things in the app, so I've written up your question below. Check it and send it.`;
    topic = 'Handed off to support';
    match = 'handoff';
  } else if (errorPick) {
    const data = errorPick.item.data;
    const description = errorPick.item.body.split('\n\n')[0] ?? '';
    const resolution = data.resolution ?? '';
    const near = (context.visibleErrors ?? []).find((error) => error.code && error.code === data.code)?.nearNavoroId ?? null;
    kind = 'troubleshooting';
    answer = [description, resolution].filter(Boolean).join(' ').trim();
    grounded = true;
    confidence = errorPick.confidence;
    steps = singleTargetStep(mappings, data.labels ?? [], near, 'Fix it here', resolution || description);
    citations = [{ sourceId: errorPick.item.id, sourceTitle: errorPick.item.sourceTitle, excerpt: excerpt(errorPick.item.body) }];
    topic = errorPick.item.title;
    match = 'error';
    coverage = errorPick.confidence;
  } else if (topLimit && topLimit.coverage >= 0.75 && topLimit.coverage > (topWorkflow?.coverage ?? 0) - 0.01 && !(topWorkflow && topWorkflow.coverage >= topLimit.coverage && topWorkflow.score > topLimit.score)) {
    // Clicky Lite: something the app can't do. Say so plainly and offer support.
    kind = 'unresolved';
    answer = `${pack.application.name} can't do that yet: ${topLimit.item.title.charAt(0).toLowerCase()}${topLimit.item.title.slice(1)} isn't available. ${topLimit.item.body}`.trim();
    grounded = true;
    confidence = confidenceFrom(topLimit);
    citations = [{ sourceId: topLimit.item.id, sourceTitle: topLimit.item.sourceTitle, excerpt: excerpt(topLimit.item.body) }];
    topic = topLimit.item.title;
    match = 'limit';
    coverage = topLimit.coverage;
  } else if (exactConcept) {
    const label = exactConcept.data.label ?? exactConcept.title;
    kind = 'answer';
    answer = `${exactConcept.title}: ${exactConcept.body}`;
    grounded = true;
    confidence = 0.9;
    steps = singleTargetStep(mappings, [label], null, `Here’s “${label}”`, exactConcept.body);
    citations = [{ sourceId: exactConcept.id, sourceTitle: exactConcept.sourceTitle, excerpt: excerpt(exactConcept.body) }];
    topic = exactConcept.title;
    match = 'term';
    coverage = 1;
  } else if (topWorkflow && topWorkflow.coverage >= 0.5 && topWorkflow.score >= 1 && (PROCEDURAL.test(question) || topWorkflow.coverage >= 0.75) && !DEFINITION.test(question)) {
    workflow = topWorkflow.item;
    steps = workflowSteps(workflow, mappings);
    const lead = `Here's how to ${workflow.title.charAt(0).toLowerCase()}${workflow.title.slice(1)}: ${steps.length} step${steps.length === 1 ? '' : 's'}. I'll point to each control as you go.`;
    const prereq = workflow.prerequisites.length ? ` Before you start: ${workflow.prerequisites.join('; ')}.` : '';
    kind = 'workflow';
    answer = `${lead}${prereq}`;
    grounded = true;
    confidence = Math.min(confidenceFrom(topWorkflow), workflow.confidence + 0.05);
    citations = [{ sourceId: workflow.id, sourceTitle: workflow.sourceTitle, excerpt: excerpt(workflow.excerpt || workflow.summary) }];
    topic = workflow.title;
    match = 'workflow';
    coverage = topWorkflow.coverage;
  } else {
    const concept = candidates.concepts[0];
    const chunk = candidates.chunks[0];
    const sameTerm = concept ? tokenize(concept.item.title).join(' ') === tokenize(question).join(' ') : false;
    if (concept && concept.coverage >= 0.5 && (DEFINITION.test(question) || sameTerm)) {
      const label = concept.item.data.label ?? concept.item.title;
      kind = 'answer';
      answer = `${concept.item.title}: ${concept.item.body}`;
      grounded = true;
      confidence = confidenceFrom(concept);
      steps = singleTargetStep(mappings, [label], null, `Here’s “${label}”`, concept.item.body);
      citations = [{ sourceId: concept.item.id, sourceTitle: concept.item.sourceTitle, excerpt: excerpt(concept.item.body) }];
      topic = concept.item.title;
      match = 'concept';
      coverage = concept.coverage;
    } else if (chunk && chunk.coverage >= 0.5) {
      kind = 'answer';
      answer = bestSentences(chunk.item.text, question);
      grounded = true;
      confidence = confidenceFrom(chunk);
      citations = [{ sourceId: chunk.item.id, sourceTitle: chunk.item.sourceTitle, excerpt: excerpt(chunk.item.text) }];
      topic = chunk.item.heading ?? chunk.item.sourceTitle;
      match = 'chunk';
      coverage = chunk.coverage;
    }
  }

  // Always attached: the panel shows it up front when the answer is unresolved or
  // low-confidence, and after "Not helpful" otherwise.
  const fallback = contactFallback(pack, input.question.trim().slice(0, 500), context);

  const suggestions = kind === 'unresolved' && !handoffIntent && match !== 'limit' ? suggestQuestions(pack, question, candidates) : undefined;

  return {
    topic,
    match,
    coverage,
    result: {
      sessionId: input.sessionId ?? `local-${input.requestId}`,
      requestId: input.requestId,
      kind,
      answer: answer.slice(0, 1200),
      grounded,
      confidence,
      workflow: workflow ? { id: workflow.id, title: workflow.title } : null,
      steps,
      citations: citations.slice(0, 4),
      mode: 'local',
      fallback,
      ...(suggestions?.length ? { suggestions } : {}),
      ...(handoffIntent ? { handoff: true } : {}),
    },
  };
}
