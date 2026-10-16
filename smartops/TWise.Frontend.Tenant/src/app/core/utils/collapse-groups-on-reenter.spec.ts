import '@angular/compiler';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { collapseGroupsOnReenter } from './collapse-groups-on-reenter';

describe('collapseGroupsOnReenter', () => {
  it('runs the re-entry callback only for matching routes', () => {
    const events = new Subject<unknown>();
    const router = { events } as unknown as Router;
    const groups = [{ expanded: true }];
    const onChanged = vi.fn();
    const onReenter = vi.fn();
    const subscription = collapseGroupsOnReenter(
      router,
      ['standard-charts'],
      () => groups,
      onChanged,
      onReenter,
    );

    events.next(new NavigationEnd(1, '/standard-charts', '/other-page'));
    expect(onReenter).not.toHaveBeenCalled();

    events.next(new NavigationEnd(2, '/other-page', '/standard-charts'));
    expect(onReenter).toHaveBeenCalledOnce();
    expect(groups[0].expanded).toBe(false);

    subscription.unsubscribe();
  });
});