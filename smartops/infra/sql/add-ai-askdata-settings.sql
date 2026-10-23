-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — Ask Data settings on [core].[AiSettings] (add-ai-askdata-settings.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- What Ask Data (the Ask your data chatbot and an agent's Ask Data steps) may read and its limits, per tenant,
-- edited under AI Settings → Ask Data & Features (admins only). The agent runtime keeps no list of its own: the Tenant API
-- sends these with every Ask Data run.
--
--   askdata_allowed_schemas   JSON array of the schemas Ask Data may read, e.g. ["well","dbo"].
--                             NULL or [] = not set up: Ask Data refuses until an admin chooses them.
--   askdata_excluded_tables   JSON array: "schema.table" (that table) or "table" (that name in every schema)
--   askdata_included_tables   added by add-agentic-features.sql: the tables Ask Data may read ("schema.table"). Once
--                             an admin saves that list, it replaces the allowed schemas and hidden tables above.
--   askdata_excluded_columns  JSON array: "schema.table.column", "table.column" or "column" (in every table)
--   askdata_max_rows          rows a query may return (an agent can lower it, never raise it)
--   askdata_query_timeout     seconds a query may run
--   askdata_max_queries       queries one question may run (deep mode)
--   askdata_sql_retries       times a failed query is rewritten
--   askdata_verify_retries    times a rejected answer is retried (deep mode)
--   askdata_history_turns     earlier questions and answers the chatbot remembers
--   askdata_org_name          the organisation the prompts speak for ({{ORG_NAME}} in AI Settings → AI Prompts)
--   askdata_export_prefix     start of exported file names
--   askdata_chat_mode         deep | normal: how the Ask your data chatbot (side panel) answers. Agents choose their
--                             own mode per step and are not affected.
--
-- Existing settings rows get the values the agent runtime used before this script (its built-in defaults for the
-- AlTasnimBI database), so nothing changes for them until an admin edits them.
--
-- Requires add-ai-settings.sql. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-askdata-settings.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF COL_LENGTH('core.AiSettings', 'askdata_allowed_schemas') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_allowed_schemas nvarchar(max) NULL;
IF COL_LENGTH('core.AiSettings', 'askdata_excluded_tables') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_excluded_tables nvarchar(max) NULL;
IF COL_LENGTH('core.AiSettings', 'askdata_excluded_columns') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_excluded_columns nvarchar(max) NULL;
IF COL_LENGTH('core.AiSettings', 'askdata_max_rows') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_max_rows int NOT NULL CONSTRAINT DF_core_AiSettings_askdata_max_rows DEFAULT 500;
IF COL_LENGTH('core.AiSettings', 'askdata_query_timeout') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_query_timeout int NOT NULL CONSTRAINT DF_core_AiSettings_askdata_timeout DEFAULT 60;
IF COL_LENGTH('core.AiSettings', 'askdata_max_queries') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_max_queries int NOT NULL CONSTRAINT DF_core_AiSettings_askdata_max_queries DEFAULT 3;
IF COL_LENGTH('core.AiSettings', 'askdata_sql_retries') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_sql_retries int NOT NULL CONSTRAINT DF_core_AiSettings_askdata_sql_retries DEFAULT 2;
IF COL_LENGTH('core.AiSettings', 'askdata_verify_retries') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_verify_retries int NOT NULL CONSTRAINT DF_core_AiSettings_askdata_verify_retries DEFAULT 1;
IF COL_LENGTH('core.AiSettings', 'askdata_history_turns') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_history_turns int NOT NULL CONSTRAINT DF_core_AiSettings_askdata_history DEFAULT 3;
IF COL_LENGTH('core.AiSettings', 'askdata_org_name') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_org_name nvarchar(200) NULL;
IF COL_LENGTH('core.AiSettings', 'askdata_export_prefix') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_export_prefix nvarchar(40) NULL;
IF COL_LENGTH('core.AiSettings', 'askdata_chat_mode') IS NULL
    ALTER TABLE core.AiSettings ADD askdata_chat_mode nvarchar(10) NOT NULL
        CONSTRAINT DF_core_AiSettings_askdata_chat_mode DEFAULT 'deep'
        CONSTRAINT CK_core_AiSettings_askdata_chat_mode CHECK (askdata_chat_mode IN ('deep', 'normal'));

-- The values the runtime used before (rows not set up yet only). Dynamic SQL: the columns above are new in this batch.
DECLARE @tables nvarchar(max) = N'["well.well_details","dbo.sysdiagrams","dbo.plant_description","ref.project_type",'
    + N'"ref.well_location","wbs.Plant_master","wbs.WBS_master","wbs.activity_master","dbo.activity_task_plan",'
    + N'"dbo.activity_taskplan_job_progress","dbo.ActivityCodesNorms","dbo.activity_master_mapping","well.wmr_conversion",'
    + N'"dbo.task_daily_combined","dbo.task_daily_project"]';
EXEC sp_executesql N'
UPDATE core.AiSettings SET
    askdata_allowed_schemas  = N''["well","project","ref","bridge","dbo"]'',
    askdata_excluded_tables  = @tables,
    askdata_excluded_columns = N''["well.well_master.location_dd"]'',
    askdata_org_name         = N''Al-Tasnim'',
    askdata_export_prefix    = N''ask-data''
WHERE askdata_allowed_schemas IS NULL;', N'@tables nvarchar(max)', @tables = @tables;

DECLARE @configured int;
EXEC sp_executesql N'SELECT @n = COUNT(*) FROM core.AiSettings WHERE askdata_allowed_schemas IS NOT NULL', N'@n int OUTPUT', @n = @configured OUTPUT;
PRINT CONCAT('core.AiSettings: Ask Data set up for ', @configured, ' tenant row(s).');
