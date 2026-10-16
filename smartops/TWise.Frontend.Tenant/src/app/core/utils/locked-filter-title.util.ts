export interface LockedFilterTitleRule {
  label?: string;
  sourceColumn?: string;
  controlType?: string;
  locked?: boolean;
  lockedValue?: string;
  lockedValues?: string[];
}

export function appendLockedFilterTitle(title: string, design: Record<string, unknown> | null | undefined): string {
  const filters = (design?.['interactiveFilters'] as LockedFilterTitleRule[] | undefined) ?? [];
  const suffix = filters
    .filter(filter => filter.locked && filter.sourceColumn && (filter.lockedValue || filter.lockedValues?.length))
    .map(filter => {
      const filterName = (filter.label || filter.sourceColumn || '').trim();
      const selectedValue = filter.controlType === 'MultiSelect'
        ? (filter.lockedValues ?? []).join(', ')
        : (filter.lockedValue ?? '').trim();
      return filterName && selectedValue ? `${filterName}-${selectedValue}` : '';
    })
    .filter(Boolean)
    .join('-');

  return suffix ? `${title}-${suffix}` : title;
}
