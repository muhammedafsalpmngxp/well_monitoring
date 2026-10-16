# Model schema migrations

Scripts in this folder create and maintain the `model` schema in a tenant database. The schema stores datasets for the modelling layer: their sources, relationships, measures, calculated columns and transforms. `POST /api/query` reads it.

Nothing here changes `core`, `ref` or any other existing schema.

## Scripts

| Order | Script | Purpose | Undo with |
|---|---|---|---|
| 001 | `001-create-model-schema.sql` | Creates schema `model` and the tables `Dataset`, `DatasetSource`, `Relationship`, `Measure` | `001-create-model-schema.down.sql` |
| 002 | `002-unique-relationship.sql` | Adds a unique index on `model.Relationship` (`DatasetId`, `FromSourceId`, `FromColumn`, `ToSourceId`, `ToColumn`) so the same join cannot be saved twice. Stops without changes if duplicates already exist | `002-unique-relationship.down.sql` |
| 003 | `003-calculated-columns-and-transforms.sql` | Creates `model.CalculatedColumn` (a calculation on one row of a source, used like a column) and `model.Transform` (a change applied to a source column whenever it is read). Neither changes a source table | `003-calculated-columns-and-transforms.down.sql` |
| 004 | `004-import-schema.sql` | Creates schema `import` for tables loaded from uploaded files, and the registry table `model.ImportTable`. The Tenant API creates the tables in `import`; see "Uploaded files (004)" below | `004-import-schema.down.sql` (stops while `import` holds tables) |
| 005 | `005-pin-view-source-sql.sql` | Adds `model.DatasetSource.ViewSql`, the checked SQL of a view source as it was when a modeller added or last updated it. Queries run it instead of the view as it is now. View sources added before 005 keep NULL and are refused until a modeller updates them from their view | `005-pin-view-source-sql.down.sql` (drops the stored SQL of every view source) |
| 006 | `006-transform-kinds-and-date-columns.sql` | Widens `CK_model_Transform_Kind` with `replace` and `remove_rows`, and `CK_model_CalculatedColumn_DataType` with `date`. No table or column changes | `006-transform-kinds-and-date-columns.down.sql` (stops while such rows are stored) |
| 007 | `007-publish-and-measure-home.sql` | Adds `model.Dataset.PublishedModel` (the dataset as JSON at its last Publish, which canvases read), `PublishedAt`, `PublishedBy`, and `model.Measure.HomeSourceId` (the table a measure is listed under). No data changes | `007-publish-and-measure-home.down.sql` (loses every published version) |
| 008 | `008-standard-models.sql` | Seeds the standard content for a new tenant: datasets Well Delivery 360, Well Progress Tracker and Field Workforce Activity on the tenant's own well, progress and task tables, each published, and the canvases Well Delivery Command Center, Construction Progress Pulse and Field Workforce Pulse in the dashboard category Al Tasnim Dashboard (created if missing). Each is created only while none of that name exists. Needs 001 to 007 and a row in `core.DatabaseConnections` for the tenant database | `008-standard-models.down.sql` (soft-deletes them by name) |
| 009 | `009-hidden-columns.sql` | Adds `model.DatasetSource.HiddenColumns` (JSON list of the columns hidden from report builders). No data changes | `009-hidden-columns.down.sql` (shows every hidden column again) |
| 010 | `010-brand-kits.sql` | Creates `model.BrandKit`: named brand kits (chart colours, font, logo, text sizes) that canvas authors save and apply to any canvas. A canvas keeps its own copy of the kit it applied. No data changes | `010-brand-kits.down.sql` (drops every saved kit; canvases keep theirs) |
| 011 | `011-table-names.sql` | Adds `model.DatasetSource.Caption` (the table's name as people read it; formulas keep the alias) and `Description`. No data changes | `011-table-names.down.sql` (tables show their alias again) |
| 012 | `012-scheduled-deliveries.sql` | Creates schema `delivery` with `Schedule`, `ScheduleRecipient`, `MailGroup`, `MailGroupMember` and `ScheduleRun` for scheduled deliveries of reports, dashboards and canvases. No data changes | `012-scheduled-deliveries.down.sql` (drops every schedule, mail group and run log, then the schema) |
| 013 | `013-source-connection.sql` | Adds `model.DatasetSource.ConnectionId` (the connection whose database holds a table when it is not the data model's own; NULL reads the model's database) with a foreign key to `core.DatabaseConnections`. Such a table must be on the model's server and port and is read as `[database].[schema].[table]` through the model's connection. No data changes | `013-source-connection.down.sql` (stops while a source reads another database) |
| 014 | `014-saved-view-sources.sql` | Widens `CK_model_DatasetSource_Kind` with `script` (a View Builder view of DECLAREs and one final SELECT, stored in `ViewSql` as saved and run as written) and adds `model.DatasetSource.ParamsJson` (JSON object binding a declared variable to a model field). No data changes | `014-saved-view-sources.down.sql` (stops while a `script` source is stored) |

New scripts follow the same pattern: a three-digit order number, a short name, and a matching `.down.sql` that reverses it. Apply them in order. Never edit a script that has already been applied to a shared instance; add a new one instead.

## Requirements

- SQL Server 2016 or later. The scripts use `DROP TABLE IF EXISTS` and `ISJSON`.
- The target database must already have `core.DatabaseConnections`, which `model.Dataset` references.
- A login that can create schemas and tables in the tenant database.

## Applying to an instance

Run each script against the tenant database, for example `smartops_tenant_TNT-1000`:

```bash
sqlcmd -S <server> -U <user> -P <password> -d <tenant database> -i 001-create-model-schema.sql
```

The scripts do not contain a `USE` statement, so `-d` decides which database is changed. Check it before running.

Every up script is safe to run more than once. It creates only what is missing, so a second run changes nothing. It sets `QUOTED_IDENTIFIER` and `ANSI_NULLS` itself, so the default `sqlcmd` settings are fine.

## Checking the result

```sql
SELECT t.name AS table_name
FROM sys.tables t
WHERE t.schema_id = SCHEMA_ID('model')
ORDER BY t.name;
```

Expected after 001: `Dataset`, `DatasetSource`, `Measure`, `Relationship`. After 003 also `CalculatedColumn` and `Transform`.

## Undoing

Run the matching `.down.sql`, newest first: 003 before 001, because `model.CalculatedColumn` and `model.Transform` reference `model.DatasetSource`. The 001 down script drops the whole `model` schema, **including every dataset stored in it**. Back up the tables first if any datasets matter.

## Applied so far

| Instance | Database | Scripts | Date | Notes |
|---|---|---|---|---|
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 001 | 2026-09-21 | Setup, undo and setup again all verified |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 002 | 2026-09-21 | Applied twice; second run changed nothing |
| QA (`20.98.112.250`) | `smartops_control_plane_qa` | `add-model-studio-permission.sql` | 2026-09-21 | Applied twice; second run changed nothing. Grants `model.studio` to role `admin` (tenant 2) |
| QA (`20.98.112.250`) | `smartops_control_plane_qa` | `add-canvas-permission.sql` | 2026-09-21 | Applied twice; second run changed nothing. Grants `dashboard.canvas` to role `admin` (tenant 2) |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 003 | 2026-09-22 | Applied twice; second run changed nothing. Undo and setup again verified while both tables were empty |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 004 | 2026-09-22 | Applied twice; second run changed nothing. Undo and setup again verified while `import` held no tables and the registry was empty |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 005 | 2026-09-22 | Applied twice; second run changed nothing. No view sources existed, so none was left with NULL. Undo not run on QA |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 006 | 2026-09-22 | Applied twice; second run changed nothing. Dropped and re-created `CK_model_Transform_Kind` (`model.Transform`) and `CK_model_CalculatedColumn_DataType` (`model.CalculatedColumn`), both created by 003. Undo not run on QA |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 007 | 2026-09-25 | Applied twice; second run changed nothing. Down script run, then applied again |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 008 | 2026-09-25 | The datasets and canvases were built on QA first, so both runs changed nothing. The create path was run inside a transaction with the QA copies renamed, checked (parts, published JSON, canvas dataset ids) and rolled back. Down then setup again verified inside a rolled-back transaction |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 009 | 2026-09-25 | Applied twice; second run changed nothing. Undo not run on QA |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 008 (regenerated) | 2026-09-25 | The three showcase canvases rebuilt as two-sheet 16:9 stories (brand kit, synced slicers, text and images) and 008 regenerated from them. The create path was run in a transaction with the QA copies renamed, checked and rolled back. 008 skips a canvas whose name already exists, so an instance that ran the earlier 008 keeps the old canvases until they are deleted or renamed and 008 runs again |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 010 | 2026-09-25 | Applied twice; second run changed nothing. Down script run, then applied again |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 011 | 2026-09-25 | Applied twice; second run changed nothing. Down script run, then applied again |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 008 (regenerated again) | 2026-09-25 | Regenerated after later canvas work: Well Progress Tracker's Overall Progress %, Wells Past Halfway and Progress Band read `overall_progress` (`overall_progress_percentage` holds the location preparation value); Field Workforce Activity gains the measures Tasks, 3-month average, Tasks YTD, Tasks Rank and Output Score and the calculated column Weekday No; the story canvases gain a Top N filter, data bars, heatmap, tooltips, a highlight interaction, a drill-down donut and a weekday sort, and fixed-size headers. Checked with the create path in a rolled-back transaction. An instance that ran an earlier 008 keeps its datasets and canvases (008 skips existing names), so these changes reach it only after they are deleted or renamed and 008 runs again |
| QA (`20.98.112.250`) | `smartops_control_plane_qa` | `add-bi-standard-permissions.sql` | 2026-09-25 | Applied twice; second run changed nothing. Adds `model.standard-datasets` and `dashboard.standard-canvases`, renames the WIP modules, grants role `admin` (tenant 2) |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 012 | 2026-09-27 | Applied twice; second run changed nothing. Down script run, then applied again |
| QA (`20.98.112.250`) | `smartops_control_plane_qa` | `add-schedules-permission.sql` | 2026-09-27 | Applied twice; second run changed nothing. Adds `smart-alerts.schedules` under `smart-alerts` and grants it to the admin role |
| QA (`20.98.112.250`) | `smartops_control_plane_qa` | `add-bi-standard-permissions.sql` (rerun) | 2026-09-27 | Applied twice; renames the list modules to Standard Data Models and WIP Data Models |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 013 | 2026-09-28 | Applied twice; second run changed nothing. Down script run, then applied again |
| QA (`20.98.112.250`) | `smartops_tenant_TNT-1000` | 014 | 2026-09-28 | Applied twice; second run changed nothing. Down script run, then applied again. Recreates `CK_model_DatasetSource_Kind`, created by 001 |
| UAT (AWS RDS) | `smartops_tenant_TNT-1000-new` | 001-007, 009-014 | 2026-10-02 | Each applied twice in order; second run changed nothing. Down scripts not run. 008 not run yet: the database has no row in `core.DatabaseConnections` naming it |
| UAT (AWS RDS) | `smartops_control_plane_demo_new` | `add-bi-standard-permissions.sql` (rerun) | 2026-10-02 | Run after `add-model-studio-permission.sql`, which the team ran after the first run. Added `model.standard-datasets` and granted it to the admin role; renamed `model.studio` to WIP Data Models. Second run changed nothing |

## Control-plane script for Model Studio

Model Studio also needs one script in the control-plane database, which holds modules and role grants: `smartops/infra/sql/add-model-studio-permission.sql`. It adds the `model` and `model.studio` modules and grants `model.studio` to the admin roles. It is safe to run more than once. Like the scripts above, it has no `USE` statement, so run it with `-d` set to the control-plane database of the instance, for example:

```bash
sqlcmd -S <server> -U <user> -P <password> -d smartops_control_plane_qa -i ../add-model-studio-permission.sql
```

Roles other than admin get no access until someone grants `model.studio` to them in role management. Users must log in again after a grant so their token carries the permission. The rollback statements are in a comment at the top of the script.

## Control-plane script for the reporting canvas

The reporting canvas needs one script in the control-plane database: `smartops/infra/sql/add-canvas-permission.sql`. It adds the page module `dashboard.canvas` under the existing `dashboard` group and grants it to the admin roles. The canvas page, `POST /api/query` and the dataset reads check this code. It is safe to run more than once. It has no `USE` statement, so run it with `-d` set to the control-plane database of the instance:

```bash
sqlcmd -S <server> -U <user> -P <password> -d smartops_control_plane_qa -i ../add-canvas-permission.sql
```

A canvas is stored in `core.Dashboard.ConfigJson` with `"kind": "canvas"`, so the tenant database needs no script for it. Roles other than admin get no access until someone grants `dashboard.canvas` to them in role management. Users must log in again after a grant. The rollback statements are in a comment at the top of the script.

## Control-plane script for the Standard and WIP lists

Model Studio and the reporting canvas each have a Standard list (published items) and a WIP list (items being built), like Charts and Reports. `smartops/infra/sql/add-bi-standard-permissions.sql` adds the modules `model.standard-datasets` and `dashboard.standard-canvases` and renames `model.studio` to WIP Datasets and `dashboard.canvas` to WIP Canvases. The WIP codes keep their authoring meaning (create, modify). Admin roles get the new codes in full; any other role that can view a WIP list gets view on the matching Standard list. Run it after the two scripts above, with `-d` set to the control-plane database:

```bash
sqlcmd -S <server> -U <user> -P <password> -d smartops_control_plane_qa -i ../add-bi-standard-permissions.sql
```

A role with only a Standard code sees published items read-only: dataset reads and `POST /api/query` accept either Standard code for view.

## Uploaded files (004)

Model Studio's **Get data** navigator loads a sheet of an Excel or CSV file into a table `[import].[<name>]` of the tenant database. The Tenant API does this in one transaction. It creates the table (or drops and creates it again on a new upload), bulk-inserts the rows, writes the table's columns to `core.DatabaseSchema` and records the upload in `model.ImportTable`. Script `004` only creates the empty schema and the registry.

**Google Sheets.** The navigator also reads a Google Sheet shared as "Anyone with the link can view". `GET /api/model/datasets/{id}/imports/google-sheet?link=` downloads it as an .xlsx (same 10 MB limit, 30 second timeout) and the navigator loads its sheets exactly as an uploaded file, into `import` and `model.ImportTable`; no schema change. Only the sheet id is taken from the link, so the API only calls `docs.google.com`, which redirects to `*.googleusercontent.com`. A server without outbound HTTPS to those hosts gets "Google Sheets could not be reached". Private sheets are not supported. A loaded sheet is a copy taken at load time and does not follow later edits to the Google Sheet.

**Permissions (production risk).** The API needs to create, drop and fill tables in `import`. On QA it connects as `sa`, so nothing is granted. Before production, give the API a login that is not `sysadmin`. That login needs `CREATE TABLE` in the database and `ALTER, SELECT, INSERT, DELETE` on schema `import`. The statements are in a comment at the top of `004-import-schema.sql`.

**Removing an uploaded table by hand.** The API never drops an uploaded table, and the down script stops while `import` holds tables. First check that no dataset uses the table:

```sql
SELECT d.Id, d.Name, s.Alias FROM model.DatasetSource s JOIN model.Dataset d ON d.Id = s.DatasetId
WHERE s.SchemaName = 'import' AND s.SourceName = '<table>' AND d.IsDeleted = 0;
```

Then drop it and remove its catalogue rows and its registry row:

```sql
DROP TABLE IF EXISTS [import].[<table>];
UPDATE core.DatabaseSchema SET is_deleted = 1 WHERE schema_name = 'import' AND table_name = '<table>' AND is_deleted = 0;
DELETE FROM model.ImportTable WHERE TableName = '<table>';
```

## Scheduled deliveries: mail settings

Scheduled deliveries email a report, dashboard or canvas on a schedule. Two scripts must run before the feature works:

1. `012-scheduled-deliveries.sql` on the **tenant** database (for example `smartops_tenant_TNT-1000`). It creates schema `delivery` with the schedules, mail groups and the delivery log. Undo with `012-scheduled-deliveries.down.sql`, which drops them all.
2. `../add-schedules-permission.sql` on the **control-plane** database (on QA, `smartops_control_plane_qa`). It adds the page module `smart-alerts.schedules` under Smart Alerts and grants it to the admin roles. Users see it after their next login.

The Tenant API sends the mail. Its settings live in the `Mail` section of `appsettings.json`:

| Key | Meaning |
|---|---|
| `Mail:Host` | The SMTP server. **Leave it empty and nothing is sent**: each mail is written as an `.eml` file to the pickup folder instead. Use this on dev and QA. |
| `Mail:Port` | The SMTP port, normally `587`. |
| `Mail:EnableSsl` | `true` to use TLS (STARTTLS on port 587). Keep it `true` for any real server. |
| `Mail:User` | The account the Tenant API signs in to the SMTP server with. Leave empty for a server that needs no sign-in. |
| `Mail:Password` | That account's password. Never put it in `appsettings.json` or commit it; see below. |
| `Mail:From` | The sender address people see, for example `reports@tasnim.om`. Most servers only accept an address the account may send as. |
| `Mail:FromName` | The sender name people see, `T-Wise` by default. |
| `Mail:PickupDirectory` | Where `.eml` files go while `Mail:Host` is empty. Empty means `%TEMP%\twise-mail` on the Tenant API server. Open a file with Outlook or any mail program to check what would have been sent. |
| `Mail:AllowedDomains` | A list of domains mail may go to, for example `["tasnim.om"]`. An address in another domain is not sent to and is listed in the Delivery Log; everyone else still gets the mail. Empty allows every domain. |

Two more sections steer the feature:

| Key | Meaning |
|---|---|
| `Delivery:Enabled` | Starts the background worker that runs due schedules. It is `false` in the committed settings, so a developer machine pointed at a shared database never sends. Set `Delivery__Enabled=true` on the one Tenant API host per database that should send. Run now and Send test work either way. |
| `Delivery:PollSeconds` | How often the worker looks for due schedules, `60` by default. |
| `App:PublicBaseUrl` | The address of the T-Wise web app, used for the link in every mail, for example `https://twise-qa-ui.prod-app.in`. |

### Setting them without editing the file

Every key can be set as an environment variable of the Tenant API instead, with `__` (two underscores) in place of `:`. An environment variable wins over the file. For example:

```
Mail__Host=smtp.office365.com
Mail__Port=587
Mail__EnableSsl=true
Mail__User=reports@tasnim.om
Mail__Password=<the password>
Mail__From=reports@tasnim.om
Mail__AllowedDomains__0=tasnim.om
App__PublicBaseUrl=https://twise.prod-app.in
```

Keep the password in an environment variable or a secret store (for example Azure Key Vault or the hosting platform's secrets), never in `appsettings.json` and never in git.

### Office 365 example

| Key | Value |
|---|---|
| `Mail:Host` | `smtp.office365.com` |
| `Mail:Port` | `587` |
| `Mail:EnableSsl` | `true` |
| `Mail:User` | a licensed mailbox, for example `reports@tasnim.om` |
| `Mail:Password` | that mailbox's password (set as `Mail__Password`) |
| `Mail:From` | the same mailbox, or one it has Send As rights on |

The mailbox must have **Authenticated SMTP (SMTP AUTH)** turned on in the Microsoft 365 admin centre (Users, the mailbox, Mail, Manage email apps). Tenants with security defaults turned on block SMTP AUTH until an administrator allows it.

**Restart the Tenant API after any change** to these settings, in the file or in environment variables.
