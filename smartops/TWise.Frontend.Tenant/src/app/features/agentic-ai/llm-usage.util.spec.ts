import { describe, expect, it } from 'vitest';
import {
  callsText, compactTokens, countText, inputTokensText, modelNames, modelsLine, outputTokensText, totalTokensText, usageLine,
  usageTitle,
} from './llm-usage.util';

const usage = {
  calls: 3, promptTokens: 20_625, completionTokens: 164, totalTokens: 20_789,
  models: [{ model: 'gpt-4o-mini', calls: 2, promptTokens: 20_000, completionTokens: 100 }, { model: 'gpt-5.6-luna', calls: 1, promptTokens: 625, completionTokens: 64 }],
};

describe('llm usage formatting', () => {
  it('shortens token counts for the card', () => {
    expect(compactTokens(950)).toBe('950');
    expect(compactTokens(3240)).toBe('3.2k');
    expect(compactTokens(20_625)).toBe('21k');
    expect(compactTokens(1_250_000)).toBe('1.25M');
  });

  it('keeps input and output apart', () => {
    expect(usageLine(usage)).toBe('3 calls · 21k input · 164 output · 21k total');
    expect(usageLine({ ...usage, calls: 1 })).toBe('1 call · 21k input · 164 output · 21k total');
    expect(inputTokensText(usage)).toBe('20,625');
    expect(outputTokensText(usage)).toBe('164');
    expect(totalTokensText(usage)).toBe('20,789');
    expect(usageTitle(usage)).toContain('20,625 input + 164 output = 20,789 total tokens');
    expect(usageTitle(usage)).toContain('gpt-4o-mini: 2 calls, 20,000 input, 100 output, 20,100 total');
  });

  it('names the models', () => {
    expect(modelNames(usage)).toBe('gpt-4o-mini, gpt-5.6-luna');
    expect(modelsLine(usage)).toBe('gpt-4o-mini (2), gpt-5.6-luna (1)');
    expect(callsText(usage)).toBe('3 calls');
  });

  it('shows a dash when nothing was recorded', () => {
    expect(usageLine(null)).toBe('—');
    expect(inputTokensText(undefined)).toBe('—');
    expect(outputTokensText(null)).toBe('—');
    expect(totalTokensText(undefined)).toBe('—');
    expect(modelNames(null)).toBe('—');
    expect(callsText(null)).toBe('');
    expect(countText(null)).toBe('—');
    expect(countText(1234)).toBe('1,234');
    expect(usageTitle(null)).toContain('No LLM usage recorded yet');
  });
});
