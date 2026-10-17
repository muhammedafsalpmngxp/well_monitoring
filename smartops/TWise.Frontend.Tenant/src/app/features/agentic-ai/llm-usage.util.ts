import { AgentLlmUsage } from './agents.service';

/** 18,240 → "18.2k", 1,250,000 → "1.25M": token counts that fit a card. */
export function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

const full = (n: number) => n.toLocaleString('en-US');

/** "5 calls · 3k input · 240 output · 3.2k total", or a dash when nothing was recorded. */
export function usageLine(u: AgentLlmUsage | null | undefined): string {
  if (!u) return '—';
  return `${u.calls} ${u.calls === 1 ? 'call' : 'calls'} · ${compactTokens(u.promptTokens)} input · `
    + `${compactTokens(u.completionTokens)} output · ${compactTokens(u.totalTokens)} total`;
}

/** Models, most-used first: "gpt-5.6-luna (4), gpt-4o-mini (1)". */
export function modelsLine(u: AgentLlmUsage | null | undefined): string {
  return u?.models.map(m => `${m.model} (${m.calls})`).join(', ') ?? '';
}

/** Full numbers for a tooltip, input and output apart, per model. */
export function usageTitle(u: AgentLlmUsage | null | undefined): string {
  if (!u) return 'No LLM usage recorded yet. Runs made before per-agent usage are not counted.';
  return `${full(u.calls)} LLM calls · ${full(u.promptTokens)} input + ${full(u.completionTokens)} output = ${full(u.totalTokens)} total tokens\n`
    + u.models.map(m => `${m.model}: ${full(m.calls)} calls, ${full(m.promptTokens)} input, ${full(m.completionTokens)} output, `
      + `${full(m.promptTokens + m.completionTokens)} total`).join('\n');
}

/** Just the model names, most-used first: "gpt-5.6-luna, gpt-4o-mini". */
export function modelNames(u: AgentLlmUsage | null | undefined): string {
  return u?.models.map(m => m.model).join(', ') || '—';
}

/** "20,625": input (prompt) tokens in full, or a dash. */
export function inputTokensText(u: AgentLlmUsage | null | undefined): string {
  return u ? full(u.promptTokens) : '—';
}

/** "164": output (completion) tokens in full, or a dash. */
export function outputTokensText(u: AgentLlmUsage | null | undefined): string {
  return u ? full(u.completionTokens) : '—';
}

/** "20,789": input + output tokens in full, or a dash. */
export function totalTokensText(u: AgentLlmUsage | null | undefined): string {
  return u ? full(u.totalTokens) : '—';
}

/** "3 calls", shown under the model. */
export function callsText(u: AgentLlmUsage | null | undefined): string {
  return u ? `${u.calls} ${u.calls === 1 ? 'call' : 'calls'}` : '';
}

/** A stored count in full, or a dash: for runs that have tokens on the row but no per-model breakdown. */
export function countText(n: number | null | undefined): string {
  return n == null ? '—' : full(n);
}
