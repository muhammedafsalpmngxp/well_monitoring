# Data Governance — Internal Documentation

Branch `balu-governance`. Adds a stored data dictionary and a computed lineage graph; data quality
rules already existed (`Features/DataQuality`, `core.DataRules` + `core.ErrorLog`) and are untouched.

## 1. Files

```
Domain/Entities/DataDictionaryEntry.cs            one row per documented column (column_name NULL = dataset-level)
Domain/DTOs/GovernanceDtos.cs                     dictionary + lineage DTOs
Application/Abstractions/Services/IGovernanceService.cs
Infrastructure/Services/GovernanceService.cs      dictionary merge/upsert + lineage derivation
Infrastructure/Persistence/Configurations/DataDictionaryEntryConfiguration.cs
API/Controllers/GovernanceController.cs           api/governance/*
infra/sql/add-governance.sql                      core.DataDictionary (tenant DB)
infra/sql/add-governance-permission.sql           control.FeatureModule row 'data-quality.lineage' (control-plane DB)
ControlPlane .../sql/init-tenant-schema.sql       mirror of the table for new tenants

Frontend
core/services/governance.service.ts
features/data-quality/data-dictionary/*           rewritten: real data (was a hard-coded mock, hidden in the menu)
features/data-quality/lineage/*                   new page (SVG, four columns)
```

No MediatR handlers: the controller calls `IGovernanceService` directly. The service uses
`TenantDbContext` because lineage reads eight tables and a repository per table would add nothing.

## 2. Data dictionary

The dictionary never stores technical schema. On every read the service loads the dataset's columns
and left-joins the stored entries by `(tenant_id, dataset_kind, dataset_id, column_name)`:

* `import` → `ImportedDataset.ColumnsJson` (`[{name,type}]`), only `Status = completed` datasets are listed.
* `view` → `DatabaseView.PreviewColumnsJson` (the view's real output after a preview); when a view was
  never previewed, `SelectedColumnsJson` with `ColumnAliasesJson` applied. `dataType` is empty for views.
  Only `ViewType = 'view'` rows are listed (CTEs and components are building blocks, not datasets).

`SaveDatasetAsync` upserts the dataset-level row (`column_name NULL`) and each column sent, after
filtering to column names that exist on the dataset, so renamed or removed columns cannot leave
orphans. Stale entries for columns that no longer exist are simply not shown. Sensitivity outside the
four allowed values falls back to `internal` (the table also has a CHECK).

Unique index `UX_core_DataDictionary_column (tenant_id, dataset_kind, dataset_id, column_name) WHERE is_deleted = 0`
— SQL Server treats NULL as a value in unique indexes, so the dataset-level row is unique too.

## 3. Lineage derivation

`GetLineageAsync` builds nodes first, then edges; `Edge()` drops any edge whose end is missing, so
dangling pointers (deleted view, chart pointing at a removed import) never produce broken graphs.

| Edge | Source of truth |
|---|---|
| source → import | `ImportedDataset.DataSourceConnectionId` |
| db → view | `DatabaseView.ConnectionId` |
| view → view | `ReferencedCteIdsJson`, `ReferencedComponentIdsJson` |
| import/view/table → chart | `Widget.SourceType` + `SourceId` (falls back to parsing `Source` as an id) |
| view → chart (drill-down) | `DesignJson.drillDownViewId` |
| tile → chart | `DesignJson.attachedTileIds` |
| view/table → report | `Report.SourceType` + `SourceName` (views matched by name) |
| chart → dashboard | `ConfigJson.widgets[].chartId` via `DashboardWidgetLookup.GetWidgetIds` |

Dashboards included: not deleted, and `IsLatestVersion` or `VersionNo IS NULL` (drafts never
published). Dashboards have no `TenantId` column: the tenant DB is already per tenant.

`table:{name}` nodes are created only when a chart or report uses a table by name, so the graph does
not list every core table.

The frontend assigns columns by kind (`LAYER` map in `lineage.component.ts`) and walks edges
breadth-first for the up/downstream highlight. Same-column edges (view → view) are drawn as a loop
to the right of the column.

## 4. Deployment

1. `infra/sql/add-governance.sql` on every tenant database (idempotent).
2. `infra/sql/add-governance-permission.sql` on the control-plane database, then grant
   `data-quality.lineage` to the roles that should see the page (`seed-rbac-defaults.sql` grants it to
   `admin` for fresh installs). Admins bypass permission checks anyway.
3. Applied already to `smartops_tenant_TNT-1000` and `smartops_control_plane_qa`.

## 5. Debugging

| Symptom | Likely cause |
|---|---|
| A view shows no columns in the dictionary | Never previewed and no selected columns; run the view once in the View Builder |
| A chart has no upstream in lineage | `Widget.SourceId` is null and `Source` is not a numeric id (older rows); re-saving the chart fixes it |
| A dashboard is missing | It is an older version (`IsLatestVersion = 0`) or `Status = Deleted` |
| Lineage page is 403 | Role lacks `data-quality.lineage`; run `add-governance-permission.sql` and grant it |
