# Accessibility Conformance Statement — SmartOps (T-Wise) Tenant Web App

**Standard:** WCAG 2.1, Level AA
**Status:** Partially conforms (see *Known limitations*)
**Assessed:** 9 Oct 2026, build of PR #1078 (`balu_a11y_fixes`)

## What is supported

| Area | Support |
|---|---|
| Keyboard | Every control reachable with Tab and operable with Enter / Space; "Skip to main content" link; dialogs keep focus inside, close with Escape and return focus to the control that opened them; visible focus indicators. |
| Screen readers | Dialogs announced as modal dialogs with their title; buttons, icons and toggles have accessible names; form fields linked to their labels; expandable sections announce expanded / collapsed; data grids read rows in visual order; charts use the Highcharts accessibility module. |
| Colour contrast | Text meets 4.5:1 (AA) on the screens listed below, including the app-wide muted-text colour and status / severity pills. |
| Zoom and reflow | Content reflows to a single column at 320 CSS px (400% zoom at 1280 px) without horizontal page scrolling on the screens checked; tables and charts scroll within their own area, as WCAG 1.4.10 allows. |
| Regression guard | CI check (`npm run lint:a11y`) blocks new mouse-only controls, dialogs without dialog handling and images without alt text. |

## How it was tested

- **Automated:** axe-core 4.10 (WCAG 2.0 / 2.1 A and AA rules) on each screen with real data. All screens below pass with **0 violations**:
  Standard Boards, WIP Boards, Crew Calendar, Standard Charts, WIP Charts, Standard Tiles, WIP Tiles, Chart Details, Standard Reports, My Reports, Users, Create User dialog, Roles & Permissions, Error Log & Rules, Self-Healing AI, Data Dictionary, Database Views, Data Sync, Data Sources, Marketplace, Smart Alerts, Alert Rule Configuration, AI Agents, Activity Log, Model Studio, BI Canvas, Chart Builder, Tile Builder, Dashboard Builder, Report Builder, Database View Builder.
  Report Viewer passes except one third-party item (see *Known limitations* 3).
- **Reflow:** each screen loaded at 320 CSS px wide; checked for horizontal scrolling and overlapping or clipped controls (Standard Boards, Chart Details, Users, Standard Reports, Error Log & Rules, Database Views).
- **Keyboard / dialog behaviour:** Create User dialog — focus moves in on open, Tab wraps inside, Escape closes, focus returns to the opener. Unit tests cover the shared dialog, keyboard and label behaviours.

## Known limitations

1. **Manual screen-reader testing (NVDA / JAWS) has not yet been performed.** Automated tools find about half of real-world issues; the script below must be run before claiming full conformance.
2. Screens not yet audited: New Agent (planned next phase), Dashboard viewer, Schedules, Delivery Log, Power BI, WIP Model Studio / Canvas, and dialogs other than Create User.
3. Report Viewer: ag-grid adds `aria-expanded` to every row when row grouping is enabled; inside a plain `grid` this is flagged by axe (rows are announced as "collapsed"). This comes from the grid library, not app code.
4. Many clickable cards and list rows are `div` elements given button behaviour (role, Tab stop, Enter/Space) rather than native `<button>` elements; this is conformant but less robust than native controls.
5. At widths under 480 px the app's own back / forward buttons are hidden; the browser's back / forward remain available.
6. Localization (translated UI, right-to-left layout) is not supported yet; it is planned as a separate feature.

## Manual screen-reader test (about 15 minutes, NVDA + Chrome)

1. Load any page, press **Tab**: "Skip to main content" is announced; **Enter** moves to the page content.
2. Sidebar: **Tab** through menu items; each is announced with its name.
3. Users → **Create User**: "Create User, dialog" is announced; each field is read with its label; **Escape** closes; focus returns to "Create User".
4. Standard Boards: **Tab** to a board card; its name is read; **Enter** opens it; the favourite star toggles with **Space**.
5. Chart Details: the reliability badge reads its score and breakdown; the data table is announced as "Chart data table, region".
6. Any report grid: arrow keys move between cells; rows are read in order.
7. Roles & Permissions: tree nodes announce "Expand / Collapse <name>" and expanded state.

Report any item that is not announced as described.

## Contact

Accessibility issues: raise a defect against the SmartOps web app with the screen, the assistive technology used and the steps.
