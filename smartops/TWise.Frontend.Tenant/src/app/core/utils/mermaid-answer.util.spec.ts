import { mermaidPie, stripMermaid } from './mermaid-answer.util';

describe('mermaid-answer.util', () => {
  const pie = '```mermaid\npie title Well Counts by Project\n"Project ID not recorded" : 240\n"4F48FBF3" : 217\n"278C5587" : 179\n```';

  it('removes a complete Mermaid block and keeps the rest of the answer', () => {
    expect(stripMermaid(`Here is the split.\n\n${pie}\n\n240 wells have no project.`))
      .toBe('Here is the split.\n\n240 wells have no project.');
  });

  it('removes a block whose fence was cut to two backticks', () => {
    expect(stripMermaid('Chart: ``mermaid pie title X "A" : 1 "B" : 2 `` done')).toBe('Chart:  done');
  });

  it('removes a block still streaming in', () => {
    expect(stripMermaid('Wells per project:\n```mermaid\npie title W\n"A" : 1')).toBe('Wells per project:');
  });

  it('leaves an answer without Mermaid as it is', () => {
    const text = 'There are **30 projects**.';
    expect(stripMermaid(text)).toBe(text);
    expect(mermaidPie(text)).toBeNull();
  });

  it('turns a pie into a donut chart with its title, labels and values', () => {
    expect(mermaidPie(pie)).toEqual({
      type: 'donut', title: 'Well Counts by Project', labels: ['Project ID not recorded', '4F48FBF3', '278C5587'],
      series: [{ name: 'Well Counts by Project', data: [240, 217, 179] }], xAxis: null, yAxis: null,
    });
  });

  it('reads a pie written on one line with a two-backtick fence', () => {
    const chart = mermaidPie('``mermaid pie title Wells "A" : 3 "B" : 4.5 ``');
    expect(chart?.labels).toEqual(['A', 'B']);
    expect(chart?.series[0].data).toEqual([3, 4.5]);
  });

  it('ignores a Mermaid block that is not a pie, or a pie with one slice', () => {
    expect(mermaidPie('```mermaid\ngraph TD; A-->B\n```')).toBeNull();
    expect(mermaidPie('```mermaid\npie title One\n"A" : 1\n```')).toBeNull();
  });
});
