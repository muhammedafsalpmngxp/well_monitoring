-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI activity page index (add-ai-activity-index.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Settings → AI Activity lists every user's answers by date: assistant messages filtered by role and
-- created_at, joined to their conversation. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d <tenant database> -i add-ai-activity-index.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiChatMessages_role_created')
CREATE INDEX IX_core_AiChatMessages_role_created ON core.AiChatMessages (role, created_at) INCLUDE (conversation_id);
