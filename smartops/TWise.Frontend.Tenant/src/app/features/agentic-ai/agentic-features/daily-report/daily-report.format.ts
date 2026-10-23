/**
 * Presentation helpers of the Daily Report page. They render what the API returned and never derive a figure: codes
 * stay authoritative (the label is the code made readable), and model text is turned into plain blocks rendered by
 * interpolation, so no HTML from a model ever reaches the DOM.
 */

import { QUANTITY_STATUS, codeTerm } from './daily-report.glossary';

/**
 * The label of a code, from the glossary (NO_ACTUAL → "Nothing entered"). A code the glossary does not know is shown
 * the generic way (SOME_CODE → "Some code"), never dropped.
 */
export function codeLabel(code: string | null | undefined): string {
  if (!code) return '';
  const known = codeTerm(code);
  if (known) return known.label;
  const words = code.replace(/_/g, ' ').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/** Colour of a quantity status. Above / below plan are not errors by the business rules, so neither is red. */
export function statusTone(code: string | null | undefined): Tone {
  switch (code) {
    case 'ON_PLAN': return 'ok';
    case 'ABOVE_PLAN': return 'info';
    case 'BELOW_PLAN': return 'warn';
    case 'NO_ACTUAL': return 'bad';
    default: return 'neutral';
  }
}

/** Colour of a task state (open work). */
export function taskStateTone(code: string | null | undefined): Tone {
  switch (code) {
    case 'COMPLETED': return 'ok';
    case 'ONGOING': return 'info';
    case 'ENDED_NOT_COMPLETED': return 'warn';
    default: return 'neutral';
  }
}

/** What a quantity status means, in the glossary's words. */
export function statusHint(code: string): string { return QUANTITY_STATUS[code]?.tip ?? codeLabel(code); }

/** What any code means, when the glossary has a sentence for it. */
export function codeHint(code: string | null | undefined): string { return codeTerm(code)?.tip ?? ''; }

/** Display order of quantity statuses (the runtime's enum order); unknown codes follow as they arrive. */
const STATUS_ORDER = ['ON_PLAN', 'ABOVE_PLAN', 'BELOW_PLAN', 'NO_ACTUAL', 'NOT_VALIDATED'];
export function orderedKeys(counts: Record<string, number> | null | undefined): string[] {
  const keys = Object.keys(counts ?? {});
  return [...STATUS_ORDER.filter(k => keys.includes(k)), ...keys.filter(k => !STATUS_ORDER.includes(k))];
}

/**
 * Splits the day's status counts into the statuses that have tasks (shown as tiles, in display order) and those with
 * none (named once in a line), so six tiles of "0" do not crowd out the ones that matter.
 */
export function splitStatusCounts(counts: Record<string, number> | null | undefined): { shown: string[]; empty: string[] } {
  const keys = orderedKeys(counts);
  return { shown: keys.filter(k => (counts?.[k] ?? 0) > 0), empty: keys.filter(k => !(counts?.[k] ?? 0)) };
}

/** Flags whose count the data-quality counters already show by name, so they are not listed again as chips. */
const COUNTED_BY_A_COUNTER = new Set(['MULTIPLE_TASK_ROWS', 'DUPLICATE_ACTUAL_ENTRY', 'INVALID_DAILY_JSON', 'UNPARSEABLE_ACTUAL_QUANTITY']);

/** The data-quality flags to list as chips: those no counter above them already states. */
export function chipFlags(counts: Record<string, number> | null | undefined): string[] {
  return Object.keys(counts ?? {}).filter(k => !COUNTED_BY_A_COUNTER.has(k));
}

/**
 * A task's progress as a percentage. The schedule records it as a share of the whole task (0.22 = 22%, 1 = done), so
 * a value from 0 to 1 is shown as a percentage; anything else is shown as it came, never guessed at.
 */
export function progressText(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n < 0 || n > 1) return String(n);
  const percent = Math.round(n * 100);
  return n > 0 && percent === 0 ? '<1%' : `${percent}%`;
}

/** The milestone's signed day count, in words (nothing recomputed). */
export function dueText(daysRemaining: number, overdue: boolean): string {
  if (overdue) {
    const d = Math.abs(daysRemaining);
    return `${d} day${d === 1 ? '' : 's'} overdue`;
  }
  if (daysRemaining === 0) return 'due today';
  return `in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
}

/** The question-length rule, read from the runtime's own refusal ("… must be 3 to 500 characters."). */
export function parseLengthRule(message: string): { min: number; max: number } | null {
  const m = /(\d+)\s*to\s*(\d+)\s*characters/i.exec(message ?? '');
  return m ? { min: +m[1], max: +m[2] } : null;
}

// ── Model text → safe blocks ─────────────────────────────────────────────────────────────────────────────────────

export interface TextPart { kind: 'text' | 'strong' | 'value'; text: string }
export interface TextBlock { kind: 'p' | 'h' | 'ul' | 'row'; parts?: TextPart[]; items?: TextPart[][]; text?: string }

function inline(text: string): TextPart[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map(part => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { kind: 'strong', text: part.slice(2, -2) };
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { kind: 'value', text: part.slice(1, -1) };
    return { kind: 'text', text: part };
  });
}

/**
 * Paragraphs, simple bullet lists, headings (shown as bold lines), **bold**, `values` and table rows (shown as one
 * monospace line). Consecutive plain lines are one paragraph.
 */
export function toBlocks(text: string | null | undefined): TextBlock[] {
  const blocks: TextBlock[] = [];
  let bullets: TextPart[][] = [];
  let lines: string[] = [];
  const flushBullets = () => { if (bullets.length) { blocks.push({ kind: 'ul', items: bullets }); bullets = []; } };
  const flushPara = () => { if (lines.length) { blocks.push({ kind: 'p', parts: inline(lines.join(' ')) }); lines = []; } };

  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) { flushPara(); bullets.push(inline(bullet[1])); continue; }
    flushBullets();
    if (!line.trim()) { flushPara(); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flushPara(); blocks.push({ kind: 'h', parts: inline(heading[1]) }); continue; }
    if (line.trim().startsWith('|')) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      flushPara();
      blocks.push({ kind: 'row', text: line.split('|').map(c => c.trim()).filter(Boolean).join('  ·  ') });
      continue;
    }
    lines.push(line.trim());
  }
  flushBullets();
  flushPara();
  return blocks;
}
