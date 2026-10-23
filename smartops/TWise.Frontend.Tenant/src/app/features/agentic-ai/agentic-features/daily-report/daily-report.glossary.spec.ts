import { describe, expect, it } from 'vitest';
import { chipFlags, codeHint, codeLabel, progressText, splitStatusCounts, statusHint } from './daily-report.format';
import {
  CREW_MATCH, DATA_FLAG, DATA_QUALITY, DATE_STATUS, FIELD, LEGEND, MAPPING_STATUS, QUANTITY_STATUS, TASK_STATE, Term,
} from './daily-report.glossary';

const tables: Record<string, Record<string, Term>> = {
  QUANTITY_STATUS, TASK_STATE, DATE_STATUS, MAPPING_STATUS, CREW_MATCH, DATA_FLAG,
};

describe('Daily Report glossary', () => {
  it('gives every term a label and a one-sentence explanation', () => {
    const all: Term[] = [...Object.values(tables).flatMap(t => Object.values(t)), ...Object.values(FIELD),
      ...Object.values(DATA_QUALITY), ...LEGEND];
    expect(all.length).toBeGreaterThan(40);
    for (const t of all) {
      expect(t.label.trim(), JSON.stringify(t)).not.toBe('');
      expect(t.tip.trim().endsWith('.'), t.label).toBe(true);
    }
  });

  it('covers every quantity status, task state and data-quality flag the runtime sends', () => {
    expect(Object.keys(QUANTITY_STATUS).sort()).toEqual(['ABOVE_PLAN', 'BELOW_PLAN', 'NOT_VALIDATED', 'NO_ACTUAL', 'ON_PLAN']);
    expect(Object.keys(TASK_STATE).sort()).toEqual(['COMPLETED', 'ENDED_NOT_COMPLETED', 'NOT_STARTED', 'ONGOING']);
    expect(Object.keys(DATA_FLAG)).toContain('DUPLICATE_ACTUAL_ENTRY');
    expect(Object.keys(DATA_FLAG)).toContain('UNMAPPED_ACTIVITY');
    expect(Object.keys(DATA_FLAG)).toHaveLength(12);
  });

  it('shows "no actual" in words a reader can act on, and never as a claim that no work happened', () => {
    expect(codeLabel('NO_ACTUAL')).toBe('Nothing entered');
    expect(statusHint('NO_ACTUAL')).toContain('does not mean no work happened');
  });

  it('reads labels and hints through the glossary, so rewording one place rewords the page', () => {
    expect(codeLabel('UNMAPPED_ACTIVITY')).toBe(DATA_FLAG['UNMAPPED_ACTIVITY'].label);
    expect(codeHint('ENDED_NOT_COMPLETED')).toBe(TASK_STATE['ENDED_NOT_COMPLETED'].tip);
    expect(codeHint(null)).toBe('');
  });

  it('still shows a code it does not know, made readable, and never drops it', () => {
    expect(codeLabel('SOME_NEW_CODE')).toBe('Some new code');
    expect(codeLabel(null)).toBe('');
    expect(statusHint('SOME_NEW_CODE')).toBe('Some new code');
  });
});

describe('Daily Report figures', () => {
  it('shows progress as a percentage when it is a share of the task', () => {
    expect(progressText(0.22)).toBe('22%');
    expect(progressText(1)).toBe('100%');
    expect(progressText(0)).toBe('0%');
    expect(progressText('0.4')).toBe('40%');
    expect(progressText(0.004)).toBe('<1%');
  });

  it('shows anything else as it came, and nothing when there is nothing', () => {
    expect(progressText(5)).toBe('5');
    expect(progressText(-0.2)).toBe('-0.2');
    expect(progressText('n/a')).toBe('n/a');
    expect(progressText(null)).toBe('');
    expect(progressText(undefined)).toBe('');
  });

  it('keeps only the statuses that have tasks as tiles and names the rest once, in display order', () => {
    const counts = { NO_ACTUAL: 22, ON_PLAN: 0, ABOVE_PLAN: 0, BELOW_PLAN: 3, NOT_VALIDATED: 0 };
    expect(splitStatusCounts(counts)).toEqual({ shown: ['BELOW_PLAN', 'NO_ACTUAL'], empty: ['ON_PLAN', 'ABOVE_PLAN', 'NOT_VALIDATED'] });
    expect(splitStatusCounts({ NEW_STATUS: 2 })).toEqual({ shown: ['NEW_STATUS'], empty: [] });
    expect(splitStatusCounts(null)).toEqual({ shown: [], empty: [] });
  });
});

describe('Data quality chips', () => {
  it('lists only the flags no counter already shows, so one figure is not stated twice', () => {
    expect(chipFlags({ MULTIPLE_TASK_ROWS: 8, UNMAPPED_ACTIVITY: 10, DUPLICATE_ACTUAL_ENTRY: 0, MISSING_UOM: 2 }))
      .toEqual(['UNMAPPED_ACTIVITY', 'MISSING_UOM']);
    expect(chipFlags(null)).toEqual([]);
  });
});
