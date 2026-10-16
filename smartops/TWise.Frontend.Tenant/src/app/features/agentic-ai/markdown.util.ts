/**
 * Agent answers come as markdown (headings, tables, lists, **bold**). This turns the subset the agents write into
 * HTML for [innerHTML]. Everything is HTML-escaped first, so text from the model or the data can never add tags;
 * Angular's sanitizer runs on the result as well. Column alignment uses classes (style attributes are stripped).
 */
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** **bold**, __bold__, *italic*, _italic_ and `code`, on already-escaped text. */
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(?!\s)([^_]+?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
}

const cells = (row: string) => {
  const t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => c.trim());
};
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function table(lines: string[]): string {
  const head = cells(lines[0]);
  const align = cells(lines[1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'md-c' : c.endsWith(':') ? 'md-r' : ''));
  const cls = (i: number) => (align[i] ? ` class="${align[i]}"` : '');
  const th = head.map((c, i) => `<th${cls(i)}>${inline(c)}</th>`).join('');
  const body = lines.slice(2).map(r => {
    const row = cells(r);
    return `<tr>${head.map((_, i) => `<td${cls(i)}>${inline(row[i] ?? '')}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function markdownToHtml(markdown: string | null | undefined): string {
  const lines = escape(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }

    if (isTableRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush();
      const rows = [line, lines[++i]];
      while (i + 1 < lines.length && isTableRow(lines[i + 1])) rows.push(lines[++i]);
      out.push(table(rows));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flush(); const n = Math.min(heading[1].length + 2, 6); out.push(`<h${n}>${inline(heading[2])}</h${n}>`); continue; }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const tag = bullet ? 'ul' : 'ol';
      const items: string[] = [];
      const re = bullet ? /^\s*[-*•]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/;
      for (; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m) { i--; break; }
        items.push(`<li>${inline(m[1])}</li>`);
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    para.push(line.trim());
  }
  flush();
  return out.join('');
}
