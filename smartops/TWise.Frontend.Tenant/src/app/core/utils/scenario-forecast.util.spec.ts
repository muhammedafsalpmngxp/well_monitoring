import { describe, expect, it } from 'vitest';
import { forecastScenarioPeriods, hasScenarioDatePeriods } from './scenario-forecast.util';

describe('forecastScenarioPeriods', () => {
  it('sums forecast months in the new year when only one historical year exists', () => {
    expect(forecastScenarioPeriods(['2026'], [[61], [59]], 120, 'yearly', '2026-10-06', {
      labels: ['Aug-26', 'Sep-26', 'Oct-26'], values: [[10, 20, 30], [30, 20, 10]],
    })).toEqual({ labels: ['2027'], values: [[130], [-50]], error: null });
  });

  it('limits the new-year total to the months touched by the adjusted date', () => {
    expect(forecastScenarioPeriods(['2026'], [[61]], 87, 'yearly', '2026-10-06', {
      labels: ['Aug-26', 'Sep-26', 'Oct-26'], values: [[10, 20, 30]],
    })).toEqual({ labels: ['2027'], values: [[60]], error: null });
  });

  it('rejects insufficient, mismatched or non-monthly regression history', () => {
    for (const history of [
      { labels: ['Oct-26'], values: [[10]] },
      { labels: ['Sep-26', 'Oct-26'], values: [[10, 20], [10, 20]] },
      { labels: ['2025', '2026'], values: [[10, 20]] },
      { labels: ['Sep-26', 'Oct-26'], values: [[10, NaN]] },
    ]) {
      expect(forecastScenarioPeriods(['2026'], [[61]], 120, 'yearly', '2026-10-06', history).error).toBeTruthy();
    }
  });

  it('adds years only when the global To date plus slippage reaches the next year', () => {
    expect(forecastScenarioPeriods(['2025', '2026'], [[10, 20]], 86, 'yearly', '2026-10-06'))
      .toEqual({ labels: [], values: [[]], error: null });
    expect(forecastScenarioPeriods(['2025', '2026'], [[10, 20]], 87, 'yearly', '2026-10-06'))
      .toEqual({ labels: ['2027'], values: [[30]], error: null });
    expect(forecastScenarioPeriods(['2025', '2026'], [[10, 20]], 120, 'yearly', '2026-06-10').labels).toEqual([]);
  });

  it('needs regression history only when a new year is reached', () => {
    expect(forecastScenarioPeriods(['2026'], [[20]], 120, 'yearly', '2026-06-10'))
      .toEqual({ labels: [], values: [[]], error: null });
    expect(forecastScenarioPeriods(['2026'], [[20]], 120, 'yearly', '2026-12-31').error)
      .toContain('At least two');
  });

  it.each(['', '2026-02-30', '10-06-2026'])('rejects an invalid yearly global To date: %s', toDate => {
    expect(forecastScenarioPeriods(['2025', '2026'], [[10, 20]], 120, 'yearly', toDate).error)
      .toContain('global To date');
  });

  it.each([
    { mode: 'monthly' as const, labels: ['Sep-26', 'Oct-26'], future: ['Nov-26', 'Dec-26', 'Jan-27', 'Feb-27'] },
    { mode: 'quarterly' as const, labels: ['Q3-2026', 'Q4-2026'], future: ['Q1-2027', 'Q2-2027'] },
    { mode: 'yearly' as const, labels: ['2025', '2026'], future: ['2027'] },
  ])('accepts the 120-day maximum in $mode mode', ({ mode, labels, future }) => {
    expect(forecastScenarioPeriods(labels, [[10, 20]], 120, mode)).toEqual({
      labels: future, values: [future.map((_, index) => 30 + index * 10)], error: null,
    });
  });

  it.each([
    { mode: 'weekly' as const, labels: ['2026-W41', '2026-W42'], days: 8,
      future: ['week43', 'week44'] },
    { mode: 'monthly' as const, labels: ['Sep-26', 'Oct-26'], days: 60,
      future: ['Nov-26', 'Dec-26'] },
    { mode: 'quarterly' as const, labels: ['Q3-2026', 'Q4-2026'], days: 60,
      future: ['Q1-2027'] },
    { mode: 'yearly' as const, labels: ['2025', '2026'], days: 60,
      future: ['2027'] },
  ])('forecasts at the $mode interval and recognizes its labels', ({ mode, labels, days, future }) => {
    expect(hasScenarioDatePeriods(labels, mode)).toBe(true);
    expect(forecastScenarioPeriods(labels, [[10, 20], [30, 20]], days, mode)).toEqual({
      labels: future, values: [future.map((_, index) => 30 + index * 10), future.map((_, index) => 10 - index * 10)],
      error: null,
    });
  });

  it('uses quarter and year intervals for month-formatted bucket labels', () => {
    expect(forecastScenarioPeriods(['Jul-26', 'Oct-26'], [[10, 20]], 60, 'quarterly'))
      .toEqual({ labels: ['Jan-27'], values: [[30]], error: null });
    expect(forecastScenarioPeriods(['Jan-25', 'Jan-26'], [[10, 20]], 60, 'yearly'))
      .toEqual({ labels: ['Jan-27'], values: [[30]], error: null });
  });

  it.each([
    { mode: 'weekly' as const, labels: ['2026-10-19', '2026-10-26'], days: 8,
      future: ['week45', 'week46'] },
    { mode: 'monthly' as const, labels: ['2026-09-01', '2026-10-01'], days: 60,
      future: ['2026-11-01', '2026-12-01'] },
    { mode: 'quarterly' as const, labels: ['2026-07-01', '2026-10-01'], days: 60,
      future: ['2027-01-01'] },
    { mode: 'yearly' as const, labels: ['2025-01-01', '2026-01-01'], days: 60,
      future: ['2027-01-01'] },
  ])('respects selected $mode mode for ISO date labels', ({ mode, labels, days, future }) => {
    expect(forecastScenarioPeriods(labels, [[10, 20]], days, mode)).toEqual({
      labels: future, values: [future.map((_, index) => 30 + index * 10)], error: null,
    });
  });

  it('keeps quarter label style and accounts for missing quarters', () => {
    expect(forecastScenarioPeriods(['Q1 2026', 'Q3 2026', 'Q4 2026'], [[10, 30, 40]], 1, 'quarterly'))
      .toEqual({ labels: ['Q1 2027'], values: [[50]], error: null });
    expect(forecastScenarioPeriods(['2026-Q3', '2026-Q4'], [[1, 2]], 1, 'quarterly').labels).toEqual(['2027-Q1']);
    expect(forecastScenarioPeriods(['Q3-26', 'Q4-26'], [[1, 2]], 1, 'quarterly').labels).toEqual(['Q1-27']);
  });

  it('continues display week numbers across the year boundary while validating ISO history', () => {
    expect(forecastScenarioPeriods(['2026-W52', '2026-W53'], [[10, 20]], 8, 'weekly'))
      .toEqual({ labels: ['week54', 'week55'], values: [[30, 40]], error: null });
    expect(hasScenarioDatePeriods(['2025-W53'], 'weekly')).toBe(false);
    expect(forecastScenarioPeriods(['W52 2026', 'W53 2026'], [[1, 2]], 1, 'weekly').labels).toEqual(['week54']);
  });

  it.each([
    { days: 1, count: 1 }, { days: 7, count: 1 }, { days: 8, count: 2 },
    { days: 14, count: 2 }, { days: 30, count: 5 }, { days: 60, count: 9 },
    { days: 61, count: 9 }, { days: 120, count: 18 },
  ])('adds $count continuation weeks for $days days', ({ days, count }) => {
    expect(hasScenarioDatePeriods(['week51', 'Week 52'], 'weekly')).toBe(true);
    expect(forecastScenarioPeriods(['week51', 'Week 52'], [[10, 20]], days, 'weekly'))
      .toEqual({
        labels: Array.from({ length: count }, (_, index) => `week${53 + index}`),
        values: [Array.from({ length: count }, (_, index) => 30 + index * 10)], error: null,
      });
  });

  it('uses week number spacing for missing weeks and rejects invalid or unordered weeks', () => {
    expect(forecastScenarioPeriods(['week1', 'week3', 'week4'], [[10, 30, 40]], 8, 'weekly'))
      .toEqual({ labels: ['week5', 'week6'], values: [[50, 60]], error: null });
    for (const labels of [['week0', 'week1'], ['week2', 'week1'], ['week1', 'week1']]) {
      expect(forecastScenarioPeriods(labels, [[10, 20]], 7, 'weekly').error).toBeTruthy();
    }
    expect(hasScenarioDatePeriods(['week1', 'week2'], 'monthly')).toBe(false);
  });

  it('keeps non-date axes hidden in every mode', () => {
    for (const mode of ['weekly', 'monthly', 'quarterly', 'yearly'] as const) {
      expect(hasScenarioDatePeriods(['North', 'South'], mode)).toBe(false);
    }
  });

  it('extends Oct-26 by 30 days into Nov-26 and predicts every series', () => {
    expect(forecastScenarioPeriods(['Aug-26', 'Sep-26', 'Oct-26'], [[10, 20, 30], [30, 20, 10]], 30))
      .toEqual({ labels: ['Nov-26'], values: [[40], [0]], error: null });
  });

  it('adds every month touched by the extension including partial months and year rollover', () => {
    expect(forecastScenarioPeriods(['Sep-26', 'Oct-26'], [[1, 2]], 31).labels).toEqual(['Nov-26', 'Dec-26']);
    expect(forecastScenarioPeriods(['Nov-26', 'Dec-26'], [[1, 2]], 60).labels).toEqual(['Jan-27', 'Feb-27', 'Mar-27']);
  });

  it('uses all historical samples rather than only the latest change', () => {
    const result = forecastScenarioPeriods(['Aug-26', 'Sep-26', 'Oct-26'], [[0, 100, 0]], 30);
    expect(result.values).toEqual([[33.33]]);
  });

  it('uses calendar positions for missing months', () => {
    expect(forecastScenarioPeriods(['Jul-26', 'Sep-26', 'Oct-26'], [[10, 30, 40]], 30).values).toEqual([[50]]);
  });

  it('preserves zero, constant and signed trends', () => {
    expect(forecastScenarioPeriods(['Sep-26', 'Oct-26'], [[0, 0], [5, 5], [1, 0]], 30).values)
      .toEqual([[0], [5], [-1]]);
  });

  it('supports long month labels and ISO months', () => {
    expect(forecastScenarioPeriods(['Sep 2026', 'Oct 2026'], [[1, 2]], 30).labels).toEqual(['Nov 2026']);
    expect(forecastScenarioPeriods(['2026-09', '2026-10'], [[1, 2]], 30).labels).toEqual(['2026-11']);
  });

  it('extends daily and weekly date buckets across leap day', () => {
    expect(forecastScenarioPeriods(['2028-02-27', '2028-02-28'], [[1, 2]], 2))
      .toEqual({ labels: ['2028-02-29', '2028-03-01'], values: [[3, 4]], error: null });
    expect(forecastScenarioPeriods(['2026-10-19', '2026-10-26'], [[1, 2]], 8, 7))
      .toEqual({ labels: ['2026-11-02', '2026-11-09'], values: [[3, 4]], error: null });
  });

  it.each([
    { labels: ['Oct-26'], values: [[10]], days: 30 },
    { labels: ['North', 'South'], values: [[10, 20]], days: 30 },
    { labels: ['Oct-26', 'Sep-26'], values: [[10, 20]], days: 30 },
    { labels: ['Oct-26', 'Oct-26'], values: [[10, 20]], days: 30 },
    { labels: ['Sep-26', 'Oct-26'], values: [[10, NaN]], days: 30 },
    { labels: ['Sep-26', 'Oct-26'], values: [[10]], days: 30 },
    { labels: ['2026-02-30', '2026-03-01'], values: [[10, 20]], days: 30 },
    { labels: ['Sep-26', 'Oct-26'], values: [[10, 20]], days: 121 },
  ])('reports invalid forecast data without fabricating values: $labels', ({ labels, values, days }) => {
    const result = forecastScenarioPeriods(labels, values, days);
    expect(result.error).toBeTruthy();
    expect(result.labels).toEqual([]);
    expect(result.values).toEqual([]);
  });
});
