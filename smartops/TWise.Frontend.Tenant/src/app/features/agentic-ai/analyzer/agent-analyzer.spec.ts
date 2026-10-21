import { describe, expect, it } from 'vitest';
import { AgentStep, SaveAgentRequest } from '../agents.service';
import { analyzeAgent, classOf, costOfUsage, PriceCatalog } from './agent-analyzer';

const catalog: PriceCatalog = {
  activeModel: 'gpt-5.6-luna', fastModel: 'gpt-4o-mini',
  prices: [
    { model: 'gpt-5.6-luna', modelClass: 'frontier', inputPer1M: 1.25, outputPer1M: 10 },
    { model: 'gpt-4o-mini', modelClass: 'fast', inputPer1M: 0.15, outputPer1M: 0.6 },
  ],
};
const ASK_AI = { agent: 'ask_ai', action: 'answer' }, ASK_DATA = { agent: 'ask_data', action: 'deep' };

function agent(steps: AgentStep[], more: Partial<SaveAgentRequest> = {}): SaveAgentRequest {
  return { name: 'A', role: null, description: null, systemPrompt: null, goal: null, steps, tools: [ASK_AI], inputs: [], outputs: [],
    status: 'draft', askData: null, type: 'sequential', maxIterations: 3, customTools: [], ...more };
}

describe('agent analyzer', () => {
  it('estimates one Ask AI step and prices it', () => {
    const a = analyzeAgent(agent([{ id: 'a', text: 'Answer', tool: ASK_AI }]), catalog);
    expect(a.counts.llmCallsExpected).toBe(1);
    expect(a.tokens.expected).toBe(2000);
    expect(a.cost.expected).toBeCloseTo((1500 * 1.25 + 500 * 10) / 1e6, 8);
    expect(a.scores.frontierDependency).toBe(100);
  });

  it('counts For Each and loop-backs in the worst case and flags the multiplier', () => {
    const a = analyzeAgent(agent([
      { id: 'list', text: 'List wells', tool: ASK_DATA, outputKey: 'wells' },
      { id: 'each', text: 'Review {{item}}', tool: ASK_DATA, forEach: 'wells', retries: 2 },
      { id: 'draft', text: 'Draft the report', tool: ASK_AI },
      { id: 'r', kind: 'router', text: 'OK?', branches: [{ id: 'b', label: 'Revise', op: 'else', target: 'draft' }] },
    ], { maxIterations: 10 }), catalog);
    const each = a.steps.find(s => s.index === 1)!;
    expect(each.expectedRuns).toBe(5);
    expect(each.worstRuns).toBe(20);
    expect(a.steps.find(s => s.index === 2)!.worstRuns).toBe(10);
    expect(a.counts.loops).toBe(1);
    expect(a.findings.some(f => f.what.includes('goes back to step 3'))).toBe(true);
    expect(a.findings.some(f => f.what.includes('worst case is about'))).toBe(true);
    expect(a.findings.some(f => f.what.includes('without retries (1)'))).toBe(true);
  });

  it('recommends the fast model for classifying steps and spots parallel work', () => {
    const a = analyzeAgent(agent([
      { id: 'c', text: 'Classify the issue with one word', tool: ASK_AI },
      { id: 'x', text: 'Wells in Nimr', tool: ASK_DATA, retries: 1 },
      { id: 'y', text: 'Rigs in Nimr', tool: ASK_DATA, retries: 1 },
    ]), catalog);
    expect(a.findings.find(f => f.what.includes('only classify'))!.fix).toContain('gpt-4o-mini');
    expect(a.findings.some(f => f.what.includes('Steps 2 and 3 do not use'))).toBe(true);
    expect(a.findings.some(f => f.what.includes('Nothing checks the answer'))).toBe(true);
  });

  it('reports missing prices, budgets and structural issues', () => {
    const a = analyzeAgent(agent([{ id: 'a', text: 'Answer', tool: ASK_AI, model: 'mystery-model' }]), catalog,
      { budget: 1000, issues: ['Step 1 is empty.'] });
    expect(a.cost.expected).toBeNull();
    expect(a.cost.missingPrices).toEqual(['mystery-model']);
    expect(a.findings[0]).toMatchObject({ severity: 'error', what: 'Step 1 is empty.' });
    expect(a.findings.some(f => f.what.includes('budget of 1,000'))).toBe(true);
  });

  it('caps a supervisor worst case at max iterations of the costliest worker', () => {
    const a = analyzeAgent(agent([{ id: 'w1', text: 'Data', tool: ASK_DATA }, { id: 'w2', text: 'Write', tool: ASK_AI }],
      { type: 'supervisor', maxIterations: 4 }), catalog);
    expect(a.steps.find(s => s.index === 0)!.worstRuns).toBe(4);
    expect(a.steps.find(s => s.index === 1)!.worstRuns).toBe(0);
    expect(a.counts.depth).toBe(2);
  });

  it('guesses model classes and prices real usage', () => {
    expect(classOf('claude-haiku', catalog)).toBe('fast');
    expect(classOf('gpt-5.6-luna', catalog)).toBe('frontier');
    const c = costOfUsage([{ model: 'gpt-4o-mini', calls: 2, input: 1_000_000, output: 0 }, { model: 'other', calls: 1, input: 5, output: 5 }], catalog);
    expect(c.cost).toBeCloseTo(0.15, 6);
    expect(c.unpriced).toEqual(['other']);
  });
  it('still estimates tokens when no provider is known', () => {
    const a = analyzeAgent(agent([{ id: 'a', text: 'Answer', tool: ASK_AI }]), { activeModel: null, fastModel: null, prices: [] });
    expect(a.tokens.expected).toBe(2000);
    expect(a.cost.expected).toBeNull();
    expect(a.cost.missingPrices).toEqual(['(active model)']);
  });
  it('counts an Evaluator as a check and as a loop, and Compute as free', () => {
    const a = analyzeAgent(agent([
      { id: 'd', text: 'Draft', tool: ASK_AI },
      { id: 'e', text: 'Has the count', tool: { agent: 'evaluator', action: 'check' } },
      { id: 'c', text: '{{x}} / 2', tool: { agent: 'compute', action: 'run' }, options: { mode: 'math' } },
      { id: 'z', text: 'Answer', tool: ASK_AI },
    ]), catalog);
    expect(a.findings.some(f => f.what.includes('Nothing checks the answer'))).toBe(false);
    expect(a.counts.loops).toBe(1);
    expect(a.steps.find(s => s.index === 0)!.worstRuns).toBe(3);
    expect(a.steps.find(s => s.index === 2)!.calls).toBe(0);
  });
});
