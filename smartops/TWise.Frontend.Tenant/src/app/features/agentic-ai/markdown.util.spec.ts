import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown.util';

describe('markdownToHtml', () => {
  it('renders a table with its column alignment', () => {
    const html = markdownToHtml('| Name | Tasks |\n|---|---:|\n| **Faisal** | 12 |\n| Ramesh | 2 |');
    expect(html).toContain('<th>Name</th><th class="md-r">Tasks</th>');
    expect(html).toContain('<td><strong>Faisal</strong></td><td class="md-r">12</td>');
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  });

  it('keeps rows with missing cells in shape', () => {
    expect(markdownToHtml('| a | b |\n|---|---|\n| 1 |')).toContain('<td>1</td><td></td>');
  });

  it('renders headings, paragraphs, lists and bold', () => {
    const html = markdownToHtml('## Well 33151\n\nThere are **20** rows.\n\n- one\n- two\n\n1. first\n2. second');
    expect(html).toBe('<h4>Well 33151</h4><p>There are <strong>20</strong> rows.</p><ul><li>one</li><li>two</li></ul>'
      + '<ol><li>first</li><li>second</li></ol>');
  });

  it('never lets text add HTML', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)> | <script>x</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('leaves names with dots and dashes alone', () => {
    expect(markdownToHtml('RAM JI . and a - dash and mahmood.82826192@ong.altasnim.com'))
      .toBe('<p>RAM JI . and a - dash and mahmood.82826192@ong.altasnim.com</p>');
  });

  it('is empty for nothing', () => {
    expect(markdownToHtml(null)).toBe('');
  });
});
