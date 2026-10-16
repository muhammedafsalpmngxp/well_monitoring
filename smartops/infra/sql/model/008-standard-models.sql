-- =============================================================================
-- T-Wise Tenant: the standard datasets and showcase canvases
-- (008-standard-models.sql)
-- -----------------------------------------------------------------------------
-- Creates, for the tenant whose database this is, three datasets on its own
-- tables and three published canvases on them:
--   Well Delivery 360          wells, projects, clusters, lift and completion
--                              types, scope and delivery milestones
--   Well Progress Tracker      progress snapshots and phase progress per well
--   Field Workforce Activity   the tasks field crews log each day
--   Well Delivery Command Center, Construction Progress Pulse and
--   Field Workforce Pulse      canvases on those datasets
-- Each dataset is published, so canvases read the version seeded here until
-- a modeller publishes a new one.
--
-- Requirements: 001 to 007 applied; core.DatabaseConnections has a live row
-- whose database_name is this database (the Tenant API's own connection);
-- the canvases go in the dashboard category Al Tasnim Dashboard, created if missing.
-- Idempotent: a dataset or canvas is created only while none of that name
-- exists, so a second run changes nothing and an edited copy is never
-- overwritten. One batch, no GO, so it can run inside a transaction.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 008-standard-models.sql
-- Reverse with 008-standard-models.down.sql.
-- Generated from the datasets and canvases verified on QA on 2026-09-25.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;

DECLARE @ConnectionId BIGINT, @TenantId BIGINT, @CreatedBy BIGINT = 0, @CategoryId INT, @DatasetId BIGINT;
DECLARE @Aliases TABLE (DatasetKey INT, Alias NVARCHAR(64), SourceId BIGINT);
DECLARE @Datasets TABLE (DatasetKey INT, DatasetId BIGINT);

SELECT TOP 1 @ConnectionId = id, @TenantId = tenant_id
FROM core.DatabaseConnections
WHERE is_deleted = 0 AND database_name = DB_NAME()
ORDER BY id;

SELECT TOP 1 @CategoryId = CategoryId
FROM core.Category
WHERE IsDeleted = 0 AND ControlType = 'dashboard' AND CategoryName = N'Al Tasnim Dashboard'
ORDER BY CategoryId;

IF @ConnectionId IS NULL
BEGIN
    RAISERROR('No live row in core.DatabaseConnections names this database. Add the tenant database connection first.', 16, 1);
    RETURN;
END

IF @CategoryId IS NULL
BEGIN
    INSERT INTO core.Category (CategoryName, Description, IsActive, IsDeleted, CreatedAt, ModifiedAt, CreatedBy, ControlType)
    VALUES (N'Al Tasnim Dashboard', N'Standard Al Tasnim dashboards', 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME(), '0', 'dashboard');
    SET @CategoryId = SCOPE_IDENTITY();
END

-- Well Delivery 360
SET @DatasetId = (SELECT TOP 1 Id FROM model.Dataset WHERE TenantId = @TenantId AND Name = N'Well Delivery 360' AND IsDeleted = 0);
IF @DatasetId IS NULL
BEGIN
    INSERT INTO model.Dataset (TenantId, ConnectionId, Name, Description, Status, CreatedBy, CreatedAt, ModifiedAt, IsDeleted)
    VALUES (@TenantId, @ConnectionId, N'Well Delivery 360',
        N'One row per well milestone record. Wells by cluster, project, lift type and completion, with rig, OHL and commissioning milestones, schedule variance and flowline and OHL scope.',
        'draft', @CreatedBy, SYSUTCDATETIME(), SYSUTCDATETIME(), 0);
    SET @DatasetId = SCOPE_IDENTITY();
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'Well', N'Well', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Well', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'Project', N'Project', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Project', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'Cluster', N'Cluster', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Cluster', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'ProjectCategory', N'Category', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Category', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'LiftType', N'Lift', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Lift', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'WellScope', N'Scope', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Scope', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'CompletionType', N'Completion', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Completion', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'WellDeliveryEvent', N'Milestone', N'none', NULL);
    INSERT INTO @Aliases VALUES (1, N'Milestone', SCOPE_IDENTITY());
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Well'), N'project_key', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Project'), N'project_key', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Project'), N'cluster_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Cluster'), N'cluster_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Project'), N'project_category_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Category'), N'project_category_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Well'), N'lift_type_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Lift'), N'lift_type_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Scope'), N'well_key', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Well'), N'well_key', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Scope'), N'completion_type_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Completion'), N'completion_type_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), N'well_key', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Well'), N'well_key', N'many_to_one', 1, N'user');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), N'Rig Off Month',
        N'{"kind":"fn","fn":"month_start","args":[{"kind":"col","source":"Milestone","column":"Rig_Off_Date"}]}',
        N'MONTH_START(Milestone.Rig_Off_Date)', N'date');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), N'Delivery Stage',
        N'{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"not","args":[{"kind":"fn","fn":"isblank","args":[{"kind":"col","source":"Milestone","column":"Commissioning_Finish_Date"}]}]},{"kind":"text","value":"Commissioned"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"not","args":[{"kind":"fn","fn":"isblank","args":[{"kind":"col","source":"Milestone","column":"Rig_Off_Date"}]}]},{"kind":"text","value":"Hook-up after rig off"},{"kind":"text","value":"Awaiting rig"}]}]}',
        N'IF(NOT(ISBLANK(Milestone.Commissioning_Finish_Date)), ''Commissioned'', IF(NOT(ISBLANK(Milestone.Rig_Off_Date)), ''Hook-up after rig off'', ''Awaiting rig''))', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), N'Rig Off to Commissioning Days',
        N'{"kind":"fn","fn":"datediff","args":[{"kind":"col","source":"Milestone","column":"Commissioning_Finish_Date"},{"kind":"col","source":"Milestone","column":"Rig_Off_Date"},{"kind":"text","value":"days"}]}',
        N'DATEDIFF(Milestone.Commissioning_Finish_Date, Milestone.Rig_Off_Date, ''days'')', N'number');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), N'Schedule Status',
        N'{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"gt","left":{"kind":"col","source":"Milestone","column":"variance_days"},"right":{"kind":"num","value":0}},{"kind":"text","value":"Behind plan"},{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"lt","left":{"kind":"col","source":"Milestone","column":"variance_days"},"right":{"kind":"num","value":0}},{"kind":"text","value":"Ahead of plan"},{"kind":"text","value":"On plan"}]}]}',
        N'IF(Milestone.variance_days > 0, ''Behind plan'', IF(Milestone.variance_days < 0, ''Ahead of plan'', ''On plan''))', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Scope'), N'Flowline Band',
        N'{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"lt","left":{"kind":"col","source":"Scope","column":"fl_length_m"},"right":{"kind":"num","value":1}},{"kind":"text","value":"No flowline"},{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"lt","left":{"kind":"col","source":"Scope","column":"fl_length_m"},"right":{"kind":"num","value":50}},{"kind":"text","value":"Short, under 50 m"},{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"lt","left":{"kind":"col","source":"Scope","column":"fl_length_m"},"right":{"kind":"num","value":200}},{"kind":"text","value":"Medium, 50 to 200 m"},{"kind":"text","value":"Long, 200 m and over"}]}]}]}',
        N'IF(Scope.fl_length_m < 1, ''No flowline'', IF(Scope.fl_length_m < 50, ''Short, under 50 m'', IF(Scope.fl_length_m < 200, ''Medium, 50 to 200 m'', ''Long, 200 m and over'')))', N'text');
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Wells',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Well","column":"well_key"}}',
        N'DISTINCTCOUNT(Well.well_key)', NULL, NULL, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Well'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Wells Rig Off',
        N'{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"Rig_Off_Date"}}',
        N'COUNT(Milestone.Rig_Off_Date)', NULL, N'Milestones', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Wells Commissioned',
        N'{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"Commissioning_Finish_Date"}}',
        N'COUNT(Milestone.Commissioning_Finish_Date)', NULL, N'Milestones', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'OHL Complete',
        N'{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"Ohl_Complete_Date"}}',
        N'COUNT(Milestone.Ohl_Complete_Date)', NULL, N'Milestones', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Locations Finished',
        N'{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"Location_Finish_Date"}}',
        N'COUNT(Milestone.Location_Finish_Date)', NULL, N'Milestones', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Commissioning Rate %',
        N'{"kind":"bin","op":"*","left":{"kind":"bin","op":"/","left":{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"Commissioning_Finish_Date"}},"right":{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"event_id"}}},"right":{"kind":"num","value":100}}',
        N'COUNT(Milestone.Commissioning_Finish_Date) / COUNT(Milestone.event_id) * 100', NULL, N'KPIs', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Rig Off Rate %',
        N'{"kind":"bin","op":"*","left":{"kind":"bin","op":"/","left":{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"Rig_Off_Date"}},"right":{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"event_id"}}},"right":{"kind":"num","value":100}}',
        N'COUNT(Milestone.Rig_Off_Date) / COUNT(Milestone.event_id) * 100', NULL, N'KPIs', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Avg Variance Days',
        N'{"kind":"agg","fn":"avg","arg":{"source":"Milestone","column":"variance_days"}}',
        N'AVG(Milestone.variance_days)', NULL, N'KPIs', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Wells Behind Plan',
        N'{"kind":"agg","fn":"count","arg":{"source":"Milestone","column":"event_id"},"where":{"column":{"source":"Milestone","column":"variance_days"},"op":"gt","value":"0"}}',
        N'COUNT(Milestone.event_id WHERE Milestone.variance_days > 0)', NULL, N'KPIs', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Flowline km',
        N'{"kind":"bin","op":"/","left":{"kind":"agg","fn":"sum","arg":{"source":"Scope","column":"fl_length_m"}},"right":{"kind":"num","value":1000}}',
        N'SUM(Scope.fl_length_m) / 1000', NULL, N'Scope', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Scope'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'OHL km',
        N'{"kind":"bin","op":"/","left":{"kind":"agg","fn":"sum","arg":{"source":"Scope","column":"ohl_length_m"}},"right":{"kind":"num","value":1000}}',
        N'SUM(Scope.ohl_length_m) / 1000', NULL, N'Scope', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Scope'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Avg Flowline m',
        N'{"kind":"agg","fn":"avg","arg":{"source":"Scope","column":"fl_length_m"}}',
        N'AVG(Scope.fl_length_m)', NULL, N'Scope', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Scope'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Milestone Wells',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Milestone","column":"well_key"}}',
        N'DISTINCTCOUNT(Milestone.well_key)', NULL, N'Milestones', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 1 AND Alias = N'Milestone'), 0);

    -- Published as seeded: the parts as the API stores them in PublishedModel (property names are the column names).
    UPDATE model.Dataset SET
        PublishedModel = (SELECT
            JSON_QUERY(ISNULL((SELECT * FROM model.DatasetSource WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Sources,
            JSON_QUERY(ISNULL((SELECT * FROM model.Relationship WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Relationships,
            JSON_QUERY(ISNULL((SELECT * FROM model.Measure WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Measures,
            JSON_QUERY(ISNULL((SELECT * FROM model.CalculatedColumn WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS CalculatedColumns,
            JSON_QUERY(ISNULL((SELECT * FROM model.Transform WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Transforms
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
        PublishedAt = SYSUTCDATETIME(), PublishedBy = @CreatedBy, Status = 'published', ModifiedAt = SYSUTCDATETIME()
    WHERE Id = @DatasetId;
END
INSERT INTO @Datasets VALUES (1, @DatasetId);

-- Well Progress Tracker
SET @DatasetId = (SELECT TOP 1 Id FROM model.Dataset WHERE TenantId = @TenantId AND Name = N'Well Progress Tracker' AND IsDeleted = 0);
IF @DatasetId IS NULL
BEGIN
    INSERT INTO model.Dataset (TenantId, ConnectionId, Name, Description, Status, CreatedBy, CreatedAt, ModifiedAt, IsDeleted)
    VALUES (@TenantId, @ConnectionId, N'Well Progress Tracker',
        N'One row per progress snapshot of a well. Overall progress and the location preparation, engineering, construction and commissioning progress of each well over time, by cluster, project and lift type.',
        'draft', @CreatedBy, SYSUTCDATETIME(), SYSUTCDATETIME(), 0);
    SET @DatasetId = SCOPE_IDENTITY();
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'ProgressSnapshot', N'Snapshot', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Snapshot', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'ProgressDetail', N'Detail', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Detail', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'Well', N'Well', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Well', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'Project', N'Project', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Project', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'Cluster', N'Cluster', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Cluster', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'ProjectCategory', N'Category', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Category', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'LiftType', N'Lift', N'none', NULL);
    INSERT INTO @Aliases VALUES (2, N'Lift', SCOPE_IDENTITY());
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Detail'), N'progress_snapshot_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), N'progress_snapshot_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), N'well_key', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Well'), N'well_key', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Well'), N'project_key', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Project'), N'project_key', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Project'), N'cluster_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Cluster'), N'cluster_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Project'), N'project_category_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Category'), N'project_category_id', N'many_to_one', 1, N'user');
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Well'), N'lift_type_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Lift'), N'lift_type_id', N'many_to_one', 1, N'user');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), N'Snapshot Date',
        N'{"kind":"fn","fn":"to_date","args":[{"kind":"fn","fn":"concat","args":[{"kind":"fn","fn":"left","args":[{"kind":"fn","fn":"concat","args":[{"kind":"col","source":"Snapshot","column":"date_key"},{"kind":"text","value":""}]},{"kind":"num","value":4}]},{"kind":"text","value":"-"},{"kind":"fn","fn":"substring","args":[{"kind":"fn","fn":"concat","args":[{"kind":"col","source":"Snapshot","column":"date_key"},{"kind":"text","value":""}]},{"kind":"num","value":5},{"kind":"num","value":2}]},{"kind":"text","value":"-"},{"kind":"fn","fn":"right","args":[{"kind":"fn","fn":"concat","args":[{"kind":"col","source":"Snapshot","column":"date_key"},{"kind":"text","value":""}]},{"kind":"num","value":2}]}]},{"kind":"text","value":"iso"}]}',
        N'TO_DATE(CONCAT(LEFT(CONCAT(Snapshot.date_key, ''''), 4), ''-'', SUBSTRING(CONCAT(Snapshot.date_key, ''''), 5, 2), ''-'', RIGHT(CONCAT(Snapshot.date_key, ''''), 2)), ''iso'')', N'date');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), N'Progress Band',
        N'{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"gte","left":{"kind":"col","source":"Snapshot","column":"overall_progress"},"right":{"kind":"num","value":0.75}},{"kind":"text","value":"75 to 100%"},{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"gte","left":{"kind":"col","source":"Snapshot","column":"overall_progress"},"right":{"kind":"num","value":0.5}},{"kind":"text","value":"50 to 75%"},{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"gte","left":{"kind":"col","source":"Snapshot","column":"overall_progress"},"right":{"kind":"num","value":0.25}},{"kind":"text","value":"25 to 50%"},{"kind":"text","value":"Under 25%"}]}]}]}',
        N'IF(Snapshot.overall_progress >= 0.75, ''75 to 100%'', IF(Snapshot.overall_progress >= 0.5, ''50 to 75%'', IF(Snapshot.overall_progress >= 0.25, ''25 to 50%'', ''Under 25%'')))', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), N'Needs Attention',
        N'{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"isblank","args":[{"kind":"col","source":"Snapshot","column":"remarks_area_of_attention_issues"}]},{"kind":"text","value":"No"},{"kind":"text","value":"Yes"}]}',
        N'IF(ISBLANK(Snapshot.remarks_area_of_attention_issues), ''No'', ''Yes'')', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), N'Snapshot Month',
        N'{"kind":"fn","fn":"month_start","args":[{"kind":"col","source":"Snapshot","column":"Snapshot Date"}]}',
        N'MONTH_START(Snapshot.[Snapshot Date])', N'date');
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Snapshots',
        N'{"kind":"agg","fn":"count","arg":{"source":"Snapshot","column":"progress_snapshot_id"}}',
        N'COUNT(Snapshot.progress_snapshot_id)', NULL, NULL, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Wells Tracked',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Snapshot","column":"well_key"}}',
        N'DISTINCTCOUNT(Snapshot.well_key)', NULL, NULL, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Overall Progress %',
        N'{"kind":"bin","op":"*","left":{"kind":"agg","fn":"avg","arg":{"source":"Snapshot","column":"overall_progress"}},"right":{"kind":"num","value":100}}',
        N'AVG(Snapshot.overall_progress) * 100', NULL, N'Progress', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Wells Past Halfway',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Snapshot","column":"well_key"},"where":{"column":{"source":"Snapshot","column":"overall_progress"},"op":"gte","value":"0.5"}}',
        N'DISTINCTCOUNT(Snapshot.well_key WHERE Snapshot.overall_progress >= 0.5)', NULL, N'Progress', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Snapshot'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Location Prep %',
        N'{"kind":"bin","op":"*","left":{"kind":"agg","fn":"avg","arg":{"source":"Detail","column":"Overall_Loc_Preparation_10_100_Value"}},"right":{"kind":"num","value":100}}',
        N'AVG(Detail.Overall_Loc_Preparation_10_100_Value) * 100', NULL, N'Phases', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Detail'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Engineering %',
        N'{"kind":"bin","op":"*","left":{"kind":"agg","fn":"avg","arg":{"source":"Detail","column":"Overall_Engg_10_100_Value"}},"right":{"kind":"num","value":100}}',
        N'AVG(Detail.Overall_Engg_10_100_Value) * 100', NULL, N'Phases', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Detail'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Construction %',
        N'{"kind":"bin","op":"*","left":{"kind":"agg","fn":"avg","arg":{"source":"Detail","column":"Overall_Const_10_100_Value"}},"right":{"kind":"num","value":100}}',
        N'AVG(Detail.Overall_Const_10_100_Value) * 100', NULL, N'Phases', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Detail'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Commissioning %',
        N'{"kind":"bin","op":"*","left":{"kind":"agg","fn":"avg","arg":{"source":"Detail","column":"Overall_Comm_Progress_100_Value"}},"right":{"kind":"num","value":100}}',
        N'AVG(Detail.Overall_Comm_Progress_100_Value) * 100', NULL, N'Phases', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 2 AND Alias = N'Detail'), 0);

    -- Published as seeded: the parts as the API stores them in PublishedModel (property names are the column names).
    UPDATE model.Dataset SET
        PublishedModel = (SELECT
            JSON_QUERY(ISNULL((SELECT * FROM model.DatasetSource WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Sources,
            JSON_QUERY(ISNULL((SELECT * FROM model.Relationship WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Relationships,
            JSON_QUERY(ISNULL((SELECT * FROM model.Measure WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Measures,
            JSON_QUERY(ISNULL((SELECT * FROM model.CalculatedColumn WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS CalculatedColumns,
            JSON_QUERY(ISNULL((SELECT * FROM model.Transform WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Transforms
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
        PublishedAt = SYSUTCDATETIME(), PublishedBy = @CreatedBy, Status = 'published', ModifiedAt = SYSUTCDATETIME()
    WHERE Id = @DatasetId;
END
INSERT INTO @Datasets VALUES (2, @DatasetId);

-- Field Workforce Activity
SET @DatasetId = (SELECT TOP 1 Id FROM model.Dataset WHERE TenantId = @TenantId AND Name = N'Field Workforce Activity' AND IsDeleted = 0);
IF @DatasetId IS NULL
BEGIN
    INSERT INTO model.Dataset (TenantId, ConnectionId, Name, Description, Status, CreatedBy, CreatedAt, ModifiedAt, IsDeleted)
    VALUES (@TenantId, @ConnectionId, N'Field Workforce Activity',
        N'One row per task per day, as crews log it in the field. Tasks, hours and quantities by crew member, work front, crew type, month and weekday.',
        'draft', @CreatedBy, SYSUTCDATETIME(), SYSUTCDATETIME(), 0);
    SET @DatasetId = SCOPE_IDENTITY();
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'core', N'TaskDaily', N'Task', N'none', NULL);
    INSERT INTO @Aliases VALUES (3, N'Task', SCOPE_IDENTITY());
    INSERT INTO model.DatasetSource (DatasetId, SourceKind, SchemaName, SourceName, Alias, RlsMode, RlsPlantColumn)
    VALUES (@DatasetId, N'table', N'ref', N'CrewType', N'CrewType', N'none', NULL);
    INSERT INTO @Aliases VALUES (3, N'CrewType', SCOPE_IDENTITY());
    INSERT INTO model.Relationship (DatasetId, FromSourceId, FromColumn, ToSourceId, ToColumn, Cardinality, IsActive, DetectedFrom)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'crew_type_id', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'CrewType'), N'crew_type_id', N'many_to_one', 1, N'user');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Log Month',
        N'{"kind":"fn","fn":"month_start","args":[{"kind":"col","source":"Task","column":"action_on"}]}',
        N'MONTH_START(Task.action_on)', N'date');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Weekday',
        N'{"kind":"fn","fn":"weekday_name","args":[{"kind":"col","source":"Task","column":"action_on"}]}',
        N'WEEKDAY_NAME(Task.action_on)', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Work Front',
        N'{"kind":"fn","fn":"left","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"num","value":4}]}',
        N'LEFT(Task.task_code, 4)', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Crew Member',
        N'{"kind":"fn","fn":"first_word","args":[{"kind":"fn","fn":"replace","args":[{"kind":"fn","fn":"split","args":[{"kind":"col","source":"Task","column":"task_assignee"},{"kind":"text","value":"@"},{"kind":"num","value":1}]},{"kind":"text","value":"."},{"kind":"text","value":" "}]}]}',
        N'FIRST_WORD(REPLACE(SPLIT(Task.task_assignee, ''@'', 1), ''.'', '' ''))', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Logged Hours',
        N'{"kind":"fn","fn":"if","args":[{"kind":"cmp","op":"gt","left":{"kind":"col","source":"Task","column":"data_hours"},"right":{"kind":"num","value":0}},{"kind":"text","value":"Hours logged"},{"kind":"text","value":"No hours"}]}',
        N'IF(Task.data_hours > 0, ''Hours logged'', ''No hours'')', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Discipline',
        N'{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"FLME"}]},{"kind":"text","value":"Flowline mechanical"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"FLCV"}]},{"kind":"text","value":"Flowline civil"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"FLEI"}]},{"kind":"text","value":"Flowline E\u0026I"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"FLC"}]},{"kind":"text","value":"Flowline construction"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"FL"}]},{"kind":"text","value":"Flowline other"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"LC"}]},{"kind":"text","value":"Location civil"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"LOC"}]},{"kind":"text","value":"Location"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"HUP"}]},{"kind":"text","value":"Hook-up"},{"kind":"fn","fn":"if","args":[{"kind":"fn","fn":"starts_with","args":[{"kind":"col","source":"Task","column":"task_code"},{"kind":"text","value":"MS"}]},{"kind":"text","value":"Materials and support"},{"kind":"text","value":"Other"}]}]}]}]}]}]}]}]}]}',
        N'IF(STARTS_WITH(Task.task_code, ''FLME''), ''Flowline mechanical'', IF(STARTS_WITH(Task.task_code, ''FLCV''), ''Flowline civil'', IF(STARTS_WITH(Task.task_code, ''FLEI''), ''Flowline E&I'', IF(STARTS_WITH(Task.task_code, ''FLC''), ''Flowline construction'', IF(STARTS_WITH(Task.task_code, ''FL''), ''Flowline other'', IF(STARTS_WITH(Task.task_code, ''LC''), ''Location civil'', IF(STARTS_WITH(Task.task_code, ''LOC''), ''Location'', IF(STARTS_WITH(Task.task_code, ''HUP''), ''Hook-up'', IF(STARTS_WITH(Task.task_code, ''MS''), ''Materials and support'', ''Other'')))))))))', N'text');
    INSERT INTO model.CalculatedColumn (DatasetId, SourceId, Name, ExpressionAst, ExpressionText, DataType)
    VALUES (@DatasetId, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), N'Weekday No',
        N'{"kind":"fn","fn":"weekday","args":[{"kind":"col","source":"Task","column":"action_on"}]}',
        N'WEEKDAY(Task.action_on)', N'number');
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Tasks Logged',
        N'{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"}}',
        N'COUNT(Task.task_daily_id)', NULL, NULL, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Workforce',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Task","column":"task_assignee"}}',
        N'DISTINCTCOUNT(Task.task_assignee)', NULL, NULL, (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Active Days',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Task","column":"action_on"}}',
        N'DISTINCTCOUNT(Task.action_on)', NULL, N'Activity', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Work Fronts',
        N'{"kind":"agg","fn":"count_distinct","arg":{"source":"Task","column":"task_code"}}',
        N'DISTINCTCOUNT(Task.task_code)', NULL, N'Activity', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Tasks per Day',
        N'{"kind":"bin","op":"/","left":{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"}},"right":{"kind":"agg","fn":"count_distinct","arg":{"source":"Task","column":"action_on"}}}',
        N'COUNT(Task.task_daily_id) / DISTINCTCOUNT(Task.action_on)', NULL, N'Activity', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Hours Logged',
        N'{"kind":"agg","fn":"sum","arg":{"source":"Task","column":"data_hours"}}',
        N'SUM(Task.data_hours)', NULL, N'Output', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Quantity Delivered',
        N'{"kind":"agg","fn":"sum","arg":{"source":"Task","column":"data_qty"}}',
        N'SUM(Task.data_qty)', NULL, N'Output', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Hours per Task',
        N'{"kind":"bin","op":"/","left":{"kind":"agg","fn":"sum","arg":{"source":"Task","column":"data_hours"}},"right":{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"},"where":{"column":{"source":"Task","column":"data_hours"},"op":"gt","value":"0"}}}',
        N'SUM(Task.data_hours) / COUNT(Task.task_daily_id WHERE Task.data_hours > 0)', NULL, N'Output', (SELECT SourceId FROM @Aliases WHERE DatasetKey = 3 AND Alias = N'Task'), 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Tasks, 3-month average',
        N'{"kind":"fn","fn":"moving_avg","args":[{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"}},{"kind":"num","value":3}]}',
        N'MOVING_AVG(COUNT(Task.task_daily_id), 3)', NULL, NULL, NULL, 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Tasks Rank',
        N'{"kind":"fn","fn":"rank","args":[{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"}}]}',
        N'RANK(COUNT(Task.task_daily_id))', NULL, NULL, NULL, 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Output Score',
        N'{"kind":"fn","fn":"threshold","args":[{"kind":"bin","op":"/","left":{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"}},"right":{"kind":"agg","fn":"count_distinct","arg":{"source":"Task","column":"action_on"}}},{"kind":"num","value":70},{"kind":"num","value":90}]}',
        N'THRESHOLD(COUNT(Task.task_daily_id) / DISTINCTCOUNT(Task.action_on), 70, 90)', NULL, NULL, NULL, 0);
    INSERT INTO model.Measure (DatasetId, Name, ExpressionAst, ExpressionText, Format, Folder, HomeSourceId, IsCertified)
    VALUES (@DatasetId, N'Tasks YTD',
        N'{"kind":"fn","fn":"ytd","args":[{"kind":"agg","fn":"count","arg":{"source":"Task","column":"task_daily_id"}}]}',
        N'YTD(COUNT(Task.task_daily_id))', NULL, NULL, NULL, 0);

    -- Published as seeded: the parts as the API stores them in PublishedModel (property names are the column names).
    UPDATE model.Dataset SET
        PublishedModel = (SELECT
            JSON_QUERY(ISNULL((SELECT * FROM model.DatasetSource WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Sources,
            JSON_QUERY(ISNULL((SELECT * FROM model.Relationship WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Relationships,
            JSON_QUERY(ISNULL((SELECT * FROM model.Measure WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Measures,
            JSON_QUERY(ISNULL((SELECT * FROM model.CalculatedColumn WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS CalculatedColumns,
            JSON_QUERY(ISNULL((SELECT * FROM model.Transform WHERE DatasetId = @DatasetId FOR JSON PATH, INCLUDE_NULL_VALUES), '[]')) AS Transforms
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
        PublishedAt = SYSUTCDATETIME(), PublishedBy = @CreatedBy, Status = 'published', ModifiedAt = SYSUTCDATETIME()
    WHERE Id = @DatasetId;
END
INSERT INTO @Datasets VALUES (3, @DatasetId);

-- Canvases
DECLARE @Config NVARCHAR(MAX);

IF NOT EXISTS (SELECT 1 FROM core.Dashboard WHERE DashboardName = N'Well Delivery Command Center' AND IsDeleted = 0)
BEGIN
    SET @Config = N'{"kind":"canvas","layout":{"version":2,"columns":20,"datasetId":__DATASET_1__,"brand":{"colors":["#0B6E99","#12A4B6","#57C4E5","#1D3557","#8ECAE6","#219EBC","#023047","#6FB7C8"],"logo":"/assets/images/al-tasnim-logo.svg"},"size":{"preset":"16:9","width":1280,"height":720},"fields":{"names":{"Cluster.cluster_name":"Cluster","Category.category_name":"Programme","Lift.name":"Artificial lift","Avg Variance Days":"Avg variance (days)"},"hidden":[]},"sheets":[{"name":"Cover","items":[{"id":"item-4frz2eapfrp5","type":"image","title":"Logo","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8},"float":{"x":48,"y":40,"w":200,"h":70}},{"id":"item-k7zq31bigl1b","type":"text","title":"Title","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"transparent","radius":10,"border":false,"shadow":false,"padding":0,"verticalAlign":"top","html":"<h1 style=\"color: #ffffff; font-size: 3em\">Well Delivery Command Center</h1><p style=\"color: #cfe0ff; font-size: 1.3em\">Hook-up delivery of PDO wells across Marmul and Nimr, from rig-off to commissioning.</p>","titleSize":13,"fitText":true},"float":{"x":48,"y":140,"w":720,"h":190}},{"id":"item-r5vptle8tbhe","type":"text","title":"Inside this story","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"transparent","radius":10,"border":false,"shadow":false,"padding":0,"verticalAlign":"top","html":"<p style=\"color: #ffffff\"><b>Inside this story</b></p><ol style=\"color: #cfe0ff\"><li><b style=\"color: #ffffff\">Delivery overview</b>: wells in scope, rigged off and commissioned, month by month</li><li><b style=\"color: #ffffff\">Schedule and scope</b>: clusters, lift types, schedule health and flowline scope</li></ol>","titleSize":13,"fitText":true},"float":{"x":48,"y":340,"w":640,"h":130}},{"id":"item-df83ecfy5txv","type":"tile","title":"Wells in scope","x":1,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Wells"],"format":{"style":"number","decimals":0},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#0b3d5c","subtitle":"Distinct wells in the programme"}},{"id":"item-rjhdcxlhv5wq","type":"tile","title":"Rigged off","x":5,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Wells Rig Off"],"targetValue":200,"warnAt":60,"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"subtitle":"Against 200 planned this cycle"}},{"id":"item-3g8nckryubn8","type":"tile","title":"Commissioned","x":9,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Wells Commissioned"],"compare":"Wells Rig Off","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#12a4b6","subtitle":"Compared with wells rigged off"}}],"page":{"backgroundImage":"/assets/images/showcase/cover-wells.svg","backgroundFit":"cover","spacing":10,"showGrid":false,"theme":"ocean"}},{"name":"Delivery overview","items":[{"id":"item-q0urgutbmemh","type":"image","title":"Logo","x":0,"y":0,"cols":3,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-c7h6mzw7sjqg","type":"text","title":"Header","x":3,"y":0,"cols":17,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#0b3d91","radius":10,"border":false,"shadow":true,"padding":14,"verticalAlign":"middle","html":"<h2 style=\"color: #ffffff; font-size: 26px\">Well Delivery Command Center</h2><p style=\"color: #cfe0ff; font-size: 15px\">PDO hook-up delivery across Marmul and Nimr: how many wells are in scope, rigged off and commissioned, and where each one stands.</p>","titleSize":13,"fitText":false}},{"id":"item-83yeg0bg1z2t","type":"slicer","title":"Cluster","x":0,"y":3,"cols":4,"rows":7,"datasetId":__DATASET_1__,"dimensions":["Cluster.cluster_name"],"measures":[],"slicer":{"kind":"list","values":[],"style":"list","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-6k0o8gnymii5","type":"slicer","title":"Artificial lift","x":0,"y":10,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":["Lift.name"],"measures":[],"slicer":{"kind":"list","values":[],"style":"tiles","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-g93a34h7465x","type":"slicer","title":"Rig-off date","x":0,"y":15,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":["Milestone.Rig_Off_Date"],"measures":[],"slicer":{"kind":"range","values":[],"style":"between","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-18lapfb3y2hq","type":"tile","title":"Wells in scope","x":4,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Wells"],"format":{"style":"number","decimals":0},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#0b3d5c","subtitle":"Distinct wells in the programme"}},{"id":"item-i4s2zsk32ttc","type":"tile","title":"Rigged off","x":8,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Wells Rig Off"],"targetValue":200,"warnAt":60,"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"subtitle":"Against 200 planned this cycle"}},{"id":"item-ent0g3e362bl","type":"tile","title":"Commissioned","x":12,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Wells Commissioned"],"compare":"Wells Rig Off","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#12a4b6","subtitle":"Compared with wells rigged off"}},{"id":"item-1refik1s3hm4","type":"tile","title":"Commissioning rate","x":16,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_1__,"dimensions":[],"measures":["Commissioning Rate %"],"gauge":true,"targetValue":25,"format":{"style":"number","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"subtitle":"Percent of wells, target 25%","valueSize":26}},{"id":"item-e1jaysc8wqnq","type":"chart","title":"Rig-offs by month","x":4,"y":8,"cols":10,"rows":8,"datasetId":__DATASET_1__,"dimensions":["Milestone.Rig Off Month"],"measures":["Wells Rig Off"],"chartType":"area","dataLabels":true,"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"smooth":true,"legend":false,"yTitle":"Wells","subtitle":"When the drilling rig left each well"}},{"id":"item-6udbrnems736","type":"chart","title":"Where each well stands","x":14,"y":8,"cols":6,"rows":8,"datasetId":__DATASET_1__,"dimensions":["Milestone.Delivery Stage"],"measures":["Milestone Wells"],"chartType":"donut","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"subtitle":"Awaiting rig, in hook-up, commissioned"}},{"id":"item-iu6q9t7s614d","type":"text","title":"Reading this page","x":4,"y":16,"cols":16,"rows":4,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":12,"verticalAlign":"top","html":"<p><b>Reading this page</b></p><ul><li>The cards count wells in scope, rigged off and commissioned; the gauge shows the share commissioned.</li><li>Click a month or a stage to filter the other visuals. Press Escape to clear it.</li><li>The three slicers on the left also filter the Schedule and scope sheet.</li></ul>","titleSize":13,"fitText":true}}],"page":{"theme":"ocean","wallpaper":"#e8eef6","spacing":10,"showGrid":false}},{"name":"Schedule and scope","items":[{"id":"item-xl2vg720cxfu","type":"image","title":"Logo","x":0,"y":0,"cols":3,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-ojc3h6gq3yuv","type":"text","title":"Header","x":3,"y":0,"cols":17,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#0b3d91","radius":10,"border":false,"shadow":true,"padding":14,"verticalAlign":"middle","html":"<h2 style=\"color: #ffffff; font-size: 26px\">Schedule and scope</h2><p style=\"color: #cfe0ff; font-size: 15px\">Which clusters and lift types are ahead, where the programme is behind plan, and how much flowline and overhead line each band carries.</p>","titleSize":13,"fitText":false}},{"id":"item-1x3xcsqrfozc","type":"chart","title":"Rig-off and commissioning by cluster","x":0,"y":3,"cols":7,"rows":8,"datasetId":__DATASET_1__,"dimensions":["Cluster.cluster_name"],"measures":["Wells Rig Off","Wells Commissioned"],"chartType":"column","dataLabels":true,"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legendPosition":"top"}},{"id":"item-kk49g6fc1ciu","type":"chart","title":"Wells by artificial lift","x":7,"y":3,"cols":7,"rows":8,"datasetId":__DATASET_1__,"dimensions":["Lift.name"],"measures":["Wells"],"chartType":"bar","dataLabels":true,"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legend":false,"gridlines":false}},{"id":"item-p88crmjpsh2i","type":"chart","title":"Programme mix","x":14,"y":3,"cols":6,"rows":8,"datasetId":__DATASET_1__,"dimensions":["Category.category_name"],"measures":["Wells"],"chartType":"treemap","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"subtitle":"Wells by project category"}},{"id":"item-e2t9zowgpqiw","type":"matrix","title":"Schedule health by cluster and project","x":0,"y":11,"cols":10,"rows":9,"datasetId":__DATASET_1__,"dimensions":["Cluster.cluster_name","Category.category_name"],"measures":["Wells","Wells Rig Off","Wells Behind Plan","Avg Variance Days"],"totals":true,"format":{"style":"number","decimals":1},"rules":[{"field":"Wells Behind Plan","op":"gt","values":["0"],"tone":"bad"},{"field":"Avg Variance Days","op":"lte","values":["0"],"tone":"good"}],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"striped":true,"headerBackground":"#0b3d5c","headerColor":"#ffffff"}},{"id":"item-39o92td2hme5","type":"chart","title":"Flowline and OHL scope, km","x":10,"y":11,"cols":6,"rows":9,"datasetId":__DATASET_1__,"dimensions":["Scope.Flowline Band"],"measures":["Flowline km","OHL km"],"chartType":"column","dataLabels":true,"format":{"style":"number","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legendPosition":"top","subtitle":"By flowline length band"}},{"id":"item-iy7r5w2d71bo","type":"image","title":"Well site","x":16,"y":11,"cols":4,"rows":5,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/showcase/well-site.svg","alt":"A well site with a pump jack and a flowline","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-t9pgz0i8oj3l","type":"text","title":"Note","x":16,"y":16,"cols":4,"rows":4,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":12,"verticalAlign":"top","html":"<p><b>Filtered from the overview</b></p><ul><li>Cluster, lift and rig-off date chosen on Delivery overview apply here too.</li></ul>","titleSize":13,"fitText":true}}],"page":{"theme":"ocean","wallpaper":"#e8eef6","spacing":10,"showGrid":false}}]}}';
    SET @Config = REPLACE(@Config, '__DATASET_1__', (SELECT CAST(DatasetId AS NVARCHAR(20)) FROM @Datasets WHERE DatasetKey = 1));
    INSERT INTO core.Dashboard (DashboardName, CategoryId, Status, Description, ConfigJson, IsActive, IsDeleted, CreatedAt, ModifiedAt,
        CreatedBy, ModifiedBy, PublishedBy, DashboardSeriesId, VersionNo, IsLatestVersion)
    VALUES (N'Well Delivery Command Center', @CategoryId, 'Published', N'Hook-up delivery of PDO wells across Marmul and Nimr: rig-offs, commissioning, schedule health and flowline and OHL scope.', @Config, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME(),
        CAST(@CreatedBy AS VARCHAR(20)), CAST(@CreatedBy AS VARCHAR(20)), CAST(@CreatedBy AS VARCHAR(20)), NEWID(), 0, 1);
END

IF NOT EXISTS (SELECT 1 FROM core.Dashboard WHERE DashboardName = N'Construction Progress Pulse' AND IsDeleted = 0)
BEGIN
    SET @Config = N'{"kind":"canvas","layout":{"version":2,"columns":20,"datasetId":__DATASET_2__,"brand":{"colors":["#2D6A4F","#40916C","#74C69D","#95D5B2","#1B4332","#B7E4C7","#52B788","#081C15"],"logo":"/assets/images/al-tasnim-logo.svg"},"size":{"preset":"16:9","width":1280,"height":720},"fields":{"names":{"Cluster.cluster_name":"Cluster","Category.category_name":"Programme","Lift.name":"Artificial lift","Well.well_code":"Well","Project.project_name":"Project","Snapshot.Progress Band":"Progress band"},"hidden":[]},"sheets":[{"name":"Cover","items":[{"id":"item-y85tvpj345a8","type":"image","title":"Logo","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8},"float":{"x":48,"y":40,"w":200,"h":70}},{"id":"item-hi007c7f6f9n","type":"text","title":"Title","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"transparent","radius":10,"border":false,"shadow":false,"padding":0,"verticalAlign":"top","html":"<h1 style=\"color: #ffffff; font-size: 3em\">Construction Progress Pulse</h1><p style=\"color: #d8f3dc; font-size: 1.3em\">How far each well has come, from location preparation to commissioning.</p>","titleSize":13,"fitText":true},"float":{"x":48,"y":140,"w":720,"h":190}},{"id":"item-u98vwl1pmlz8","type":"text","title":"Inside this story","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"transparent","radius":10,"border":false,"shadow":false,"padding":0,"verticalAlign":"top","html":"<p style=\"color: #ffffff\"><b>Inside this story</b></p><ol style=\"color: #d8f3dc\"><li><b style=\"color: #ffffff\">Progress overview</b>: tracked wells, average progress and how it has moved</li><li><b style=\"color: #ffffff\">Phases and watchlist</b>: phase progress by programme and every well with its band</li></ol>","titleSize":13,"fitText":true},"float":{"x":48,"y":340,"w":640,"h":130}},{"id":"item-2l42e243o2gb","type":"tile","title":"Wells tracked","x":1,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Wells Tracked"],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#1b4332"}},{"id":"item-5p7jxxwa2tl4","type":"tile","title":"Past halfway","x":5,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Wells Past Halfway"],"compare":"Wells Tracked","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#40916c","subtitle":"Wells at 50% or more"}},{"id":"item-u3mtho25791w","type":"tile","title":"Location preparation","x":9,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Location Prep %"],"targetValue":100,"warnAt":50,"format":{"style":"number","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"subtitle":"Average percent complete"}}],"page":{"backgroundImage":"/assets/images/showcase/cover-progress.svg","backgroundFit":"cover","spacing":10,"showGrid":false,"theme":"forest"}},{"name":"Progress overview","items":[{"id":"item-mqgk5760n8e7","type":"image","title":"Logo","x":0,"y":0,"cols":3,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-5eb5ollkyk8e","type":"text","title":"Header","x":3,"y":0,"cols":17,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#1b4332","radius":10,"border":false,"shadow":true,"padding":14,"verticalAlign":"middle","html":"<h2 style=\"color: #ffffff; font-size: 26px\">Construction Progress Pulse</h2><p style=\"color: #d8f3dc; font-size: 15px\">How far each well has come, from location preparation to commissioning, and how progress has moved month by month.</p>","titleSize":13,"fitText":false}},{"id":"item-1wmu7jmacqt1","type":"slicer","title":"Cluster","x":0,"y":3,"cols":4,"rows":7,"datasetId":__DATASET_2__,"dimensions":["Cluster.cluster_name"],"measures":[],"slicer":{"kind":"list","values":[],"style":"list","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-3l8ez6b2q7r2","type":"slicer","title":"Programme","x":0,"y":10,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":["Category.category_name"],"measures":[],"slicer":{"kind":"list","values":[],"style":"tiles","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-yug4i88zjdzn","type":"slicer","title":"Snapshot date","x":0,"y":15,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":["Snapshot.Snapshot Date"],"measures":[],"slicer":{"kind":"range","values":[],"style":"between","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-pgfwj4zxg64c","type":"tile","title":"Wells tracked","x":4,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Wells Tracked"],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#1b4332"}},{"id":"item-j9b4kv52jris","type":"tile","title":"Average progress","x":8,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Overall Progress %"],"gauge":true,"targetValue":100,"format":{"style":"number","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"subtitle":"Percent complete, all wells","valueSize":26}},{"id":"item-vt75yszybo9m","type":"tile","title":"Past halfway","x":12,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Wells Past Halfway"],"compare":"Wells Tracked","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#40916c","subtitle":"Wells at 50% or more"}},{"id":"item-xkmaicsew7v4","type":"tile","title":"Location preparation","x":16,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_2__,"dimensions":[],"measures":["Location Prep %"],"targetValue":100,"warnAt":50,"format":{"style":"number","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"subtitle":"Average percent complete"}},{"id":"item-x8z034eewxjm","type":"chart","title":"Overall progress over time","x":4,"y":8,"cols":10,"rows":8,"datasetId":__DATASET_2__,"dimensions":["Snapshot.Snapshot Month"],"measures":["Overall Progress %"],"chartType":"line","format":{"style":"number","decimals":0},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"smooth":true,"legend":false,"yMin":0,"yMax":100,"subtitle":"Average of the snapshots taken each month"}},{"id":"item-sjxr7y5vluw6","type":"chart","title":"Wells by progress band","x":14,"y":8,"cols":6,"rows":8,"datasetId":__DATASET_2__,"dimensions":["Snapshot.Progress Band"],"measures":["Wells Tracked"],"chartType":"column","dataLabels":true,"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legend":false,"gridlines":false}},{"id":"item-c13r6f2fu5c7","type":"text","title":"Reading this page","x":4,"y":16,"cols":16,"rows":4,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":12,"verticalAlign":"top","html":"<p><b>Reading this page</b></p><ul><li>Average progress is the mean overall progress of the snapshots within the chosen dates.</li><li>Past halfway counts wells at 50% or more; the card compares them with all tracked wells.</li><li>The slicers on the left also filter the Phases and watchlist sheet.</li></ul>","titleSize":13,"fitText":true}}],"page":{"theme":"forest","wallpaper":"#eaf2ec","spacing":10,"showGrid":false}},{"name":"Phases and watchlist","items":[{"id":"item-p5bk3nurtax1","type":"image","title":"Logo","x":0,"y":0,"cols":3,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-inxi9z2qul98","type":"text","title":"Header","x":3,"y":0,"cols":17,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#1b4332","radius":10,"border":false,"shadow":true,"padding":14,"verticalAlign":"middle","html":"<h2 style=\"color: #ffffff; font-size: 26px\">Phases and watchlist</h2><p style=\"color: #d8f3dc; font-size: 15px\">Progress by phase for each programme, the lift mix, and every well with its latest progress band.</p>","titleSize":13,"fitText":false}},{"id":"item-iu7il9h2crwq","type":"chart","title":"Phase progress by programme","x":0,"y":3,"cols":12,"rows":8,"datasetId":__DATASET_2__,"dimensions":["Category.category_name"],"measures":["Location Prep %","Construction %","Commissioning %"],"chartType":"column","dataLabels":true,"format":{"style":"number","decimals":0},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legendPosition":"top","yMax":100,"yTitle":"Percent complete"}},{"id":"item-trqi9ex6xa0t","type":"chart","title":"Wells by artificial lift","x":12,"y":3,"cols":8,"rows":8,"datasetId":__DATASET_2__,"dimensions":["Lift.name"],"measures":["Wells Tracked"],"chartType":"donut","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"subtitle":"Progress is tracked for every lift type"}},{"id":"item-s2l43ov5sd7p","type":"table","title":"Well progress watchlist","x":0,"y":11,"cols":16,"rows":9,"datasetId":__DATASET_2__,"dimensions":["Well.well_code","Project.project_name","Snapshot.Progress Band"],"measures":["Overall Progress %"],"format":{"style":"number","decimals":0},"rules":[{"field":"Overall Progress %","op":"gte","values":["75"],"tone":"good"},{"field":"Overall Progress %","op":"between","values":["25","74.99"],"tone":"warn"},{"field":"Overall Progress %","op":"lt","values":["25"],"tone":"bad"}],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"striped":true,"headerBackground":"#1b4332","headerColor":"#ffffff"}},{"id":"item-xhx2ep33jgq1","type":"image","title":"Construction","x":16,"y":11,"cols":4,"rows":5,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/showcase/construction.svg","alt":"A progress gauge beside a construction site","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-z1khhvhnv7jj","type":"text","title":"Note","x":16,"y":16,"cols":4,"rows":4,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":12,"verticalAlign":"top","html":"<p><b>Filtered from the overview</b></p><ul><li>Cluster, programme and snapshot date chosen on Progress overview apply here too.</li></ul>","titleSize":13,"fitText":true}}],"page":{"theme":"forest","wallpaper":"#eaf2ec","spacing":10,"showGrid":false}}]}}';
    SET @Config = REPLACE(@Config, '__DATASET_2__', (SELECT CAST(DatasetId AS NVARCHAR(20)) FROM @Datasets WHERE DatasetKey = 2));
    INSERT INTO core.Dashboard (DashboardName, CategoryId, Status, Description, ConfigJson, IsActive, IsDeleted, CreatedAt, ModifiedAt,
        CreatedBy, ModifiedBy, PublishedBy, DashboardSeriesId, VersionNo, IsLatestVersion)
    VALUES (N'Construction Progress Pulse', @CategoryId, 'Published', N'How far each well has come: overall progress, location preparation, construction and commissioning, the wells past halfway and the ones that need attention.', @Config, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME(),
        CAST(@CreatedBy AS VARCHAR(20)), CAST(@CreatedBy AS VARCHAR(20)), CAST(@CreatedBy AS VARCHAR(20)), NEWID(), 0, 1);
END

IF NOT EXISTS (SELECT 1 FROM core.Dashboard WHERE DashboardName = N'Field Workforce Pulse' AND IsDeleted = 0)
BEGIN
    SET @Config = N'{"kind":"canvas","layout":{"version":2,"columns":20,"datasetId":__DATASET_3__,"brand":{"colors":["#3A0CA3","#7209B7","#4361EE","#F72585","#4CC9F0","#560BAD","#B5179E","#480CA8"],"logo":"/assets/images/al-tasnim-logo.svg"},"size":{"preset":"16:9","width":1280,"height":720},"fields":{"names":{"CrewType.description":"Crew type","Task.Crew Member":"Crew member","Task.Work Front":"Work front"},"hidden":[]},"sheets":[{"name":"Cover","items":[{"id":"item-llnsirjwtf7v","type":"image","title":"Logo","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8},"float":{"x":48,"y":40,"w":200,"h":70}},{"id":"item-32lk6qnf1nm8","type":"text","title":"Title","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"transparent","radius":10,"border":false,"shadow":false,"padding":0,"verticalAlign":"top","html":"<h1 style=\"color: #ffffff; font-size: 3em\">Field Workforce Pulse</h1><p style=\"color: #e0d7ff; font-size: 1.3em\">What the field crews log each day: tasks, people and active days.</p>","titleSize":13,"fitText":true},"float":{"x":48,"y":140,"w":720,"h":190}},{"id":"item-p7zaaf5lsztc","type":"text","title":"Inside this story","x":0,"y":0,"cols":1,"rows":1,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"transparent","radius":10,"border":false,"shadow":false,"padding":0,"verticalAlign":"top","html":"<p style=\"color: #ffffff\"><b>Inside this story</b></p><ol style=\"color: #e0d7ff\"><li><b style=\"color: #ffffff\">Workforce overview</b>: tasks, crew members and active days by month and discipline</li><li><b style=\"color: #ffffff\">Crews and work fronts</b>: busiest weekdays, most active crew members and where the hours go</li></ol>","titleSize":13,"fitText":true},"float":{"x":48,"y":340,"w":640,"h":130}},{"id":"item-iq1gj01v7x8h","type":"tile","title":"Tasks logged","x":1,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Tasks Logged"],"format":{"style":"compact","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#3a0ca3"}},{"id":"item-a4sjrpwt202g","type":"tile","title":"Crew members","x":5,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Workforce"],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#7209b7","subtitle":"People who logged tasks"}},{"id":"item-3kkb8o7qn0ga","type":"tile","title":"Active days","x":9,"y":14,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Active Days"],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#4361ee"}}],"page":{"backgroundImage":"/assets/images/showcase/cover-crew.svg","backgroundFit":"cover","spacing":10,"showGrid":false,"theme":"royal"}},{"name":"Workforce overview","items":[{"id":"item-fzz0awlfdxo5","type":"image","title":"Logo","x":0,"y":0,"cols":3,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-wui7h4o4xbkm","type":"text","title":"Header","x":3,"y":0,"cols":17,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#3a0ca3","radius":10,"border":false,"shadow":true,"padding":14,"verticalAlign":"middle","html":"<h2 style=\"color: #ffffff; font-size: 26px\">Field Workforce Pulse</h2><p style=\"color: #e0d7ff; font-size: 15px\">What the field crews log each day: tasks, people and active days, by discipline and month.</p>","titleSize":13,"fitText":false}},{"id":"item-zx6gtnvfb2rx","type":"slicer","title":"Discipline","x":0,"y":3,"cols":4,"rows":7,"datasetId":__DATASET_3__,"dimensions":["Task.Discipline"],"measures":[],"slicer":{"kind":"list","values":[],"style":"tiles","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-ggutifqmth9h","type":"slicer","title":"Crew type","x":0,"y":10,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":["CrewType.description"],"measures":[],"slicer":{"kind":"list","values":[],"style":"list","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-95s97f94a5ba","type":"slicer","title":"Log date","x":0,"y":15,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":["Task.action_on"],"measures":[],"slicer":{"kind":"range","values":[],"style":"between","sync":"all"},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-shmt05gdman8","type":"tile","title":"Tasks logged","x":4,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Tasks Logged"],"format":{"style":"compact","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#3a0ca3"}},{"id":"item-jts2x9swrney","type":"tile","title":"Crew members","x":8,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Workforce"],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#7209b7","subtitle":"People who logged tasks"}},{"id":"item-31jfn0m24hxa","type":"tile","title":"Active days","x":12,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Active Days"],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#4361ee"}},{"id":"item-0yjtlhuj6s3i","type":"tile","title":"Tasks per active day","x":16,"y":3,"cols":4,"rows":5,"datasetId":__DATASET_3__,"dimensions":[],"measures":["Tasks per Day"],"format":{"style":"number","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"valueSize":26,"valueColor":"#f72585"}},{"id":"item-iimz5v4qtxo6","type":"chart","title":"Tasks by month and 3-month average","x":4,"y":8,"cols":10,"rows":8,"datasetId":__DATASET_3__,"dimensions":["Task.Log Month"],"measures":["Tasks Logged","Tasks, 3-month average"],"chartType":"line","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legendPosition":"top","subtitle":"The average line is a MOVING_AVG measure"}},{"id":"item-ozoovluxxz0m","type":"chart","title":"Tasks by discipline","x":14,"y":8,"cols":6,"rows":8,"datasetId":__DATASET_3__,"dimensions":["Task.Discipline","Task.Crew Member"],"measures":["Tasks Logged"],"chartType":"donut","style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"subtitle":"Turn on Drill down, then pick a slice to see its crew members"}},{"id":"item-gsituvkognp8","type":"text","title":"Reading this page","x":4,"y":16,"cols":16,"rows":4,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":12,"verticalAlign":"top","html":"<p><b>Reading this page</b></p><ul><li>Tasks logged each month, with their 3-month moving average to smooth out busy and quiet months.</li><li>Tasks per active day divides tasks by the days on which anything was logged.</li><li>The slicers on the left also filter the Crews and work fronts sheet.</li></ul>","titleSize":13,"fitText":true}}],"page":{"theme":"royal","wallpaper":"#eeecf7","spacing":10,"showGrid":false}},{"name":"Crews and work fronts","items":[{"id":"item-n5kiwa3pvisy","type":"image","title":"Logo","x":0,"y":0,"cols":3,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/al-tasnim-logo.svg","alt":"Al Tasnim","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-11nuccu86xts","type":"text","title":"Header","x":3,"y":0,"cols":17,"rows":3,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#3a0ca3","radius":10,"border":false,"shadow":true,"padding":14,"verticalAlign":"middle","html":"<h2 style=\"color: #ffffff; font-size: 26px\">Crews and work fronts</h2><p style=\"color: #e0d7ff; font-size: 15px\">Which weekdays are busiest, who logs the most, and where the hours go.</p>","titleSize":13,"fitText":false}},{"id":"item-wiy0rar8r7hf","type":"chart","title":"Tasks by weekday","x":0,"y":3,"cols":7,"rows":8,"datasetId":__DATASET_3__,"dimensions":["Task.Weekday"],"measures":["Tasks Logged"],"chartType":"column","dataLabels":true,"format":{"style":"compact","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legend":false,"gridlines":false,"subtitle":"Monday to Sunday, sorted by Weekday No; Friday is the Omani weekend"},"sortBy":"Task.Weekday No","sortOrder":"axis_asc"},{"id":"item-fmd8838vzlnw","type":"chart","title":"Most active crew members","x":7,"y":3,"cols":7,"rows":8,"datasetId":__DATASET_3__,"dimensions":["Task.Crew Member"],"measures":["Tasks Logged"],"chartType":"bar","format":{"style":"compact","decimals":1},"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"legend":false}},{"id":"item-ilr0gv6epeb4","type":"chart","title":"Crew members by discipline","x":14,"y":3,"cols":6,"rows":8,"datasetId":__DATASET_3__,"dimensions":["Task.Discipline"],"measures":["Workforce"],"chartType":"treemap","style":{"radius":10,"border":false,"shadow":true,"titleSize":13}},{"id":"item-4n5l2l26ky8w","type":"matrix","title":"Discipline and crew member","x":0,"y":11,"cols":10,"rows":9,"datasetId":__DATASET_3__,"dimensions":["Task.Discipline","Task.Crew Member"],"measures":["Tasks Logged","Active Days","Tasks per Day"],"totals":true,"format":{"style":"number","decimals":1},"rules":[{"field":"Tasks per Day","op":"gte","values":["20"],"tone":"good"}],"style":{"radius":10,"border":false,"shadow":true,"titleSize":13,"striped":true,"headerBackground":"#3a0ca3","headerColor":"#ffffff","dataBars":["Tasks Logged"],"heatmap":["Tasks per Day"],"barColor":"#7209b7","heatColor":"#4361ee"}},{"id":"item-8n12olnit2ar","type":"chart","title":"Busiest work fronts","x":10,"y":11,"cols":6,"rows":9,"datasetId":__DATASET_3__,"dimensions":["Task.Work Front"],"measures":["Tasks Logged"],"chartType":"bar","style":{"legend":false,"gridlines":false,"subtitle":"Top 10 by tasks logged, a Top N filter","radius":10,"border":false,"shadow":true,"titleSize":13},"tooltips":["Workforce","Active Days"],"interaction":"highlight","filters":[{"field":"Task.Work Front","kind":"text","mode":"top","values":[],"top":{"direction":"top","count":10,"measure":"Tasks Logged"}}]},{"id":"item-7i4rfjs16w57","type":"image","title":"Field crew","x":16,"y":11,"cols":4,"rows":5,"datasetId":null,"dimensions":[],"measures":[],"imageUrl":"/assets/images/showcase/crew.svg","alt":"A field crew hard hat and a daily task list","style":{"showTitle":false,"fit":"contain","background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":8}},{"id":"item-o8z9mo677zlp","type":"text","title":"Note","x":16,"y":16,"cols":4,"rows":4,"datasetId":null,"dimensions":[],"measures":[],"text":"","style":{"showTitle":false,"background":"#ffffff","radius":10,"border":false,"shadow":true,"padding":12,"verticalAlign":"top","html":"<p><b>Filtered from the overview</b></p><ul><li>Discipline, crew type and log date chosen on Workforce overview apply here too.</li></ul>","titleSize":13,"fitText":true}}],"page":{"theme":"royal","wallpaper":"#eeecf7","spacing":10,"showGrid":false}}]}}';
    SET @Config = REPLACE(@Config, '__DATASET_3__', (SELECT CAST(DatasetId AS NVARCHAR(20)) FROM @Datasets WHERE DatasetKey = 3));
    INSERT INTO core.Dashboard (DashboardName, CategoryId, Status, Description, ConfigJson, IsActive, IsDeleted, CreatedAt, ModifiedAt,
        CreatedBy, ModifiedBy, PublishedBy, DashboardSeriesId, VersionNo, IsLatestVersion)
    VALUES (N'Field Workforce Pulse', @CategoryId, 'Published', N'What the field crews log each day: tasks, people and active days by discipline, month, weekday and crew member.', @Config, 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME(),
        CAST(@CreatedBy AS VARCHAR(20)), CAST(@CreatedBy AS VARCHAR(20)), CAST(@CreatedBy AS VARCHAR(20)), NEWID(), 0, 1);
END

SELECT d.Name AS dataset, d.Id AS dataset_id, d.Status AS status FROM model.Dataset d JOIN @Datasets s ON s.DatasetId = d.Id;
