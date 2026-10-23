export type GlobalFilterSelection = string | string[];

export function globalSelectionValues(selection: GlobalFilterSelection | null | undefined): string[] {
  const values = Array.isArray(selection) ? selection : [selection ?? ''];
  return [...new Set(values.filter(value => value && value !== 'All'))];
}

export function hasGlobalSelection(selection: GlobalFilterSelection | null | undefined): boolean {
  return globalSelectionValues(selection).length > 0;
}

/**
 * Toggles one option. When `options` are supplied, an implicit "All" selection is treated as
 * every option checked, so clicking one unchecks only that option; checking every option
 * collapses back to "All".
 */
export function toggleGlobalSelection(
  selection: GlobalFilterSelection | null | undefined,
  value: string,
  options?: readonly string[] | null,
  startEmpty = false,
): GlobalFilterSelection {
  if (!value || value === 'All') return 'All';
  if (startEmpty) return value;
  const available = [...new Set((options ?? []).filter(option => option && option !== 'All'))];
  const selected = globalSelectionValues(selection);
  const values = !selected.length && available.length > 1 && available.includes(value) ? available : selected;
  const next = values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  if (available.length > 1 && available.every(option => next.includes(option))) return 'All';
  return next.length > 1 ? next : next[0] ?? 'All';
}

/** Checkbox state for a global filter option: "All" (no explicit selection) checks every option. */
export function isGlobalFilterOptionChecked(selection: GlobalFilterSelection | null | undefined, option: string): boolean {
  if (!option || option === 'All') return !hasGlobalSelection(selection);
  return matchesGlobalSelection(option, selection);
}

/**
 * Tracks a dropdown whose boxes were all unticked via "Clear all". The applied filter is not
 * changed until the user picks an option; if the dropdown closes first, the caller reverts to All.
 */
export class GlobalFilterClearState<K = unknown> {
  private cleared: { key: K; panel: string | null } | null = null;

  clear(key: K, panel: string | null): void {
    this.cleared = { key, panel };
  }

  isCleared(key: K): boolean {
    return this.cleared !== null && this.cleared.key === key;
  }

  /** Returns true (and resets) when the next pick for `key` should start from an empty selection. */
  consume(key: K): boolean {
    if (!this.isCleared(key)) return false;
    this.cleared = null;
    return true;
  }

  /** Call when the open dropdown changes; returns the key abandoned while cleared, if any. */
  release(openPanel: string | null): { key: K } | null {
    if (!this.cleared || this.cleared.panel === openPanel) return null;
    const { key } = this.cleared;
    this.cleared = null;
    return { key };
  }
}

export function matchesGlobalSelection(value: unknown, selection: GlobalFilterSelection | null | undefined): boolean {
  const values = globalSelectionValues(selection);
  if (!values.length) return true;
  if (value == null || typeof value === 'object') return false;
  const text = String(value).trim().toLowerCase();
  return values.some(selected => selected.trim().toLowerCase() === text);
}

export function globalSelectionLabel(selection: GlobalFilterSelection | null | undefined): string {
  return globalSelectionValues(selection).join(', ') || 'All';
}

export function globalSelectionPayload(selection: GlobalFilterSelection): {
  controlType: 'Dropdown' | 'MultiSelect'; value: string; values?: string[];
} {
  const values = globalSelectionValues(selection);
  return values.length > 1
    ? { controlType: 'MultiSelect', value: '', values }
    : { controlType: 'Dropdown', value: values[0] ?? '' };
}

export function globalSelectionQueryValue(selection: GlobalFilterSelection): string {
  if (typeof selection === 'string') return selection;
  const values = globalSelectionValues(selection);
  return values.length > 1 ? JSON.stringify(values) : values[0] ?? 'All';
}

export function parseGlobalSelection(value: string): GlobalFilterSelection {
  if (!value.startsWith('[')) return value || 'All';
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error('Invalid global filter selection.');
  }
  const values = globalSelectionValues(parsed);
  return values.length > 1 ? values : values[0] ?? 'All';
}
