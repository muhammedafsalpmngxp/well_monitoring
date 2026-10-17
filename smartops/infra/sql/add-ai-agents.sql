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
