import { describe, expect, it } from 'vitest';
import { Recurrence, defaultRecurrence, describeRecurrence, fromCron, toCron, utcToZoned, zonedToUtc } from './recurrence.util';

const r = (patch: Partial<Recurrence>): Recurrence => ({ ...defaultRecurrence(), ...patch });

describe('recurrence', () => {
  const cases: [string, Partial<Recurrence>, string][] = [
    ['hourly', { frequency: 'Hourly', time: '00:15' }, '15 * * * *'],
    ['daily', { frequency: 'Daily', time: '07:00' }, '0 7 * * *'],
    ['weekdays', { frequency: 'Weekdays', time: '06:30' }, '30 6 * * 1-5'],
    ['weekly', { frequency: 'Weekly', time: '07:05', days: [3, 1] }, '5 7 * * 1,3'],
    ['monthly on a day', { frequency: 'Monthly', time: '08:00', monthly: 'day', dayOfMonth: 15 }, '0 8 15 * *'],
    ['monthly on the last day', { frequency: 'Monthly', time: '08:00', monthly: 'lastDay' }, '0 8 L * *'],
    ['monthly on the first weekday', { frequency: 'Monthly', time: '07:00', monthly: 'first', weekday: 1 }, '0 7 * * 1#1'],
    ['monthly on the last weekday', { frequency: 'Monthly', time: '17:00', monthly: 'last', weekday: 5 }, '0 17 * * 5L'],
  ];

  for (const [name, patch, cron] of cases) {
    it(`turns ${name} into cron and back`, () => {
      const rec = r(patch);
      expect(toCron(rec)).toBe(cron);
      const back = fromCron(cron);
      expect(back.frequency).toBe(rec.frequency);
      expect(toCron(back)).toBe(cron);
    });
  }

  it('keeps the friendly fields when reading cron', () => {
    expect(fromCron('5 7 * * 1,3')).toMatchObject({ frequency: 'Weekly', time: '07:05', days: [1, 3] });
    expect(fromCron('0 8 15 * *')).toMatchObject({ frequency: 'Monthly', monthly: 'day', dayOfMonth: 15, time: '08:00' });
    expect(fromCron('0 17 * * 5L')).toMatchObject({ monthly: 'last', weekday: 5 });
  });

  it('has no cron for a single run', () => {
    expect(toCron(r({ frequency: 'Once' }))).toBeNull();
    expect(fromCron(null).frequency).toBe('Once');
  });

  it('falls back to custom for cron that has no friendly form, and keeps it as typed', () => {
    for (const cron of ['*/5 * * * *', '0 7 * 1 *', '0 7,19 * * *', '0 7 * * MON', '0 7 1-7 * 1', 'nonsense']) {
      const rec = fromCron(cron);
      expect(rec.frequency).toBe('Custom');
      expect(rec.cron).toBe(cron);
      expect(toCron(rec)).toBe(cron);
    }
    expect(toCron(r({ frequency: 'Custom', cron: '  0 7 * * *  ' }))).toBe('0 7 * * *');
  });

  it('describes each option in plain words', () => {
    const tz = 'Asia/Muscat';
    expect(describeRecurrence(r({ frequency: 'Weekdays', time: '07:00' }), tz)).toBe('Every weekday at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Daily', time: '07:00' }), tz)).toBe('Every day at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Hourly', time: '00:15' }), tz)).toBe('Every hour at 15 minutes past (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Weekly', days: [1, 3, 5] }), tz)).toBe('Every Monday, Wednesday and Friday at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Weekly', days: [0] }), tz)).toBe('Every Sunday at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Monthly', monthly: 'day', dayOfMonth: 15 }), tz)).toBe('On day 15 of every month at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Monthly', monthly: 'lastDay' }), tz)).toBe('On the last day of every month at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Monthly', monthly: 'first', weekday: 1 }), tz)).toBe('On the first Monday of every month at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Monthly', monthly: 'last', weekday: 5 }), tz)).toBe('On the last Friday of every month at 07:00 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Once', date: '2026-10-12', time: '09:30' }), tz)).toBe('Once on 12 Oct 2026 at 09:30 (Asia/Muscat)');
    expect(describeRecurrence(r({ frequency: 'Custom', cron: '*/5 * * * *' }), tz)).toBe('Custom schedule: */5 * * * * (Asia/Muscat)');
  });

  it('turns a wall time in a zone into UTC and back, across summer time', () => {
    expect(zonedToUtc('2026-10-12', '07:00', 'Asia/Muscat')).toBe('2026-10-12T03:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '09:00', 'Europe/London')).toBe('2026-01-15T09:00:00.000Z');
    expect(zonedToUtc('2026-07-01', '09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(utcToZoned('2026-07-01T08:00:00Z', 'Europe/London')).toEqual({ date: '2026-07-01', time: '09:00' });
    expect(utcToZoned('2026-10-11T21:30:00Z', 'Asia/Muscat')).toEqual({ date: '2026-10-12', time: '01:30' });
  });
});
