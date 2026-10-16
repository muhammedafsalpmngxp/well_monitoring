import { FieldKind } from '../model-studio.util';

/** A field the formula can name: its text in the formula ("alias.column") and how the list shows it. */
export interface SuggestField { insert: string; table: string; name: string; kind: FieldKind; calculated: boolean; measure?: boolean; }

/** What the text before the caret asks for: the start of the part to replace and what to match. */
export interface SuggestQuery { start: number; term: string; table: string | null; }

/**
 * The field the text just before the caret is asking for, or null. "[" opens the list and what follows it
 * narrows it ("[hou" matches data_hours); a table alias and a dot list that table's fields ("t.da").
 * A "[" that is already closed, or text inside quotes, asks for nothing.
 */
export function suggestQuery(text: string, caret: number, tables: string[]): SuggestQuery | null {
  const before = text.slice(0, caret);
  if (insideQuotes(before)) return null;
  const bracket = /\[([^\[\]\s]*)$/.exec(before);
  if (bracket) {
    const [table, name] = splitTerm(bracket[1], tables);
    return { start: bracket.index, term: name, table };
  }
  const dotted = /(?:^|[^\w.])([A-Za-z_]\w*)\.(\w*)$/.exec(before);
  if (dotted) {
    const table = tables.find(t => t.toLowerCase() === dotted[1].toLowerCase());
    if (table) return { start: caret - dotted[1].length - 1 - dotted[2].length, term: dotted[2], table };
  }
  return null;
}

/**
 * The fields that match: names that start with the term first, then names that contain it, measures and
 * calculated columns ahead of stored columns within each; at most limit, as the list scrolls.
 */
export function matchFields(fields: SuggestField[], query: SuggestQuery, limit = 60): SuggestField[] {
  const term = query.term.toLowerCase();
  const inTable = query.table ? fields.filter(f => f.table.toLowerCase() === query.table!.toLowerCase()) : fields;
  const rank = (f: SuggestField) => (f.measure ? 0 : f.calculated ? 1 : 2);
  const byRank = (list: SuggestField[]) => list.map((f, i) => [f, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([f]) => f);
  const starts = inTable.filter(f => f.name.toLowerCase().startsWith(term));
  const contains = inTable.filter(f => !f.name.toLowerCase().startsWith(term) && f.name.toLowerCase().includes(term));
  return [...byRank(starts), ...byRank(contains)].slice(0, limit);
}

/** The text with the query's part replaced by the field, and where the caret goes. */
export function applySuggestion(text: string, caret: number, query: SuggestQuery, field: SuggestField): { text: string; caret: number } {
  // A "[" the user typed may already have its "]" after the caret; take it out with the query.
  const end = text[caret] === ']' && text[query.start] === '[' ? caret + 1 : caret;
  const next = text.slice(0, query.start) + field.insert + text.slice(end);
  return { text: next, caret: query.start + field.insert.length };
}

function splitTerm(term: string, tables: string[]): [string | null, string] {
  const dot = term.indexOf('.');
  if (dot < 0) return [null, term];
  const table = tables.find(t => t.toLowerCase() === term.slice(0, dot).toLowerCase()) ?? null;
  return table ? [table, term.slice(dot + 1)] : [null, term];
}

/** True when the caret is inside a text literal ('...'), where a bracket is just a character. */
function insideQuotes(before: string): boolean {
  return (before.match(/'/g)?.length ?? 0) % 2 === 1;
}
