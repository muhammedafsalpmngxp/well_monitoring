-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — Agentic Features: Slippage, Daily Report, Data Anomaly (add-agentic-features.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Agentic AI → Agentic Features. The agent runtime keeps nothing of a tenant's: everything below is sent with each
-- request by the Tenant API.
--
--   core.AiSettings.<feature>_settings_json   each feature's settings and the tables it may read
--                                             (AI Settings → Ask Data & Features → the feature). NULL = the defaults.
--   core.AiFeatureQuery                       the verified SQL of Slippage and Daily Report (one row per query).
--                                             seed_hash = the seed text it was copied from (NULL once edited), so a
--                                             newer seed replaces only queries nobody changed.
--   core.AnomalyRule                          Data Anomaly rules in plain English (declared and discovered)
--   core.AnomalyProbe                         the SQL the AI compiled for each rule (summary + detail) and its checks
--   core.AnomalyRun / core.AnomalyRunReport   detection runs: score, findings, AI summary, Word / Excel reports
--   core.AnomalyProposal                      rules proposed by Discover, until an admin accepts or rejects them
--   core.AiFeatureJob                         long operations (compile, run, discover): progress, result, one at a
--                                             time per tenant and feature (filtered unique index)
--
-- Prompts are core.AiPrompt rows (AI Settings → AI Prompts), added by the Tenant API from its seed like every prompt.
-- Rules and queries are seeded by the Tenant API the first time a tenant opens the feature.
--
-- Requires add-ai-settings.sql. Idempotent: safe to run more than once.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-agentic-features.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

-- ── Settings per feature ─────────────────────────────────────────────────────
IF COL_LENGTH('core.AiSettings', 'slippage_settings_json') IS NULL
    ALTER TABLE core.AiSettings ADD slippage_settings_json nvarchar(max) NULL;
IF COL_LENGTH('core.AiSettings', 'dailyreport_settings_json') IS NULL
    ALTER TABLE core.AiSettings ADD dailyreport_settings_json nvarchar(max) NULL;
IF COL_LENGTH('core.AiSettings', 'anomaly_settings_json') IS NULL
    ALTER TABLE core.AiSettings ADD anomaly_settings_json nvarchar(max) NULL;
IF COL_LENGTH('core.AiSettings', 'crew_settings_json') IS NULL
    ALTER TABLE core.AiSettings ADD crew_settings_json nvarchar(max) NULL;

-- ── Verified SQL of Slippage and Daily Report ────────────────────────────────
IF OBJECT_ID('core.AiFeatureQuery', 'U') IS NULL
    CREATE TABLE core.AiFeatureQuery (
        id           bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiFeatureQuery PRIMARY KEY,
        tenant_id    bigint         NOT NULL,
        feature      nvarchar(40)   NOT NULL,
        query_key    nvarchar(80)   NOT NULL,
        label        nvarchar(200)  NOT NULL,
        description  nvarchar(1000) NULL,
        sql_text     nvarchar(max)  NOT NULL,
        params_json  nvarchar(1000) NOT NULL CONSTRAINT DF_core_AiFeatureQuery_params DEFAULT N'[]',
        columns_json nvarchar(max)  NOT NULL CONSTRAINT DF_core_AiFeatureQuery_columns DEFAULT N'[]',
        seed_hash    char(64)       NULL,
        modified_by  nvarchar(200)  NOT NULL,
        modified_at  datetime2      NOT NULL CONSTRAINT DF_core_AiFeatureQuery_modified DEFAULT SYSUTCDATETIME(),
        row_ver      rowversion     NOT NULL,
        CONSTRAINT UQ_core_AiFeatureQuery_key UNIQUE (tenant_id, feature, query_key)
    );

-- ── Data Anomaly ─────────────────────────────────────────────────────────────
IF OBJECT_ID('core.AnomalyRule', 'U') IS NULL
    CREATE TABLE core.AnomalyRule (
        id              bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyRule PRIMARY KEY,
        tenant_id       bigint         NOT NULL,
        rule_id         nvarchar(80)   NOT NULL,
        title           nvarchar(400)  NOT NULL,
        category        nvarchar(100)  NULL,
        severity        nvarchar(20)   NOT NULL,
        status          nvarchar(20)   NOT NULL,       -- active | probation | draft | disabled | rejected
        source          nvarchar(20)   NOT NULL,       -- declared | discovered
        definition_json nvarchar(max)  NOT NULL,       -- the whole rule (prose, method, parameters, tags…)
        seed_hash       char(64)       NULL,
        created_by      nvarchar(200)  NOT NULL,
        created_at      datetime2      NOT NULL CONSTRAINT DF_core_AnomalyRule_created DEFAULT SYSUTCDATETIME(),
        modified_by     nvarchar(200)  NOT NULL,
        modified_at     datetime2      NOT NULL CONSTRAINT DF_core_AnomalyRule_modified DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_AnomalyRule_rule UNIQUE (tenant_id, rule_id),
        CONSTRAINT CK_core_AnomalyRule_status CHECK (status IN ('active', 'probation', 'draft', 'disabled', 'rejected')),
        CONSTRAINT CK_core_AnomalyRule_severity CHECK (severity IN ('critical', 'high', 'medium', 'low'))
    );

IF OBJECT_ID('core.AnomalyProbe', 'U') IS NULL
    CREATE TABLE core.AnomalyProbe (
        id           bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyProbe PRIMARY KEY,
        tenant_id    bigint         NOT NULL,
        probe_id     nvarchar(200)  NOT NULL,          -- the rule id, or rule id + family member
        rule_id      nvarchar(80)   NOT NULL,
        status       nvarchar(20)   NOT NULL,          -- active | failed | not_applicable
        probe_json   nvarchar(max)  NOT NULL,          -- summary / detail SQL, fingerprints, reviewer notes…
        compiled_at  datetime2      NOT NULL,
        CONSTRAINT UQ_core_AnomalyProbe_probe UNIQUE (tenant_id, probe_id)
    );

IF OBJECT_ID('core.AnomalyRun', 'U') IS NULL
    CREATE TABLE core.AnomalyRun (
        id                   bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyRun PRIMARY KEY,
        tenant_id            bigint         NOT NULL,
        run_id               nvarchar(40)   NOT NULL,
        status               nvarchar(20)   NOT NULL,  -- succeeded | failed
        database_name        nvarchar(200)  NULL,
        started_at           datetime2      NOT NULL,
        finished_at          datetime2      NULL,
        score                decimal(6, 2)  NULL,
        probes_run           int            NULL,
        records_examined     bigint         NULL,
        records_flagged      bigint         NULL,
        rule_set_fingerprint nvarchar(40)   NULL,
        result_json          nvarchar(max)  NULL,       -- totals, ranked findings, coverage gaps, AI summary…
        error                nvarchar(4000) NULL,
        started_by           nvarchar(200)  NOT NULL,
        CONSTRAINT UQ_core_AnomalyRun_run UNIQUE (tenant_id, run_id)
    );

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AnomalyRun_started' AND object_id = OBJECT_ID('core.AnomalyRun'))
    CREATE INDEX IX_core_AnomalyRun_started ON core.AnomalyRun (tenant_id, started_at DESC);

IF OBJECT_ID('core.AnomalyRunReport', 'U') IS NULL
    CREATE TABLE core.AnomalyRunReport (
        id          bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyRunReport PRIMARY KEY,
        tenant_id   bigint          NOT NULL,
        run_id      nvarchar(40)    NOT NULL,
        format      nvarchar(10)    NOT NULL,          -- xlsx | docx
        file_name   nvarchar(200)   NOT NULL,
        content     varbinary(max)  NOT NULL,
        size_bytes  bigint          NOT NULL,
        created_at  datetime2       NOT NULL CONSTRAINT DF_core_AnomalyRunReport_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_AnomalyRunReport UNIQUE (tenant_id, run_id, format),
        CONSTRAINT CK_core_AnomalyRunReport_format CHECK (format IN ('xlsx', 'docx'))
    );

IF OBJECT_ID('core.AnomalyProposal', 'U') IS NULL
    CREATE TABLE core.AnomalyProposal (
        id             bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyProposal PRIMARY KEY,
        tenant_id      bigint         NOT NULL,
        proposal_hash  nvarchar(64)   NOT NULL,
        status         nvarchar(20)   NOT NULL,        -- pending | dropped | accepted | rejected
        title          nvarchar(400)  NOT NULL,
        proposal_json  nvarchar(max)  NOT NULL,
        rule_id        nvarchar(80)   NULL,            -- the rule it became when accepted
        reason         nvarchar(1000) NULL,
        decided_by     nvarchar(200)  NULL,
        decided_at     datetime2      NULL,
        created_at     datetime2      NOT NULL CONSTRAINT DF_core_AnomalyProposal_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_AnomalyProposal_hash UNIQUE (tenant_id, proposal_hash),
        CONSTRAINT CK_core_AnomalyProposal_status CHECK (status IN ('pending', 'dropped', 'accepted', 'rejected'))
    );

-- ── Long operations ──────────────────────────────────────────────────────────
IF OBJECT_ID('core.AiFeatureJob', 'U') IS NULL
    CREATE TABLE core.AiFeatureJob (
        id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiFeatureJob PRIMARY KEY,
        tenant_id     bigint         NOT NULL,
        feature       nvarchar(40)   NOT NULL,
        kind          nvarchar(40)   NOT NULL,         -- compile | run | discover
        status        nvarchar(20)   NOT NULL,         -- queued | running | succeeded | failed | cancelled
        request_json  nvarchar(max)  NULL,             -- options (rule ids, force, formats…)
        progress_json nvarchar(max)  NULL,             -- latest {stage, done, total, label}
        result_json   nvarchar(max)  NULL,             -- short outcome (ids, counts, run id)
        error         nvarchar(4000) NULL,
        requested_by  nvarchar(200)  NOT NULL,
        created_at    datetime2      NOT NULL CONSTRAINT DF_core_AiFeatureJob_created DEFAULT SYSUTCDATETIME(),
        started_at    datetime2      NULL,
        finished_at   datetime2      NULL,
        heartbeat_at  datetime2      NULL,
        CONSTRAINT CK_core_AiFeatureJob_status CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
    );

-- At most one queued or running job per tenant and feature, guaranteed by the database.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_AiFeatureJob_active' AND object_id = OBJECT_ID('core.AiFeatureJob'))
    CREATE UNIQUE INDEX UX_core_AiFeatureJob_active ON core.AiFeatureJob (tenant_id, feature)
        WHERE status IN ('queued', 'running');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiFeatureJob_recent' AND object_id = OBJECT_ID('core.AiFeatureJob'))
    CREATE INDEX IX_core_AiFeatureJob_recent ON core.AiFeatureJob (tenant_id, feature, created_at DESC);

PRINT 'Agentic Features tables are in place.';
