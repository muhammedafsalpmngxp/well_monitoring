-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI agent state (add-ai-agent-state.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds [core].[AiAgents].[agent_state]: 'active' or 'inactive'. An admin switches an agent off on
-- AI Agents (⋮ → Deactivate) without deleting it; an inactive agent cannot be run. Existing agents
-- become 'active'. Run after add-ai-agents.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-agent-state.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators).
-- ═════════════════════════════════════════════════════════════════════════════

IF COL_LENGTH('core.AiAgents', 'agent_state') IS NULL
    ALTER TABLE core.AiAgents
        ADD agent_state varchar(20) NOT NULL
            CONSTRAINT DF_AiAgents_agent_state DEFAULT ('active') WITH VALUES;

-- In EXEC: the column does not exist yet when this batch is compiled.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AiAgents_agent_state')
    EXEC (N'ALTER TABLE core.AiAgents ADD CONSTRAINT CK_AiAgents_agent_state CHECK (agent_state IN (''active'', ''inactive''))');
