/** Text helpers for DAX smart compose: what the caret is on, and what accepting a suggestion inserts. */

export type DaxComposeContext =
  | { kind: 'function'; prefix: string; start: number }
  | { kind: 'column'; prefix: string; start: number }
  | { kind: 'none' };

/** Inside a "..." string literal at this position (DAX escapes a quote as ""). */
function inString(text: string, pos: number): boolean {
  let open = false;
  for (let i = 0; i < pos; i++) if (text[i] === '"') open = !open;
  return open;
}

/** What is being typed at the caret: a column after an unclosed "[", or a function name. */
export function composeContext(text: string, caret: number): DaxComposeContext {
  if (inString(text, caret)) return { kind: 'none' };
  const before = text.slice(0, caret);
  const bracket = before.lastIndexOf('[');
  if (bracket > before.lastIndexOf(']')) {
    return { kind: 'column', prefix: before.slice(bracket + 1), start: bracket };
  }
  const word = /[A-Za-z][A-Za-z0-9.]*$/.exec(before);
  // A name right after a quote or "'" is a literal or table name, not a function.
  if (!word || /['"]$/.test(before.slice(0, word.index))) return { kind: 'none' };
  return { kind: 'function', prefix: word[0], start: word.index };
}

/** The function whose argument list contains the caret, for the signature hint. */
export function enclosingFunction(text: string, caret: number): string | null {
  let depth = 0;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const name = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(text.slice(0, i));
        return name && !inString(text, i) ? name[1].toUpperCase() : null;
      }
      depth--;
    }
  }
  return null;
}

/** Column-like snippet parameters are written as [Name] so the engine reads them as column references. */
const COLUMN_PARAM = /^(Column\w*|Date\d?|StartDate|EndDate)$/;

/**
 * Plain text for a snippet such as SUM(${1:ColumnName})$0, and the range of the first
 * placeholder so the caller can select it for over-typing.
 */
export function expandSnippet(snippet: string): { text: string; selectStart: number; selectEnd: number } {
  let text = '';
  let selectStart = -1;
  let selectEnd = -1;
  let last = 0;
  const re = /\$\{(\d+):([^}]*)\}|\$0/g;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    text += snippet.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === '$0') continue;
    const label = m[2];
    const quoted = /"$/.test(text);
    const asColumn = !quoted && COLUMN_PARAM.test(label);
    const start = text.length + (asColumn ? 1 : 0);
    text += asColumn ? `[${label}]` : label;
    if (m[1] === '1') { selectStart = start; selectEnd = start + label.length; }
  }
  text += snippet.slice(last);
  if (selectStart < 0) {
    // No placeholder: put the caret inside empty parentheses, or after the text.
    selectStart = selectEnd = text.endsWith('()') ? text.length - 1 : text.length;
  }
  return { text, selectStart, selectEnd };
}
