import { AgentStep, SaveAgentRequest } from '../agents.service';

/**
 * Agent analyzer: counts, heuristic scores, token / cost estimates (expected and worst case) and findings with
 * what / why / fix, computed from the agent as it is on the page. Estimates use rough per-tool token profiles and the
 * tenant's price catalog; they help review a design, they do not measure it (real usage comes from runs).
 */

export type ModelClass = 'frontier' | 'standard' | 'fast';
export interface ModelPrice { model: string; modelClass: ModelClass; inputPer1M: number; outputPer1M: number; }
export interface PriceCatalog { activeModel: string | null; fastModel: string | null; prices: ModelPrice[]; }
export interface ModelUsage { model: string; calls: number; input: number; output: number; }

export interface StepEstimate {
  index: number; label: string; tool: string; model: string | null; modelClass: ModelClass | null;
  calls: number; input: number; output: number; expectedRuns: number; worstRuns: number;
}
export interface Finding { severity: 'error' | 'warning' | 'info'; what: string; why: string; fix: string; stepId?: string | null; }
export interface Analysis {
  counts: {
    steps: number; agents: number; llmCallsExpected: number; llmCallsWorst: number; tools: number; routers: number; loops: number;
    forEach: number; approvals: number; subagents: number; depth: number; parallelBranches: number; expectedExecutions: number;
  };
  scores: { efficiency: number; reliability: number; complexity: number; llmDependency: number; humanDependency: number; frontierDependency: number };
  tokens: { expected: number; worst: number; byClass: Record<ModelClass, { expected: number; worst: number }> };
  cost: { expected: number | null; worst: number | null; byModel: { model: string; expected: number; worst: number; priced: boolean }[]; missingPrices: string[] };
  steps: StepEstimate[];
  findings: Finding[];
}

/** Tokens per execution of one step, by tool: [calls, input per call, output per call]. Rough, on purpose. */
const PROFILE: Record<string, [number, number, number]> = {
  ask_ai: [1, 1500, 500], 'ask_data:deep': [6, 3500, 250], 'ask_data:normal': [3, 3000, 250], url_context: [1, 2500, 500],
  api: [2, 1500, 300], load_memory: [1, 1800, 400], preload_memory: [1, 3500, 400], exit_loop: [1, 1500, 60],
  subagent: [4, 2500, 400], approval: [0, 0, 0], evaluator: [1, 1500, 80], guardrail: [1, 1200, 60], compute: [0, 0, 0], merge: [0, 0, 0],
};
const EXTERNAL = ['api', 'url_context', 'subagent', 'ask_data'];
const FOR_EACH_EXPECTED = 5, FOR_EACH_MAX = 20, HISTORY_PER_STEP = 250, LARGE_CONTEXT = 30000;

const toolOf = (a: SaveAgentRequest, s: AgentStep) => s.tool ?? a.tools[0] ?? { agent: '?', action: '' };
const keyOf = (a: SaveAgentRequest, s: AgentStep) => { const t = toolOf(a, s); return t.agent === 'ask_data' ? `ask_data:${t.action === 'normal' ? 'normal' : 'deep'}` : t.agent; };
const label = (s: AgentStep, i: number) => `${i + 1}. ${(s.text || '').slice(0, 40)}`;

/** A model's class: the catalog's, else a guess from its name. */
export function classOf(model: string | null, catalog: PriceCatalog): ModelClass | null {
  if (!model) return null;
  const known = catalog.prices.find(p => p.model.toLowerCase() === model.toLowerCase());
  if (known) return known.modelClass;
  if (/mini|nano|haiku|flash|lite|small|\b\d+b\b/i.test(model)) return 'fast';
  if (/opus|ultra|gpt-5|\bo[134]\b|-pro\b|large/i.test(model)) return 'frontier';
  return 'standard';
}

/** What tokens cost on a model (USD), or null without a price. */
export function priceOf(model: string, input: number, output: number, catalog: PriceCatalog): number | null {
  const p = catalog.prices.find(x => x.model.toLowerCase() === model.toLowerCase());
  return p ? (input * p.inputPer1M + output * p.outputPer1M) / 1_000_000 : null;
}

/** A run's real cost from its usage per model; unpriced models are listed. */
export function costOfUsage(usage: ModelUsage[], catalog: PriceCatalog): { cost: number; unpriced: string[]; input: number; output: number } {
  let cost = 0;
  const unpriced: string[] = [];
  for (const u of usage) {
    const c = priceOf(u.model, u.input, u.output, catalog);
    if (c === null) unpriced.push(u.model); else cost += c;
  }
  return { cost, unpriced, input: usage.reduce((n, u) => n + u.input, 0), output: usage.reduce((n, u) => n + u.output, 0) };
}

export function analyzeAgent(agent: SaveAgentRequest, catalog: PriceCatalog, opts: { budget?: number | null; issues?: string[] } = {}): Analysis {
  const steps = agent.steps;
  const max = Math.max(1, agent.maxIterations || 5);
  const idIndex = new Map(steps.map((s, i) => [s.id ?? `#${i}`, i]));
  const tools = steps.filter(s => s.kind !== 'router');
  const findings: Finding[] = [];

  // ── how often each step runs ──
  const expected = steps.map(() => 1), worst = steps.map(() => 1);
  if (agent.type === 'loop') steps.forEach((_, i) => { expected[i] = Math.min(2, max); worst[i] = max; });
  const backLinks: { router: number; target: number; label: string }[] = [];
  steps.forEach((s, r) => {
    if (s.kind !== 'router') return;
    const forward = (s.branches ?? []).filter(b => b.target && b.target !== 'answer' && (idIndex.get(b.target) ?? -1) > r);
    for (const b of s.branches ?? []) {
      const t = b.target ? idIndex.get(b.target) : undefined;
      if (t !== undefined && t < r) {
        backLinks.push({ router: r, target: t, label: b.label || 'branch' });
        for (let k = t; k <= r; k++) { expected[k] *= max >= 2 ? 1.5 : 1; worst[k] *= max; }
      }
    }
    // Exclusive branches: on average only one of them runs.
    if (forward.length >= 2) for (const b of forward) { const t = idIndex.get(b.target!)!; expected[t] /= forward.length; }
  });
  // An Evaluator sends the run back like a loop-back (to retryFrom, else the step before it).
  steps.forEach((s, r) => {
    if (s.kind === 'router' || toolOf(agent, s).agent !== 'evaluator' || r === 0) return;
    const back = s.options?.['retryFrom'] ? idIndex.get(String(s.options['retryFrom'])) : r - 1;
    if (back === undefined || back >= r) return;
    backLinks.push({ router: r, target: back, label: 'Evaluator fail' });
    for (let k = back; k <= r; k++) { expected[k] *= max >= 2 ? 1.3 : 1; worst[k] *= max; }
  });
  steps.forEach((s, i) => { if (s.forEach) { expected[i] *= FOR_EACH_EXPECTED; worst[i] *= FOR_EACH_MAX; } });

  // ── tokens per step ──
  const active = catalog.activeModel || '(active model)';
  const resolve = (s: AgentStep) => s.model?.trim() || active;
  const est: StepEstimate[] = [];
  let history = 0;
  steps.forEach((s, i) => {
    if (s.kind === 'router') {
      const ai = s.routeBy === 'ai';
      est.push({ index: i, label: label(s, i), tool: ai ? 'router (AI)' : 'router (rules)', model: ai ? active : null,
        modelClass: ai ? classOf(active, catalog) : null, calls: ai ? 1 : 0, input: ai ? 1200 + history : 0, output: ai ? 60 : 0,
        expectedRuns: expected[i], worstRuns: worst[i] });
      return;
    }
    const key = keyOf(agent, s);
    const guardNoAi = key === 'guardrail' && !String(s.options?.['policy'] ?? '').trim();   // a guardrail without a policy only runs rules
    const [calls, inp, out] = guardNoAi ? [0, 0, 0] : PROFILE[key] ?? [0, 0, 0];    // other tools (agent services) run on their own models
    const model = calls ? resolve(s) : null;
    est.push({ index: i, label: label(s, i), tool: key, model, modelClass: classOf(model, catalog), calls,
      input: calls ? inp + history : 0, output: key === 'ask_ai' && s.maxTokens ? s.maxTokens : out, expectedRuns: expected[i], worstRuns: worst[i] });
    history = Math.min(history + HISTORY_PER_STEP, 6000);
  });

  // ── once per run: supervisor / loop decisions, the combined answer, output fields, memory ──
  const extra = (name: string, calls: number, input: number, output: number, exp: number, wst: number, model: string = active) =>
    est.push({ index: -1, label: name, tool: 'agent', model, modelClass: classOf(model, catalog), calls, input, output, expectedRuns: exp, worstRuns: wst });
  if (agent.type === 'supervisor') extra('Supervisor decisions', 1, 1800, 80, Math.min(tools.length + 1, max), max);
  if (agent.type === 'loop') extra('Loop check', 1, 1500, 60, Math.min(2, max), max);
  const lastTool = tools.length ? toolOf(agent, tools[tools.length - 1]).agent : '';
  // Ending with Compute / Merge: that answer is the answer, no combining call.
  if (tools.length > 1 && !(agent.type !== 'parallel' && ['compute', 'merge'].includes(lastTool))) {
    const outs = est.filter(e => e.index >= 0).reduce((n, e) => n + e.output * e.expectedRuns, 0);
    extra('Final answer (combines the steps)', 1, outs + 800, 600, 1, 1);
  }
  if (agent.outputs?.length) extra('Structured output fields', 1, 1200, 200, 1, 1);
  if (tools.some(s => ['load_memory', 'preload_memory'].includes(toolOf(agent, s).agent))) extra('Remember new facts', 1, 2000, 150, 1, 1);

  // Supervisor: at most max_iterations worker runs in all, so the worst case is max × the costliest worker.
  if (agent.type === 'supervisor') {
    const workers = est.filter(e => e.index >= 0);
    const costliest = Math.max(0, ...workers.map(e => e.calls * (e.input + e.output)));
    workers.forEach(e => { e.worstRuns = e.calls * (e.input + e.output) === costliest ? max : 0; });
  }

  // ── totals ──
  const byClass: Record<ModelClass, { expected: number; worst: number }> = { frontier: { expected: 0, worst: 0 }, standard: { expected: 0, worst: 0 }, fast: { expected: 0, worst: 0 } };
  const byModel = new Map<string, { input: number; output: number; inputW: number; outputW: number }>();
  let expTokens = 0, worstTokens = 0, callsExp = 0, callsWorst = 0;
  for (const e of est) {
    if (!e.calls || !e.model) continue;
    const per = e.calls * (e.input + e.output);
    expTokens += per * e.expectedRuns; worstTokens += per * e.worstRuns;
    callsExp += e.calls * e.expectedRuns; callsWorst += e.calls * e.worstRuns;
    const c = e.modelClass ?? 'standard';
    byClass[c].expected += per * e.expectedRuns; byClass[c].worst += per * e.worstRuns;
    const m = byModel.get(e.model) ?? { input: 0, output: 0, inputW: 0, outputW: 0 };
    m.input += e.calls * e.input * e.expectedRuns; m.output += e.calls * e.output * e.expectedRuns;
    m.inputW += e.calls * e.input * e.worstRuns; m.outputW += e.calls * e.output * e.worstRuns;
    byModel.set(e.model, m);
  }
  const models = [...byModel.entries()].map(([model, m]) => {
    const exp = priceOf(model, m.input, m.output, catalog), wst = priceOf(model, m.inputW, m.outputW, catalog);
    return { model, expected: exp ?? 0, worst: wst ?? 0, priced: exp !== null };
  });
  const missingPrices = models.filter(m => !m.priced).map(m => m.model);
  const priced = models.length > 0 && missingPrices.length === 0;

  // ── counts ──
  const routers = steps.filter(s => s.kind === 'router').length;
  const approvals = tools.filter(s => toolOf(agent, s).agent === 'approval').length;
  const subagents = tools.filter(s => toolOf(agent, s).agent === 'subagent').length;
  const forEach = tools.filter(s => s.forEach).length;
  const loops = (agent.type === 'loop' ? 1 : 0) + backLinks.length;
  const llmSteps = est.filter(e => e.index >= 0 && e.calls > 0).length;
  const counts = {
    steps: steps.length, agents: tools.length, llmCallsExpected: Math.round(callsExp), llmCallsWorst: Math.round(callsWorst),
    tools: new Set(tools.map(s => `${toolOf(agent, s).agent}:${toolOf(agent, s).action}`)).size, routers, loops, forEach, approvals, subagents,
    depth: depthOf(agent), parallelBranches: Math.max(agent.type === 'parallel' ? steps.length : 1, forEach ? 5 : 1),
    expectedExecutions: Math.round(expected.reduce((n, x) => n + x, 0) * 10) / 10,
  };

  // ── findings ──
  for (const text of opts.issues ?? []) findings.push({ severity: 'error', what: text, why: 'The run would fail or skip steps.', fix: 'Fix it on the canvas (the issues pill selects the step).' });
  const fast = catalog.fastModel;
  const cheaper = steps.filter(s => (s.kind === 'router' ? s.routeBy === 'ai' : toolOf(agent, s).agent === 'ask_ai')
    && /\b(classify|one word|yes or no|reply (ok|yes|no|data)|label|categor|which kind|which type|intent)/i.test(s.text)
    && classOf(s.model?.trim() || catalog.activeModel, catalog) !== 'fast');
  if (cheaper.length && fast) findings.push({ severity: 'info', what: `${cheaper.map(s => label(s, steps.indexOf(s))).join(', ')} only classify or pick a word.`,
    why: `A full model costs more and is slower than needed for that.`, fix: `Set Model to the fast model (${fast}) on ${cheaper.length > 1 ? 'these steps' : 'this step'}.`, stepId: cheaper[0].id });
  const reformat = tools.filter(s => toolOf(agent, s).agent === 'ask_ai' && /^(format|reformat|rename|convert|copy|translate)\b/i.test(s.text.trim()));
  if (reformat.length) findings.push({ severity: 'info', what: `${reformat.map(s => label(s, steps.indexOf(s))).join(', ')} may only reformat earlier answers.`,
    why: 'Each model call adds time, tokens and a chance of changing facts.', fix: 'Use a Compute step (template, no AI), fold it into the final answer, or use the fast model.', stepId: reformat[0].id });
  const unRetried = tools.filter(s => EXTERNAL.includes(toolOf(agent, s).agent) && !s.retries);
  if (unRetried.length) findings.push({ severity: 'warning', what: `${unRetried.length} step${unRetried.length > 1 ? 's call' : ' calls'} an outside system without retries (${unRetried.map(s => steps.indexOf(s) + 1).join(', ')}).`,
    why: 'A timeout or a busy service then fails the whole run.', fix: 'Set "Retries on failure" to 2 on those steps.', stepId: unRetried[0].id });
  const reviews = approvals > 0 || tools.some(s => ['exit_loop', 'evaluator'].includes(toolOf(agent, s).agent)) || steps.some(s => s.kind === 'router' && s.routeBy === 'ai')
    || tools.some(s => /\b(review|check|verify|critique|validate)\b/i.test(s.text));
  if (tools.length >= 3 && !reviews) findings.push({ severity: 'info', what: 'Nothing checks the answer before Output.',
    why: 'Multi-step answers can drift or miss a fact; a check catches it before people see it.', fix: 'Add an Evaluator (Built-in Tools) after the draft: it sends the run back with the reason when the answer misses your criteria. Or a Human Approval.' });
  const big = est.filter(e => e.calls && e.input > LARGE_CONTEXT);
  if (big.length) findings.push({ severity: 'warning', what: `${big.map(e => e.label).join(', ')} may send about ${Math.round(Math.max(...big.map(e => e.input)) / 1000)}k tokens per call.`,
    why: 'Large context is slow and costly, and models miss details in the middle.', fix: 'Pass only what is needed: output keys instead of full history, fewer For Each items, or summarise first.' });
  if (expTokens > 0 && worstTokens / expTokens > 3) findings.push({ severity: 'warning', what: `The worst case is about ${Math.round(worstTokens / expTokens)}× the expected run.`,
    why: 'Loops, loop-backs and For Each multiply the cost when they run to their limits.', fix: 'Lower Max iterations, cap the list for For Each, or add an Exit Loop / Conditional that stops early.' });
  const frontierShare = expTokens ? byClass.frontier.expected / expTokens : 0;
  if (frontierShare > 0.7 && fast) findings.push({ severity: 'info', what: `${Math.round(frontierShare * 100)}% of the tokens go to frontier models.`,
    why: 'Frontier models cost several times more per token.', fix: `Use the fast model (${fast}) for routing, classifying and short steps.` });
  for (const b of backLinks) findings.push({ severity: 'info', what: `"${b.label}" of step ${b.router + 1} goes back to step ${b.target + 1}.`,
    why: `Steps ${b.target + 1}–${b.router + 1} can repeat up to ${max} times (Max iterations); the worst case counts that.`, fix: 'Intended for draft ↔ review. Lower Max iterations if fewer rounds are enough.', stepId: steps[b.router].id });
  if (agent.type === 'sequential') {
    const keys = new Set(steps.map(s => s.outputKey).filter(Boolean) as string[]);
    for (let i = 0; i + 1 < steps.length; i++) {
      const a = steps[i], b = steps[i + 1];
      const data = (s: AgentStep) => s.kind !== 'router' && !s.next && !s.forEach && ['ask_data', 'api', 'url_context', 'subagent'].includes(toolOf(agent, s).agent);
      const usesA = a.outputKey && b.text.includes(`{{${a.outputKey}}}`);
      if (data(a) && data(b) && !usesA && ![...keys].some(k => b.text.includes(`{{${k}}}`))) {
        findings.push({ severity: 'info', what: `Steps ${i + 1} and ${i + 2} do not use each other's answers.`,
          why: 'Run one after another, they take the time of both.', fix: 'Make the agent Parallel (when no step depends on another) or run them as one For Each over a list.', stepId: b.id });
        break;
      }
    }
  }
  if (opts.budget && worstTokens > opts.budget) findings.push({ severity: expTokens > opts.budget ? 'error' : 'warning',
    what: `${expTokens > opts.budget ? 'The expected run' : 'The worst case'} uses more than the budget of ${opts.budget.toLocaleString()} tokens.`,
    why: 'Runs over budget cost more than planned.', fix: 'See the steps with the most tokens below.' });

  // ── scores (heuristics, 0–100) ──
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const ratio = expTokens ? worstTokens / expTokens : 1;
  const externalOk = unRetried.length === 0;
  const scores = {
    efficiency: clamp(100 - Math.min(40, callsExp * 2) - frontierShare * 25 - (ratio > 3 ? 15 : ratio > 2 ? 5 : 0) - 5 * cheaper.length - 5 * reformat.length),
    reliability: clamp(55 + (externalOk ? 15 : 0) + (reviews ? 15 : 0) + (tools.some(s => s.expectedOutput) || agent.outputs?.length ? 10 : 0)
      + ((opts.issues ?? []).length ? -20 * Math.min(2, opts.issues!.length) : 5)),
    complexity: clamp(steps.length * 4 + routers * 8 + loops * 10 + counts.depth * 2 + subagents * 10 + forEach * 6 + approvals * 4),
    llmDependency: tools.length ? clamp(llmSteps / tools.length * 100) : 0,
    humanDependency: tools.length ? clamp(approvals / tools.length * 100) : 0,
    frontierDependency: clamp(frontierShare * 100),
  };

  return {
    counts, scores,
    tokens: { expected: Math.round(expTokens), worst: Math.round(worstTokens), byClass },
    cost: { expected: priced ? models.reduce((n, m) => n + m.expected, 0) : null, worst: priced ? models.reduce((n, m) => n + m.worst, 0) : null, byModel: models, missingPrices },
    steps: est, findings,
  };
}

/** The longest path through the steps (routers' forward branches and links; loop-backs not counted). */
function depthOf(agent: SaveAgentRequest): number {
  const steps = agent.steps;
  if (agent.type === 'parallel') return steps.length ? 1 : 0;
  if (agent.type === 'supervisor') return steps.length ? 2 : 0;
  const idIndex = new Map(steps.map((s, i) => [s.id ?? `#${i}`, i]));
  const memo = new Map<number, number>();
  const next = (i: number): number[] => {
    const s = steps[i];
    if (s.kind === 'router') return (s.branches ?? []).map(b => (b.target ? idIndex.get(b.target) : undefined)).filter((t): t is number => t !== undefined && t > i);
    if (s.next) return s.next === 'answer' ? [] : [idIndex.get(s.next)].filter((t): t is number => t !== undefined && t > i);
    return i + 1 < steps.length ? [i + 1] : [];
  };
  const longest = (i: number): number => {
    if (memo.has(i)) return memo.get(i)!;
    const d = 1 + Math.max(0, ...next(i).map(longest));
    memo.set(i, d);
    return d;
  };
  return steps.length ? longest(0) : 0;
}
