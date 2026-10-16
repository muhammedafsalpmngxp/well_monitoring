import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { NavigationEnd } from '@angular/router';
import { Subject } from 'rxjs';
import { LayoutStateService } from '../../core/services/layout-state.service';
import { routes as canvasRoutes } from '../../features/canvas/canvas-routing.module';
import { routes as modelStudioRoutes } from '../../features/model-studio/model-studio-routing.module';
import { MainLayoutComponent } from './main-layout.component';

/** A root route snapshot whose chain of children carries the given data, outermost first. */
function snapshot(...data: object[]): unknown {
  return { data: {}, firstChild: data.reduceRight<unknown>((firstChild, d) => ({ data: d, firstChild }), null) };
}

function setup(start: unknown = snapshot()) {
  const events = new Subject<unknown>();
  const router = { events, routerState: { snapshot: { root: start } } };
  const layoutState = new LayoutStateService();
  const component = new MainLayoutComponent(layoutState, router as never, { markForCheck: vi.fn() } as never);
  const go = (root: unknown) => {
    router.routerState.snapshot.root = root;
    events.next(new NavigationEnd(1, '/next', '/next'));
  };
  return { component, layoutState, go };
}

describe('MainLayoutComponent', () => {
  it('keeps the padded layout, the footer and the sidebar as they are on ordinary pages', () => {
    const { component, layoutState, go } = setup(snapshot({ permission: 'dashboard' }, {}));
    component.ngOnInit();
    expect(component.fullBleed).toBe(false);

    go(snapshot({ permission: 'model.studio' }, {}));
    expect(component.fullBleed).toBe(false);
    expect(layoutState.isCollapsed).toBe(false);
  });

  it('fills the screen on a full-bleed page, collapses the sidebar, and restores it on the way out', () => {
    const { component, layoutState, go } = setup(snapshot({ permission: 'model.studio' }, { fullBleed: true }));
    component.ngOnInit();
    expect(component.fullBleed).toBe(true);
    expect(layoutState.isCollapsed).toBe(true);

    go(snapshot({ permission: 'model.studio' }, {}));
    expect(component.fullBleed).toBe(false);
    expect(layoutState.isCollapsed).toBe(false);
  });

  it('restores the sidebar from before the first full-bleed page after going from one to another', () => {
    const { component, layoutState, go } = setup();
    component.ngOnInit();

    go(snapshot({ permission: 'dashboard.canvas' }, { fullBleed: true }));
    go(snapshot({ permission: 'model.studio' }, { fullBleed: true }));
    expect(layoutState.isCollapsed).toBe(true);

    go(snapshot({ permission: 'dashboard' }, {}));
    expect(layoutState.isCollapsed).toBe(false);
  });

  it('marks only the Model Studio and canvas editor pages as full bleed', () => {
    const tagged = [...modelStudioRoutes, ...canvasRoutes].map(route => [route.path, route.data?.['fullBleed'] === true]);
    const lists = [['', false], ['standard', false], ['wip', false], [':id', true]];
    expect(tagged).toEqual([...lists, ...lists]);
  });
});
