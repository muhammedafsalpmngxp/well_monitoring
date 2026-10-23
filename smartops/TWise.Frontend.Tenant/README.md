# TWiseDashboardUi

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.0.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Report percentage columns

Report columns containing numeric text with an appended `%` (for example, `12.5%`) are available to Math Operation transformations, numeric DAX operations, calculated fields, numeric comparisons, and data bars, as well as Sum/Average totals and grouping. Calculations use the displayed numeric value (`12.5%` is `12.5`, not `0.125`). Math Operation preserves the `%` suffix without rounding intermediate results; Type Change to Number removes it. Other text suffixes remain non-numeric, and percentage columns remain available to text operations.

## Report Excel export

Excel generates one serial-number column. When the report includes a visible Sl No. source column, its saved header label, group, and sub-group are retained on that generated column, including groups shared with neighboring columns. Reports without a serial source column keep the separate auto-number header.

## Crew Calendar planning and utilization

Planned is an independent scenario containing only unassigned activities that have not started. Recorded assignments and historical roster reservations are not loaded into that scenario; Actual retains the recorded activity data. Allocation follows cluster, then crew group, then natural crew-code order. A named-cluster activity requires a roster crew mapped to that same cluster and crew group; missing mappings are not a wildcard. Unclassified activities can use only unmapped crews. A crew mapped to several clusters shares its availability across them, and each preview activity is shown only under its own cluster.

Pending activities are considered by start date, end date, then activity ID. Each is proposed to the first matching crew whose proposals in the current allocation round do not overlap its inclusive dates. Earlier rounds are tried first. If every matching crew conflicts in every existing round, a new round starts from the first matching crew and may overlap work in earlier rounds. For example, four distinct activities on October 1-7 with three matching crews go to Crew 1, Crew 2, Crew 3, then Crew 1 again; a nonconflicting activity on October 10-13 still goes to Crew 1. Activities without a matching roster crew or valid dates remain unallocated rather than receiving an unrelated crew. Later crews can remain idle when earlier crews fit all eligible work. Browser-cached proposals cannot override this ordering. Planning does not write assignments to the database.

For a selected date range, utilization is the sum of each distinct planned or recorded activity's days in the range divided by the crew's available calendar days. Overlapping activities count separately: two activities spanning the entire range yield 200%, including activities allocated in different planning rounds. Historical reservation days do not contribute to the independent plan. Actual work stops at today; milestones and draft activities do not contribute. Idle days cannot be negative, and 100% or greater is shown as fully utilized in the report.

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
