-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — what the Agentic AI release still needs (check-agentic-release.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- READ-ONLY. Lists, per script of the release, whether its tables and columns exist in this tenant database:
-- 'ok' = nothing to do, 'MISSING' = run that script (see RUN-ORDER-agentic.md for the order).
--
-- Usage: change the USE line to the tenant database (UAT: smartops_tenant_TNT-1000-new), run as one script.
-- The control-plane part is at the end: run it on the control-plane database.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000-new];

SELECT c.script, c.object, CASE WHEN c.present = 1 THEN 'ok' ELSE 'MISSING' END AS status
FROM (VALUES
    ('add-ai-settings.sql',          'core.AiSettings',                    CASE WHEN OBJECT_ID('core.AiSettings', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-settings.sql',          'core.AiUsageLog',                    CASE WHEN OBJECT_ID('core.AiUsageLog', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-providers.sql',         'core.AiProviders',                   CASE WHEN OBJECT_ID('core.AiProviders', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-providers.sql',         'core.AiProviders.fast_model',        CASE WHEN COL_LENGTH('core.AiProviders', 'fast_model') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-providers.sql',         'core.AiProviders.daily_quota',       CASE WHEN COL_LENGTH('core.AiProviders', 'daily_quota') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-conversations.sql',     'core.AiConversations',               CASE WHEN OBJECT_ID('core.AiConversations', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-trace.sql',             'core.AiTraces',                      CASE WHEN OBJECT_ID('core.AiTraces', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-feature-roles.sql',     'core.AiFeatureRoles',                CASE WHEN OBJECT_ID('core.AiFeatureRoles', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-prompts.sql',           'core.AiSettings.prompts_json',       CASE WHEN COL_LENGTH('core.AiSettings', 'prompts_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-prompt-table.sql',      'core.AiPrompt',                      CASE WHEN OBJECT_ID('core.AiPrompt', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-prompt-history.sql',    'core.AiPromptHistory',               CASE WHEN OBJECT_ID('core.AiPromptHistory', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-prompt-history.sql',    'core.AiSettings.row_ver',            CASE WHEN COL_LENGTH('core.AiSettings', 'row_ver') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-askdata-settings.sql',  'core.AiSettings.askdata_chat_mode',  CASE WHEN COL_LENGTH('core.AiSettings', 'askdata_chat_mode') IS NULL THEN 0 ELSE 1 END),
    ('add-agentic-features.sql',     'core.AiFeatureJob',                  CASE WHEN OBJECT_ID('core.AiFeatureJob', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-agentic-features.sql',     'core.AiFeatureQuery',                CASE WHEN OBJECT_ID('core.AiFeatureQuery', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-feature-answers.sql',   'core.AiFeatureAnswer',               CASE WHEN OBJECT_ID('core.AiFeatureAnswer', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-agentic-features.sql',     'core.AnomalyRule',                   CASE WHEN OBJECT_ID('core.AnomalyRule', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-agentic-features.sql',     'core.AiSettings.anomaly_settings_json', CASE WHEN COL_LENGTH('core.AiSettings', 'anomaly_settings_json') IS NULL THEN 0 ELSE 1 END),
    ('add-agentic-features.sql',     'core.AiSettings.crew_settings_json', CASE WHEN COL_LENGTH('core.AiSettings', 'crew_settings_json') IS NULL THEN 0 ELSE 1 END),
    ('add-agentic-features.sql',     'core.AiSettings.askdata_included_tables', CASE WHEN COL_LENGTH('core.AiSettings', 'askdata_included_tables') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-trace.sql',             'core.AiTraces.rejections_json',      CASE WHEN COL_LENGTH('core.AiTraces', 'rejections_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-conversations.sql',     'core.AiChatMessages.answer_json',    CASE WHEN COL_LENGTH('core.AiChatMessages', 'answer_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgents',                      CASE WHEN OBJECT_ID('core.AiAgents', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgents.custom_tools_json',    CASE WHEN COL_LENGTH('core.AiAgents', 'custom_tools_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgents.notes_json',           CASE WHEN COL_LENGTH('core.AiAgents', 'notes_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentRuns',                   CASE WHEN OBJECT_ID('core.AiAgentRuns', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentRuns.usage_json',        CASE WHEN COL_LENGTH('core.AiAgentRuns', 'usage_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentRuns.total_tokens',      CASE WHEN COL_LENGTH('core.AiAgentRuns', 'total_tokens') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentRuns.resume_json',       CASE WHEN COL_LENGTH('core.AiAgentRuns', 'resume_json') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentVersions',               CASE WHEN OBJECT_ID('core.AiAgentVersions', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentMemories',               CASE WHEN OBJECT_ID('core.AiAgentMemories', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentSchedules',              CASE WHEN OBJECT_ID('core.AiAgentSchedules', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiAgentEvalCases',              CASE WHEN OBJECT_ID('core.AiAgentEvalCases', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agents.sql',            'core.AiModelPrices',                 CASE WHEN OBJECT_ID('core.AiModelPrices', 'U') IS NULL THEN 0 ELSE 1 END),
    ('add-ai-agent-state.sql',       'core.AiAgents.agent_state',          CASE WHEN COL_LENGTH('core.AiAgents', 'agent_state') IS NULL THEN 0 ELSE 1 END),
    -- After the deploy only: 'MISSING' here is the goal (the column is gone).
    ('remove-ai-providers-soft-delete.sql (after deploy)', 'core.AiProviders.is_deleted removed',
                                                                           CASE WHEN COL_LENGTH('core.AiProviders', 'is_deleted') IS NULL THEN 1 ELSE 0 END)
) AS c(script, object, present)
ORDER BY CASE WHEN c.present = 1 THEN 1 ELSE 0 END, c.script;

-- ── Control-plane database (run separately on it, e.g. smartops_control_plane) ──
-- SELECT module_code, CASE WHEN COUNT(*) > 0 THEN 'ok' ELSE 'MISSING' END AS status
-- FROM (VALUES ('agentic-ai.features'), ('agentic-ai.slippage'), ('agentic-ai.daily-report'), ('agentic-ai.data-anomaly'), ('agentic-ai.crew-management')) m(module_code)
-- LEFT JOIN control.FeatureModule f ON f.module_code = m.module_code AND f.is_deleted = 0
-- GROUP BY m.module_code;   -- MISSING → add-agentic-features-permission.sql
