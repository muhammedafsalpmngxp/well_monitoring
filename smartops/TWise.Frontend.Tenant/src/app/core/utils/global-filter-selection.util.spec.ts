import { describe, expect, it } from 'vitest';
import { GlobalFilterClearState, globalSelectionPayload, globalSelectionQueryValue, globalSelectionValues, isGlobalFilterOptionChecked,
  matchesGlobalSelection, parseGlobalSelection, toggleGlobalSelection } from './global-filter-selection.util';

describe('global filter selections', () => {
  it('keeps single selections scalar and toggles multiple values independently', () => {
    expect(toggleGlobalSelection('All', 'North')).toBe('North');
    expect(toggleGlobalSelection('North', 'South')).toEqual(['North', 'South']);
    expect(toggleGlobalSelection(['North', 'South'], 'North')).toBe('South');
    expect(toggleGlobalSelection('South', 'South')).toBe('All');
    expect(toggleGlobalSelection(['North', 'South'], 'All')).toBe('All');
  });

  it('treats All as every option checked when options are known', () => {
    const options = ['All', 'North', 'South', 'West'];
    expect(toggleGlobalSelection('All', 'North', options)).toEqual(['South', 'West']);
    expect(toggleGlobalSelection('', 'West', ['North', 'West'])).toBe('North');
    expect(toggleGlobalSelection(['South', 'West'], 'North', options)).toBe('All');
    expect(toggleGlobalSelection('All', 'Unknown', options)).toBe('Unknown');
    expect(toggleGlobalSelection('All', 'Oman', ['Oman'])).toBe('Oman');
    expect(toggleGlobalSelection('Oman', 'Oman', ['Oman'])).toBe('All');
  });

  it('shows every option checked for an All selection', () => {
    expect(isGlobalFilterOptionChecked('All', 'North')).toBe(true);
    expect(isGlobalFilterOptionChecked('', 'North')).toBe(true);
    expect(isGlobalFilterOptionChecked('All', 'All')).toBe(true);
    expect(isGlobalFilterOptionChecked(['North'], 'All')).toBe(false);
    expect(isGlobalFilterOptionChecked(['North'], 'South')).toBe(false);
    expect(isGlobalFilterOptionChecked(['North'], 'North')).toBe(true);
  });

  it('starts from an empty selection after Clear all and reverts when abandoned', () => {
    expect(toggleGlobalSelection(['North', 'South'], 'West', ['North', 'South', 'West'], true)).toBe('West');
    expect(toggleGlobalSelection('All', 'North', ['North', 'South'], true)).toBe('North');

    const state = new GlobalFilterClearState<string>();
    state.clear('cluster', 'tm_cluster');
    expect(state.isCleared('cluster')).toBe(true);
    expect(state.isCleared('plant')).toBe(false);
    expect(state.release('tm_cluster')).toBeNull();
    expect(state.consume('cluster')).toBe(true);
    expect(state.consume('cluster')).toBe(false);

    state.clear('plant', 'plant');
    expect(state.release(null)).toEqual({ key: 'plant' });
    expect(state.isCleared('plant')).toBe(false);
  });

  it('matches any selected value without treating comma-containing labels as lists', () => {
    expect(matchesGlobalSelection('South', ['North', 'South'])).toBe(true);
    expect(matchesGlobalSelection('West', ['North', 'South'])).toBe(false);
    expect(matchesGlobalSelection('North', 'North, South')).toBe(false);
    expect(matchesGlobalSelection('Anything', 'All')).toBe(true);
  });

  it('preserves scalar payloads and sends all multi-selection values', () => {
    expect(globalSelectionPayload('North')).toEqual({ controlType: 'Dropdown', value: 'North' });
    expect(globalSelectionPayload(['North', 'South'])).toEqual({
      controlType: 'MultiSelect', value: '', values: ['North', 'South'],
    });
  });

  it('round trips selections through navigation without splitting names', () => {
    const values = ['North, West', 'South'];
    expect(parseGlobalSelection(globalSelectionQueryValue(values))).toEqual(values);
    expect(parseGlobalSelection(globalSelectionQueryValue('North, West'))).toBe('North, West');
    expect(globalSelectionValues(['All', 'South', 'South'])).toEqual(['South']);
    expect(() => parseGlobalSelection('[1]')).toThrow('Invalid global filter selection');
  });
});
