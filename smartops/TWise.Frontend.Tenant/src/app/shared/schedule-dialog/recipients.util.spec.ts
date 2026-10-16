import { describe, expect, it } from 'vitest';
import { ScheduleRecipient } from '../../core/services/schedule.service';
import { addRecipients, isEmail, parseAddresses } from './recipients.util';

const email = (kind: ScheduleRecipient['kind'], value: string): ScheduleRecipient => ({ kind, type: 'Email', value });

describe('recipient chips', () => {
  it('splits typed text on commas, semicolons and spaces', () => {
    expect(parseAddresses('a@x.com, b@x.com;c@x.com  d@x.com\ne@x.com').valid)
      .toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']);
    expect(parseAddresses(' ;, ')).toEqual({ valid: [], invalid: [] });
  });

  it('keeps what is not an address apart', () => {
    expect(parseAddresses('ok@tasnim.om, not-an-address, @x.com, a@b')).toEqual({ valid: ['ok@tasnim.om'], invalid: ['not-an-address', '@x.com', 'a@b'] });
  });

  it('drops repeats of an address, whatever the case', () => {
    expect(parseAddresses('A@x.com a@X.com a@x.com').valid).toEqual(['A@x.com']);
  });

  it('checks an address', () => {
    expect(isEmail('first.last+tag@mail.tasnim.om')).toBe(true);
    expect(isEmail('a b@x.com')).toBe(false);
    expect(isEmail('a@x')).toBe(false);
  });

  it('adds only recipients not already in any of To, Cc and Bcc', () => {
    const list = [email('To', 'a@x.com'), { kind: 'Cc', type: 'Role', value: 'admin', label: 'Admin' } as ScheduleRecipient];
    const result = addRecipients(list, [email('Bcc', 'A@X.com'), email('Bcc', 'b@x.com'), { kind: 'Bcc', type: 'Role', value: 'ADMIN' }, email('Bcc', 'b@x.com')]);
    expect(result.list).toEqual([...list, email('Bcc', 'b@x.com')]);
    expect(result.skipped).toBe(3);
  });

  it('treats a user and an address with the same text as different recipients', () => {
    const result = addRecipients([{ kind: 'To', type: 'User', value: '7' }], [{ kind: 'To', type: 'Group', value: '7' }]);
    expect(result.list.length).toBe(2);
  });
});
