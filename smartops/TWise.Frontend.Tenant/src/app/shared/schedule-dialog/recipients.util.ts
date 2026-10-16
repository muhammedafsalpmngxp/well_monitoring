import { ScheduleRecipient } from '../../core/services/schedule.service';

// ponytail: a syntax check only (something@domain.tld); the server's MailAddress check has the last word.
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]{2,}$/;

export function isEmail(text: string): boolean {
  return EMAIL.test(text);
}

/** Typed or pasted addresses, split on commas, semicolons and spaces; repeats dropped whatever the case. */
export function parseAddresses(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    if (!part || seen.has(part.toLowerCase())) continue;
    seen.add(part.toLowerCase());
    (isEmail(part) ? valid : invalid).push(part);
  }
  return { valid, invalid };
}

const key = (r: ScheduleRecipient) => `${r.type}:${r.value.toLowerCase()}`;

/** Adds the recipients not already in the list under To, Cc or Bcc; skipped counts the rest. */
export function addRecipients(list: ScheduleRecipient[], incoming: ScheduleRecipient[]): { list: ScheduleRecipient[]; skipped: number } {
  const seen = new Set(list.map(key));
  const next = [...list];
  for (const r of incoming) {
    if (seen.has(key(r))) continue;
    seen.add(key(r));
    next.push(r);
  }
  return { list: next, skipped: list.length + incoming.length - next.length };
}
