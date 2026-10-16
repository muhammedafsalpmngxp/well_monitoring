/* ============================================================================
   core.DaxModels -- saved DAX models listed on Settings -> Dax Model.

   A model is a named DAX measure tied to the table or view it was written for:
   how it is calculated (Column or Row), the operation and columns picked, and
   the expression itself.

   Idempotent: safe to re-run. Sample rows are inserted only while the table
   is empty, so real models are never duplicated or overwritten.
   ============================================================================ */
IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO
IF OBJECT_ID(N'core.DaxModels', N'U') IS NULL
CREATE TABLE core.DaxModels (
    id             bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DaxModels PRIMARY KEY,
    name           nvarchar(128)  NOT NULL,
    source_type    nvarchar(10)   NOT NULL CONSTRAINT CK_core_DaxModels_source_type CHECK (source_type IN (N'Table', N'View')),
    data_source    nvarchar(256)  NOT NULL,
    calculated_by  nvarchar(10)   NOT NULL CONSTRAINT CK_core_DaxModels_calculated_by CHECK (calculated_by IN (N'Column', N'Row')),
    operation      nvarchar(64)   NULL,
    columns_json   nvarchar(max)  NULL,
    expression     nvarchar(4000) NOT NULL,
    status         nvarchar(10)   NOT NULL CONSTRAINT DF_core_DaxModels_status DEFAULT N'Active'
                                  CONSTRAINT CK_core_DaxModels_status CHECK (status IN (N'Active', N'Draft')),
    is_deleted     bit            NOT NULL CONSTRAINT DF_core_DaxModels_is_deleted DEFAULT 0,
    created_at     datetime2(7)   NOT NULL CONSTRAINT DF_core_DaxModels_created_at DEFAULT SYSUTCDATETIME(),
    modified_at    datetime2(7)   NOT NULL CONSTRAINT DF_core_DaxModels_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_DaxModels_created_at')
    CREATE INDEX IX_core_DaxModels_created_at ON core.DaxModels (created_at DESC) WHERE is_deleted = 0;
GO

/* Sample models on real QA sources. */
IF NOT EXISTS (SELECT 1 FROM core.DaxModels)
INSERT INTO core.DaxModels (name, source_type, data_source, calculated_by, operation, columns_json, expression, status, created_at) VALUES
 (N'Weekly Periods',             N'View',  N'N_FLAF_Action_Delay_Trend',              N'Column', N'COUNT',         N'["Period"]',                               N'SUM(IF(LEFT([Period], 1) = "W", 1, 0))',            N'Active', DATEADD(DAY, -2,  SYSUTCDATETIME())),
 (N'Total Periods',              N'View',  N'N_FLAF_Action_Delay_Trend',              N'Column', N'COUNTROWS',     N'[]',                                       N'COUNTROWS()',                                       N'Active', DATEADD(DAY, -3,  SYSUTCDATETIME())),
 (N'Completion Total',           N'View',  N'N_Percentage_of_Completion___Due_Wells', N'Column', N'SUM',           N'["Value"]',                                N'SUM([Value])',                                      N'Active', DATEADD(DAY, -5,  SYSUTCDATETIME())),
 (N'Completion Average',         N'View',  N'N_Percentage_of_Completion___Due_Wells', N'Column', N'AVERAGE',       N'["Value"]',                                N'ROUND(AVERAGE([Value]), 2)',                        N'Active', DATEADD(DAY, -6,  SYSUTCDATETIME())),
 (N'Completion Band',            N'View',  N'N_Percentage_of_Completion___Due_Wells', N'Row',    N'SWITCH',        N'["Value"]',                                N'SWITCH(TRUE(), [Value] >= 90, 3, [Value] >= 70, 2, 1)', N'Draft',  DATEADD(DAY, -9,  SYSUTCDATETIME())),
 (N'Incomplete Wells',           N'View',  N'S_Incomplete_Due_Wells___Trend',         N'Column', N'COUNT',         N'["Period"]',                               N'COUNT([Period])',                                   N'Active', DATEADD(DAY, -12, SYSUTCDATETIME())),
 (N'Average Progress',           N'Table', N'dbo.activity_task_plan',                 N'Column', N'AVERAGE',       N'["progress_percent"]',                     N'ROUND(AVERAGE([progress_percent]), 2)',             N'Active', DATEADD(DAY, -15, SYSUTCDATETIME())),
 (N'Wells Planned',              N'Table', N'dbo.activity_task_plan',                 N'Column', N'DISTINCTCOUNT', N'["well_id"]',                              N'DISTINCTCOUNT([well_id])',                          N'Active', DATEADD(DAY, -18, SYSUTCDATETIME())),
 (N'Crews Assigned',             N'Table', N'dbo.activity_task_plan',                 N'Column', N'DISTINCTCOUNT', N'["crew_id"]',                              N'DISTINCTCOUNT([crew_id])',                          N'Active', DATEADD(DAY, -21, SYSUTCDATETIME())),
 (N'Task Duration Days',         N'Table', N'dbo.activity_task_plan',                 N'Row',    N'DATEDIFF',      N'["actual_start_date","actual_end_date"]',  N'DATEDIFF([actual_start_date], [actual_end_date], "DAY")', N'Active', DATEADD(DAY, -25, SYSUTCDATETIME())),
 (N'Late Finishes',              N'Table', N'dbo.activity_task_plan',                 N'Column', N'IF',            N'["actual_end_date","target_end_date"]',    N'SUM(IF([actual_end_date] > [target_end_date], 1, 0))', N'Active', DATEADD(DAY, -32, SYSUTCDATETIME())),
 (N'Completed Tasks Share',      N'Table', N'dbo.activity_task_plan',                 N'Column', N'PERCENTAGE',    N'["progress_percent"]',                     N'PERCENTAGE(SUM(IF([progress_percent] >= 100, 1, 0)), COUNTROWS())', N'Draft', DATEADD(DAY, -40, SYSUTCDATETIME()));
GO
