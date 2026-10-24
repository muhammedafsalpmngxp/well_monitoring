import type { AskDataChart } from '../services/ai.service';

/**
 * Answers sometimes carry a chart written as Mermaid code ("```mermaid pie title … "A" : 240 …```"). The panel draws
 * charts itself (Highcharts), so the code is never shown as text: it is removed from the answer, and a pie chart's
 * labels and values become the answer's chart when the answer has none of its own.
 */

// A complete block: ``` or `` (the fence is sometimes cut to two backticks), "mermaid", the code, the same fence.
const BLOCK = /(`{2,3})[ \t]*mermaid\b([\s\S]*?)\1/gi;
// A block still streaming in (its closing fence has not arrived yet): everything from the opening fence on.
const OPEN_BLOCK = /`{2,3}[ \t]*mermaid\b[\s\S]*$/i;
const SLICE = /"([^"\n]+)"\s*:\s*(-?\d+(?:\.\d+)?)/g;
const TITLE = /\btitle[ \t]+([^\n"]+)/i;

/** The answer text without any Mermaid block (also one whose closing fence has not streamed in yet). */
export function stripMermaid(text: string): string {
  if (!text || !/mermaid/i.test(text)) return text;
  return text.replace(BLOCK, '').replace(OPEN_BLOCK, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** The first complete Mermaid pie chart in the text as a donut chart, or null (no pie, or fewer than two slices). */
export function mermaidPie(text: string): AskDataChart | null {
  if (!text || !/mermaid/i.test(text)) return null;
  for (const match of text.matchAll(BLOCK)) {
    const code = match[2].trim();
    if (!/^pie\b/i.test(code)) continue;
    const labels: string[] = [];
    const data: number[] = [];
    for (const slice of code.matchAll(SLICE)) {
      labels.push(slice[1].trim());
      data.push(Number(slice[2]));
    }
    if (labels.length < 2) continue;
    const title = TITLE.exec(code.split('"')[0])?.[1].trim() ?? '';
    return { type: 'donut', title, labels, series: [{ name: title || 'Value', data }], xAxis: null, yAxis: null };
  }
  return null;
}
