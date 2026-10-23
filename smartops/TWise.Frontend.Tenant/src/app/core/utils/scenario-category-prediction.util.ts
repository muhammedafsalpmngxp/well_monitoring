export interface ScenarioCategoryPredictionInput {
  name: string;
  history: readonly (number | null)[];
  planDeltas: readonly number[];
  explicitlyAdjusted: boolean;
}

export interface ScenarioCategoryPredictionResult {
  deltas: Map<string, number[]>;
  messages: string[];
}

const MIN_PAIRED_PERIODS = 3;
const MIN_CORRELATION = 0.7;

function fitRelationship(source: readonly (number | null)[], destination: readonly (number | null)[]):
  { slope: number; correlation: number; samples: number } | null {
  const pairs: [number, number][] = [];
  for (let index = 0; index < Math.min(source.length, destination.length); index++) {
    const x = source[index];
    const y = destination[index];
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  if (pairs.length < MIN_PAIRED_PERIODS) return null;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let varianceX = 0;
  let varianceY = 0;
  let covariance = 0;
  for (const [x, y] of pairs) {
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
    covariance += (x - meanX) * (y - meanY);
  }
  if (varianceX === 0 || varianceY === 0) return null;
  const slope = covariance / varianceX;
  const correlation = covariance / Math.sqrt(varianceX) / Math.sqrt(varianceY);
  return Number.isFinite(slope) && Number.isFinite(correlation)
    && Math.abs(correlation) + Number.EPSILON >= MIN_CORRELATION
    ? { slope, correlation, samples: pairs.length } : null;
}

export function predictScenarioCategoryChanges(
  categories: readonly ScenarioCategoryPredictionInput[],
): ScenarioCategoryPredictionResult {
  const result: ScenarioCategoryPredictionResult = { deltas: new Map(), messages: [] };
  const drivers = categories.filter(category => category.explicitlyAdjusted
    && category.planDeltas.some(delta => delta !== 0));
  if (!drivers.length) return result;
  for (const destination of categories.filter(category => !category.explicitlyAdjusted)) {
    const deltas = destination.planDeltas.map(() => 0);
    const relationships: string[] = [];
    for (const source of drivers) {
      const relationship = fitRelationship(source.history, destination.history);
      if (!relationship) continue;
      const contributions = deltas.map((_, index) => relationship.slope * (source.planDeltas[index] ?? 0));
      if (contributions.some((delta, index) => !Number.isFinite(delta) || !Number.isFinite(deltas[index] + delta))) {
        result.messages.push(`${destination.name}: prediction from ${source.name} exceeds the supported numeric range; not applied.`);
        continue;
      }
      contributions.forEach((delta, index) => { deltas[index] += delta; });
      relationships.push(`${source.name} (r=${relationship.correlation.toFixed(2)}, ${relationship.samples} periods)`);
    }
    if (relationships.length) {
      result.deltas.set(destination.name, deltas);
      result.messages.push(`${destination.name}: estimated from ${relationships.join(', ')}.`);
    } else {
      result.messages.push(`${destination.name}: unchanged. Prediction needs at least ${MIN_PAIRED_PERIODS} paired historical periods, varying values, and |r| >= ${MIN_CORRELATION}.`);
    }
  }
  return result;
}
