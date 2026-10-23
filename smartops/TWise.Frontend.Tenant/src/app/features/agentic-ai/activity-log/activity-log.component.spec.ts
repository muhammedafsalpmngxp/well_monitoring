import { describe, expect, it } from 'vitest';
import { ActivityLogComponent } from './activity-log.component';

describe('ActivityLogComponent hierarchy filters', () => {
  it('treats All as every option checked and supports Clear all before picking values', () => {
    const component = new ActivityLogComponent();

    component.toggleGlobalFilter('cluster', 'Marmul');
    expect(component.filterCluster).toEqual(['Nimr', 'Rima']);

    component.openGlobalFilter = 'cluster';
    component.clearGlobalFilterSelection('cluster', new MouseEvent('click'));
    expect(component.isGlobalFilterCleared('cluster')).toBe(true);
    expect(component.filterCluster).toEqual(['Nimr', 'Rima']);

    component.toggleGlobalFilter('cluster', 'Marmul');
    expect(component.filterCluster).toBe('Marmul');
    expect(component.isGlobalFilterCleared('cluster')).toBe(false);

    component.toggleGlobalFilter('cluster', 'Nimr');
    expect(component.filterCluster).toEqual(['Marmul', 'Nimr']);
    expect(component.selectionLabel(component.filterCluster)).toBe('Marmul, Nimr');

    component.openGlobalFilter = 'cluster';
    component.clearGlobalFilterSelection('cluster', new MouseEvent('click'));
    component.openGlobalFilter = null;
    expect(component.filterCluster).toBe('All');
  });

  it('clears selections to unrestricted All and removes the active chip', () => {
    const component = new ActivityLogComponent();
    component.filterPlant = ['Plant 1', 'Plant 2'];

    component.removeFilterChip('plant');

    expect(component.filterPlant).toBe('All');
    expect(component.activeFilterChips.some(chip => chip.key === 'plant')).toBe(false);
  });

  it('closes the dropdown only on clicks outside its trigger and options', () => {
    const component = new ActivityLogComponent();
    const trigger = document.createElement('button');
    trigger.className = 'acl-global-filter-trigger';
    const outside = document.createElement('div');
    component.openGlobalFilter = 'plant';
    const insideClick = new MouseEvent('click');
    Object.defineProperty(insideClick, 'target', { value: trigger });
    component.closeGlobalFilterOnOutsideClick(insideClick);
    expect(component.openGlobalFilter).toBe('plant');
    const outsideClick = new MouseEvent('click');
    Object.defineProperty(outsideClick, 'target', { value: outside });
    component.closeGlobalFilterOnOutsideClick(outsideClick);
    expect(component.openGlobalFilter).toBeNull();
  });
});
