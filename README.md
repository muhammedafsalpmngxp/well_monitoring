# Al Tasnim Group — Insight (Angular)

Angular 17 conversion of the original `demo_2__62_.html` single-page
application. Every page from the original is preserved as a route, the
sidebar/topbar shell is preserved verbatim, and all original
JavaScript (Chart.js charts, ag-grid tables, dashboards, flow
designer, AI agents, role-based filtering, theme switcher, etc.)
runs unchanged.

---

## Requirements

- **Node.js 18.13+** (Angular 17 requires it)
- **npm 9+**

---

## Run it

```bash
npm install
npm start          # opens http://localhost:4200
```

Build for production:

```bash
npm run build      # writes dist/al-tasnim-insight/
```

Serve the production bundle from any static-file server:

```bash
cd dist/al-tasnim-insight
python3 -m http.server 8080
```

---

## Routes

The original SPA's `navigate('xxx')` calls map directly to URLs. The
default landing route is `/cmdoverview` (the Command Center · Overview
Dashboard).

| Section | Routes |
| --- | --- |
| Executive | `/execsummary`, `/mdbriefing` |
| Insight | `/cmdoverview`, `/allwells`, `/critdates`, `/smartalerts`, `/watchlist`, `/delayforecast` |
| Field Ops | `/material`, `/aiopt`, `/labour`, `/predict` |
| Crew & Activities | `/crewmaster`, `/crewlist`, `/crewassign`, `/prating`, `/actmaster`, `/activities` |
| Production Intel | `/incentive`, `/scorecards`, `/jobcost`, `/pirevamp` |
| Data Quality | `/errorlog`, `/selfheal`, `/datadict` |
| AI / Analytics | `/forecastai`, `/criticalpath`, `/rootcause`, `/progopt`, `/anomaly`, `/autopm`, `/predictive`, `/resalloc`, `/variance` |
| Process Automation | `/flowdesigner`, `/flowedit`, `/connections` |
| Agentic AI | `/aiagents`, `/aiagent-edit`, `/agentruns` |
| Other | `/penalty`, `/projoverview`, `/commission`, `/dashboards`, `/dashboard-edit`, `/settings` |

Deep-linking, browser back/forward, and refresh all work — the page
content and sidebar highlight are driven from the URL.

---

## Project layout

```
src/
├── index.html                       — loads Inter font + Chart.js + ag-grid + xlsx CDN scripts
├── main.ts                          — Angular bootstrap
├── styles.css                       — full original CSS, unchanged (~9,400 lines)
├── favicon.ico                      — placeholder; replace with real icon
├── assets/
│   ├── sidebar.html                 — original <aside class="sidebar">
│   ├── topbar.html                  — original <header class="topbar">
│   ├── well-detail-overlay.html     — well-drilldown overlay markup
│   ├── shell-modals.html            — flow-designer & AI-builder modal markup
│   ├── pages-index.json             — list of all page IDs
│   ├── app-globals.js               — full original JavaScript (~19,400 lines):
│   │                                  navigate(), toggleTheme(), every
│   │                                  renderXxx(), Chart.js setup, ag-grid
│   │                                  config, role filtering, dashboard
│   │                                  view-switcher, …
│   └── pages/                       — 46 HTML snippets, one per route
│       ├── cmdoverview.html
│       ├── allwells.html
│       └── …
└── app/
    ├── app.module.ts                — declares components + APP_INITIALIZER
    ├── app-routing.module.ts        — 46 routes → PageHostComponent
    ├── app.component.ts             — top-level shell layout
    │
    ├── components/
    │   ├── sidebar/                 — injects sidebar.html, syncs .active to URL
    │   ├── topbar/                  — injects topbar.html
    │   └── page-host/               — fetches assets/pages/<id>.html on every
    │                                  route change, re-runs inline scripts,
    │                                  calls the matching renderXxx() function
    │
    └── services/
        ├── shell-assets.service.ts  — preloads sidebar/topbar/overlay/modals
        └── globals-loader.service.ts — injects app-globals.js, patches
                                         late-arriving DOMContentLoaded handlers
```

---

## How it works

### Boot sequence

1. `index.html` loads three CDN libraries the original SPA uses
   (Chart.js, ag-grid, xlsx) before Angular starts.
2. Angular bootstraps. `APP_INITIALIZER` runs:
   - `ShellAssetsService.preload()` fetches the four shell HTML chunks.
   - `GlobalsLoaderService.load()` injects `assets/app-globals.js`,
     wrapping `document.addEventListener` so any
     `DOMContentLoaded` handlers registered inside the bundle still
     fire (the real event already happened).
3. Angular renders `AppComponent`, which contains the `.shell`
   structure: `<app-sidebar>`, `<app-topbar>`, the page-scroll
   `<router-outlet>`, the well-detail overlay, and the shared modals.
4. The router resolves the URL (default `/cmdoverview`) and renders
   `PageHostComponent`, which fetches that page's HTML and runs its
   render function.

### How each page is rendered

`PageHostComponent` is the same component for every route (the route
definition supplies the `pageId` via `data`). On each navigation:

1. Fetch `assets/pages/<pageId>.html` (cached after first load).
2. Set `innerHTML` on the host div.
3. Replace each `<script>` tag in the injected HTML with a fresh
   `<script>` element (innerHTML doesn't auto-execute scripts).
4. Add the `.active` class to the page's root `<div class="page">`
   (the original CSS hides any non-active page).
5. Call the page's render function on `window` — e.g. `renderForecastAI()`,
   `renderCrewMaster()`, `dbRenderList()`. The mapping mirrors the
   original `navigate()` switch in `app-globals.js`.

### Why a single `PageHostComponent` instead of 46 components

The 46 pages share state through globals defined in `app-globals.js`
(`window.currentProject`, `window.dvs`, `window.dbDashboards`,
chart instances, etc.). Splitting them into separate Angular
components without porting that state to services would fragment the
code without benefit. The `PageHostComponent` model preserves the
original architecture exactly, with Angular handling routing and
component lifecycle on top.

### Sidebar interaction

- Clicking a sidebar item still triggers the original
  `onclick="navigate('foo', this)"` handler. `AppComponent.ngOnInit()`
  overrides `window.navigate` so it now calls
  `Router.navigateByUrl('/foo')` instead.
- `toggleGroup(...)` (the dropdown expander), `toggleThemeMenu()`,
  `setTheme(...)`, `setRole(...)`, `nbSelectProject(...)` all still
  resolve to their original implementations in the global bundle.
- `SidebarComponent` listens to `NavigationEnd` and updates the
  `.active` class on the current page's `nav-…` link automatically.

---

## Trade-offs and known limitations

This is a **wrapper-style conversion**, not a full Angular port. The
goal was preserving 100% of functionality with proper routing, not
rewriting 19,000+ lines of working JavaScript.

What that means in practice:

- **State lives on `window`**, not in Angular services. `currentProject`,
  dashboard definitions, chart instances, etc. are all global.
- **Pages aren't strongly typed.** Adding TypeScript interfaces for the
  data structures used by the original JS would require a real port.
- **Change detection is bypassed inside pages.** Page content is
  imperative DOM manipulation; Angular doesn't know about it. This is
  fine because each page does its own re-render via its global
  function — but it means you can't mix Angular bindings into a page
  template without thinking carefully about it.
- **Tree-shaking can't help app-globals.js.** It's loaded as a single
  external script, so all ~1.3 MB ships even if a user only visits two
  routes.
- **Server-side rendering (SSR) won't work** without changes — the
  global script depends on `window` and `document`.

If you want any of those improved, the natural next step is to pick
high-value pages (e.g. `cmdoverview`, `allwells`, `crewmaster`) and
port them properly: extract their data into typed Angular services,
their UI into components, and let the long tail of less-touched pages
keep using the wrapper.

---

## Customising

- **Replace the favicon**: drop your icon at `src/favicon.ico`.
- **Change the default route**: edit `src/app/app-routing.module.ts`
  and update the `redirectTo` in the `''` route.
- **Update CDN versions**: change the URLs in `src/index.html`.
- **Edit a page's markup**: edit `src/assets/pages/<pageId>.html`.
- **Edit the JS**: edit `src/assets/app-globals.js` directly.

---

## Build output sizes

```
vendor.js     2.65 MB    Angular framework
styles.css   547   kB    Original CSS
polyfills.js 114   kB    zone.js + es polyfills
main.js       40   kB    Angular app code
runtime.js     6   kB    webpack runtime
─────────────────────
Initial      3.34 MB
```

In addition: `app-globals.js` (1.3 MB) is loaded lazily at boot, and
each page's HTML is fetched on first visit (1–35 kB per page).
