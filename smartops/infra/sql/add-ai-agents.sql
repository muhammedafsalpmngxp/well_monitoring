-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI agents (add-ai-agents.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds [core].[AiAgents]: agents built on Agentic AI → Create New Agent (role, goal, steps, tools,
-- inputs), and [core].[AiAgentRuns]: every Test Agent run with each step's answer. The agent
-- runtime (services/python/agent_runtime) runs them; the steps' tools are twise-agentic agents.
-- Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-agents.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiAgents', 'U') IS NULL
CREATE TABLE core.AiAgents (
    id             bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgents PRIMARY KEY,
    tenant_id      bigint          NOT NULL,
    name           nvarchar(200)   NOT NULL,
    role           nvarchar(200)   NULL,
    description    nvarchar(1000)  NULL,
    system_prompt  nvarchar(max)   NULL,
    goal           nvarchar(1000)  NULL,
    steps_json     nvarchar(max)   NOT NULL,   -- [{text, tool?: {agent, action}}], run in order
    tools_json     nvarchar(max)   NOT NULL,   -- [{agent, action}], twise agents the steps may use
    inputs_json    nvarchar(max)   NOT NULL CONSTRAINT DF_core_AiAgents_inputs DEFAULT '[]',   -- [{name, type, required, description}]
    outputs_json   nvarchar(max)   NOT NULL CONSTRAINT DF_core_AiAgents_outputs DEFAULT '[]',  -- [{name, type, description}]
    ask_data_json  nvarchar(max)   NULL,       -- built-in Ask Data tool: {businessRules, examples, allowedSchemas, maxRows}
    status         nvarchar(20)    NOT NULL CONSTRAINT DF_core_AiAgents_status DEFAULT 'draft', -- draft | published
    type           nvarchar(20)    NOT NULL CONSTRAINT DF_core_AiAgents_type DEFAULT 'sequential', -- sequential | parallel | supervisor | loop
    max_iterations int             NOT NULL CONSTRAINT DF_core_AiAgents_max_iter DEFAULT 5,       -- supervisor rounds / loop repeats
    created_by     nvarchar(200)   NOT NULL,
    created_at     datetime2       NOT NULL CONSTRAINT DF_core_AiAgents_created DEFAULT SYSUTCDATETIME(),
    updated_at     datetime2       NOT NULL CONSTRAINT DF_core_AiAgents_updated DEFAULT SYSUTCDATETIME()
);
IF COL_LENGTH('core.AiAgents', 'ask_data_json') IS NULL
ALTER TABLE core.AiAgents ADD ask_data_json nvarchar(max) NULL;
IF COL_LENGTH('core.AiAgents', 'type') IS NULL
ALTER TABLE core.AiAgents ADD type nvarchar(20) NOT NULL CONSTRAINT DF_core_AiAgents_type DEFAULT 'sequential';
IF COL_LENGTH('core.AiAgents', 'max_iterations') IS NULL
ALTER TABLE core.AiAgents ADD max_iterations int NOT NULL CONSTRAINT DF_core_AiAgents_max_iter DEFAULT 5;
IF COL_LENGTH('core.AiAgents', 'custom_tools_json') IS NULL
ALTER TABLE core.AiAgents ADD custom_tools_json nvarchar(max) NOT NULL CONSTRAINT DF_core_AiAgents_custom_tools DEFAULT N'[]';   -- Tool nodes (REST), secret encrypted
IF COL_LENGTH('core.AiAgents', 'notes_json') IS NULL
ALTER TABLE core.AiAgents ADD notes_json nvarchar(max) NOT NULL CONSTRAINT DF_core_AiAgents_notes DEFAULT N'[]';   -- canvas sticky notes (editor only)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAgents_tenant')
CREATE INDEX IX_core_AiAgents_tenant ON core.AiAgents (tenant_id, status);

IF OBJECT_ID('core.AiAgentRuns', 'U') IS NULL
CREATE TABLE core.AiAgentRuns (
    id           bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgentRuns PRIMARY KEY,
    tenant_id    bigint          NOT NULL,
    agent_id     bigint          NULL,        -- null for a test of an agent that was not saved yet
    agent_name   nvarchar(200)   NOT NULL,
    run_by       nvarchar(200)   NOT NULL,
    inputs_json  nvarchar(max)   NOT NULL,
    steps_json   nvarchar(max)   NULL,        -- each step: question, answer, sql, ok, error, seconds
    answer       nvarchar(max)   NULL,
    status       nvarchar(20)    NOT NULL,    -- success | failed
    error        nvarchar(1000)  NULL,
    seconds      float           NOT NULL CONSTRAINT DF_core_AiAgentRuns_seconds DEFAULT 0,
    started_at   datetime2       NOT NULL CONSTRAINT DF_core_AiAgentRuns_started DEFAULT SYSUTCDATETIME(),
    input_tokens  int            NULL,        -- LLM input (prompt) tokens on the tenant's AI provider; null = not recorded
    output_tokens int            NULL,        -- LLM output (completion) tokens
    total_tokens  int            NULL         -- input_tokens + output_tokens
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAgentRuns_agent')
CREATE INDEX IX_core_AiAgentRuns_agent ON core.AiAgentRuns (tenant_id, agent_id, started_at DESC);

-- Versions: every Save as Draft / Publish that changed the agent (snapshot without secrets); the newest 50 are kept.
IF OBJECT_ID('core.AiAgentVersions', 'U') IS NULL
CREATE TABLE core.AiAgentVersions (
    id            bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgentVersions PRIMARY KEY,
    tenant_id     bigint          NOT NULL,
    agent_id      bigint          NOT NULL CONSTRAINT FK_core_AiAgentVersions_agent REFERENCES core.AiAgents (id) ON DELETE CASCADE,
    version_no    int             NOT NULL,
    status        nvarchar(20)    NOT NULL,
    snapshot_json nvarchar(max)   NOT NULL,
    created_by    nvarchar(200)   NOT NULL,
    created_at    datetime2       NOT NULL CONSTRAINT DF_core_AiAgentVersions_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_core_AiAgentVersions_no UNIQUE (agent_id, version_no)
);

-- Memories: facts an agent with Load / Preload Memory keeps between runs; the newest 200 are kept.
IF OBJECT_ID('core.AiAgentMemories', 'U') IS NULL
CREATE TABLE core.AiAgentMemories (
    id          bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgentMemories PRIMARY KEY,
    tenant_id   bigint          NOT NULL,
    agent_id    bigint          NOT NULL CONSTRAINT FK_core_AiAgentMemories_agent REFERENCES core.AiAgents (id) ON DELETE CASCADE,
    text        nvarchar(1000)  NOT NULL,
    run_id      bigint          NULL,
    created_at  datetime2       NOT NULL CONSTRAINT DF_core_AiAgentMemories_created DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAgentMemories_agent')
CREATE INDEX IX_core_AiAgentMemories_agent ON core.AiAgentMemories (agent_id, id DESC);

-- Triggers: schedules that run a published agent (cron in a time zone, or once) and may mail the answer.
IF OBJECT_ID('core.AiAgentSchedules', 'U') IS NULL
CREATE TABLE core.AiAgentSchedules (
    id           bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgentSchedules PRIMARY KEY,
    tenant_id    bigint          NOT NULL,
    agent_id     bigint          NOT NULL CONSTRAINT FK_core_AiAgentSchedules_agent REFERENCES core.AiAgents (id) ON DELETE CASCADE,
    cron         nvarchar(100)   NULL,
    run_once_at  datetime2       NULL,
    time_zone    nvarchar(64)    NOT NULL,
    inputs_json  nvarchar(max)   NOT NULL CONSTRAINT DF_core_AiAgentSchedules_inputs DEFAULT '{}',
    email_to     nvarchar(1000)  NULL,
    is_active    bit             NOT NULL CONSTRAINT DF_core_AiAgentSchedules_active DEFAULT 1,
    next_run_at  datetime2       NULL,
    last_run_at  datetime2       NULL,
    last_run_id  bigint          NULL,
    last_status  nvarchar(20)    NULL,
    created_by   nvarchar(200)   NOT NULL,
    created_at   datetime2       NOT NULL CONSTRAINT DF_core_AiAgentSchedules_created DEFAULT SYSUTCDATETIME(),
    updated_at   datetime2       NOT NULL CONSTRAINT DF_core_AiAgentSchedules_updated DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAgentSchedules_due')
CREATE INDEX IX_core_AiAgentSchedules_due ON core.AiAgentSchedules (is_active, next_run_at);

-- Conversation threads and durable Human Approval (run as sent, no secrets, plus the paused state).
IF COL_LENGTH('core.AiAgentRuns', 'thread_id') IS NULL
    ALTER TABLE core.AiAgentRuns ADD thread_id nvarchar(64) NULL;
IF COL_LENGTH('core.AiAgentRuns', 'resume_json') IS NULL
    ALTER TABLE core.AiAgentRuns ADD resume_json nvarchar(max) NULL;

-- Evals: test cases per agent, and each "Run all" with its score and the version it tested.
IF OBJECT_ID('core.AiAgentEvalCases', 'U') IS NULL
CREATE TABLE core.AiAgentEvalCases (
    id           bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgentEvalCases PRIMARY KEY,
    tenant_id    bigint          NOT NULL,
    agent_id     bigint          NOT NULL CONSTRAINT FK_core_AiAgentEvalCases_agent REFERENCES core.AiAgents (id) ON DELETE CASCADE,
    name         nvarchar(200)   NOT NULL,
    inputs_json  nvarchar(max)   NOT NULL CONSTRAINT DF_core_AiAgentEvalCases_inputs DEFAULT '{}',
    expectation  nvarchar(4000)  NULL,
    rules_json   nvarchar(max)   NOT NULL CONSTRAINT DF_core_AiAgentEvalCases_rules DEFAULT '[]',
    created_by   nvarchar(200)   NOT NULL,
    created_at   datetime2       NOT NULL CONSTRAINT DF_core_AiAgentEvalCases_created DEFAULT SYSUTCDATETIME(),
    updated_at   datetime2       NOT NULL CONSTRAINT DF_core_AiAgentEvalCases_updated DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('core.AiAgentEvalRuns', 'U') IS NULL
CREATE TABLE core.AiAgentEvalRuns (
    id            bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAgentEvalRuns PRIMARY KEY,
    tenant_id     bigint          NOT NULL,
    agent_id      bigint          NOT NULL CONSTRAINT FK_core_AiAgentEvalRuns_agent REFERENCES core.AiAgents (id) ON DELETE CASCADE,
    version_no    int             NULL,
    draft         bit             NOT NULL CONSTRAINT DF_core_AiAgentEvalRuns_draft DEFAULT 0,
    passed        int             NOT NULL,
    total         int             NOT NULL,
    results_json  nvarchar(max)   NOT NULL,
    run_by        nvarchar(200)   NOT NULL,
    started_at    datetime2       NOT NULL CONSTRAINT DF_core_AiAgentEvalRuns_started DEFAULT SYSUTCDATETIME(),
    seconds       float           NOT NULL CONSTRAINT DF_core_AiAgentEvalRuns_seconds DEFAULT 0
);

-- Cost: token usage per model on each run, and the tenant's model price catalog (USD per 1M tokens).
IF COL_LENGTH('core.AiAgentRuns', 'usage_json') IS NULL
    ALTER TABLE core.AiAgentRuns ADD usage_json nvarchar(max) NULL;
IF OBJECT_ID('core.AiModelPrices', 'U') IS NULL
CREATE TABLE core.AiModelPrices (
    id             bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiModelPrices PRIMARY KEY,
    tenant_id      bigint          NOT NULL,
    model          nvarchar(100)   NOT NULL,
    model_class    nvarchar(20)    NOT NULL,
    input_per_1m   decimal(18,6)   NOT NULL,
    output_per_1m  decimal(18,6)   NOT NULL,
    updated_by     nvarchar(200)   NULL,
    updated_at     datetime2       NOT NULL CONSTRAINT DF_core_AiModelPrices_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_core_AiModelPrices_model UNIQUE (tenant_id, model)
);
