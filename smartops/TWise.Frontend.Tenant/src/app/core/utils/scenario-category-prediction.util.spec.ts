import { describe, expect, it } from 'vitest';
import { predictScenarioCategoryChanges, ScenarioCategoryPredictionInput } from './scenario-category-prediction.util';

function category(name: string, history: (number | null)[], planDeltas = history.map(() => 0),
  explicitlyAdjusted = false): ScenarioCategoryPredictionInput {
  return { name, history, planDeltas, explicitlyAdjusted };
}

describe('predictScenarioCategoryChanges', () => {
  it('predicts positive and inverse relationships using slopes, not percentage copying', () => {
    const result = predictScenarioCategoryChanges([
      category('Plan', [10, 20, 30], [1, 2, 3], true),
      category('Actual', [25, 45, 65]),
      category('Remaining', [90, 80, 70]),
    ]);
    expect(result.deltas.get('Actual')).toEqual([2, 4, 6]);
    expect(result.deltas.get('Remaining')).toEqual([-1, -2, -3]);
    expect(result.messages).toEqual([
      'Actual: estimated from Plan (r=1.00, 3 periods).',
      'Remaining: estimated from Plan (r=-1.00, 3 periods).',
    ]);
  });

  it('fits only history while allowing deltas for future periods', () => {
    const result = predictScenarioCategoryChanges([
      category('Plan', [10, 20, 30], [1, 2, 3, 4], true),
      category('Actual', [20, 40, 60], [0, 0, 0, 0]),
    ]);
    expect(result.deltas.get('Actual')).toEqual([2, 4, 6, 8]);
    expect(result.messages[0]).toContain('3 periods');
  });

  it.each([
    [[10, 20], [20, 40]],
    [[10, 10, 10], [20, 40, 60]],
    [[10, 20, 30], [40, 40, 40]],
    [[10, 20, 30], [10, 30, 10]],
    [[10, null, 30], [20, 40, 60]],
    [[10, NaN, 30], [20, 40, 60]],
    [[10, 20, 30], [20, Infinity, 60]],
  ])('leaves a category unchanged without sufficient evidence (%j, %j)', (source, destination) => {
    const result = predictScenarioCategoryChanges([
      category('Plan', source, source.map(() => 1), true),
      category('Actual', destination),
    ]);
    expect(result.deltas.size).toBe(0);
    expect(result.messages[0]).toContain('unchanged');
  });

  it('excludes missing pairs rather than turning them into zeros', () => {
    const result = predictScenarioCategoryChanges([
      category('Plan', [0, null, 10, 20], [1, 1, 1, 1], true),
      category('Actual', [5, 1000, 25, 45]),
    ]);
    expect(result.deltas.get('Actual')).toEqual([2, 2, 2, 2]);
    expect(result.messages[0]).toContain('3 periods');
  });

  it('accepts correlation exactly at the 0.7 threshold', () => {
    const result = predictScenarioCategoryChanges([
      category('Plan', [-2, -1, 0, 1, 2], [10, 10, 10, 10, 10], true),
      category('Actual', [-2, -1, 1, 2, 0]),
    ]);
    expect(result.deltas.get('Actual')).toEqual([7, 7, 7, 7, 7]);
  });

  it('preserves explicit targets and combines direct drivers without recursive propagation', () => {
    const inputs = [
      category('Plan', [10, 20, 30], [1, 2, 3], true),
      category('Actual', [20, 40, 60], [2, 2, 2], true),
      category('Cost', [30, 60, 90]),
    ];
    const snapshot = structuredClone(inputs);
    const result = predictScenarioCategoryChanges(inputs);
    expect(result.deltas.has('Plan')).toBe(false);
    expect(result.deltas.has('Actual')).toBe(false);
    expect(result.deltas.get('Cost')).toEqual([6, 9, 12]);
    expect(inputs).toEqual(snapshot);
  });

  it('does nothing when all adjustments are zero or all categories are explicitly adjusted', () => {
    expect(predictScenarioCategoryChanges([
      category('Plan', [10, 20, 30], [0, 0, 0], true),
      category('Actual', [20, 40, 60]),
    ])).toEqual({ deltas: new Map(), messages: [] });
    expect(predictScenarioCategoryChanges([
      category('Plan', [10, 20, 30], [1, 2, 3], true),
      category('Actual', [20, 40, 60], [2, 4, 6], true),
    ])).toEqual({ deltas: new Map(), messages: [] });
  });

  it('reports numeric overflow rather than applying nonfinite predictions', () => {
    const result = predictScenarioCategoryChanges([
      category('Plan', [1, 2, 3], [Number.MAX_VALUE, 1, 1], true),
      category('Actual', [10, 20, 30]),
    ]);
    expect(result.deltas.size).toBe(0);
    expect(result.messages.some(message => message.includes('numeric range'))).toBe(true);
  });
});
