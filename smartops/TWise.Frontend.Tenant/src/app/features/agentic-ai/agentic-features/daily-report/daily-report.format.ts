/**
 * Presentation helpers of the Daily Report page. They render what the API returned and never derive a figure: codes
 * stay authoritative (the label is the code made readable), and model text is turned into plain blocks rendered by
 * interpolation, so no HTML from a model ever reaches the DOM.
 */

/** ON_PLAN → "On plan". Unknown codes are shown the same way, never dropped. */
export function codeLabel(code: string | null | undefined): string {
  if (!code) return '';
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

/** What each quantity status means (restates the rule the runtime applied; adds nothing to it). */
const STATUS_HINTS: Record<string, string> = {
  ON_PLAN: 'Reported actual equals the planned quantity.',
  ABOVE_PLAN: 'Reported actual is above the planned quantity. Not an error.',
  BELOW_PLAN: 'Reported actual is below the planned quantity. Not, on its own, an error.',
  NO_ACTUAL: 'No actual quantity was reported for the task on this date.',
  NOT_VALIDATED: 'An actual was reported, but there is no planned quantity to compare it against.',
};
export function statusHint(code: string): string { return STATUS_HINTS[code] ?? codeLabel(code); }

/** Display order of quantity statuses (the runtime's enum order); unknown codes follow as they arrive. */
const STATUS_ORDER = ['ON_PLAN', 'ABOVE_PLAN', 'BELOW_PLAN', 'NO_ACTUAL', 'NOT_VALIDATED'];
export function orderedKeys(counts: Record<string, number> | null | undefined): string[] {
  const keys = Object.keys(counts ?? {});
  return [...STATUS_ORDER.filter(k => keys.includes(k)), ...keys.filter(k => !STATUS_ORDER.includes(k))];
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
