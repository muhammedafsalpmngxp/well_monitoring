-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — AI feature grants per role (add-ai-feature-roles.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- [core].[AiFeatureRoles]: which roles may use which AI feature in this tenant (admins always may).
-- Replaces the short-lived ask/chart/learning_enabled columns on core.AiSettings.
-- Requires add-ai-settings.sql. Idempotent.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-ai-feature-roles.sql
--   or open in DBeaver / SSMS and run as one script (no GO separators; USE picks the tenant DB).
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

USE [smartops_tenant_TNT-1000];

IF OBJECT_ID('core.AiFeatureRoles', 'U') IS NULL
BEGIN
    CREATE TABLE core.AiFeatureRoles (
        id           BIGINT IDENTITY(1,1) NOT NULL,
        tenant_id    BIGINT        NOT NULL,
        feature_key  NVARCHAR(40)  NOT NULL,   -- ask | chart | learning | (future keys)
        role_code    NVARCHAR(100) NOT NULL,   -- control.Role.role_code as carried in the JWT
        CONSTRAINT PK_AiFeatureRoles PRIMARY KEY CLUSTERED (id),
        CONSTRAINT UQ_AiFeatureRoles UNIQUE (tenant_id, feature_key, role_code)
    );
END

-- First install / upgrade: admins keep every current feature until an admin changes the matrix.
INSERT INTO core.AiFeatureRoles (tenant_id, feature_key, role_code)
SELECT s.tenant_id, f.feature_key, 'admin'
FROM core.AiSettings s
CROSS JOIN (VALUES ('ask'), ('chart'), ('learning'), ('summary'), ('filters'), ('edit'), ('recommend'), ('dashboard')) AS f(feature_key)
WHERE NOT EXISTS (SELECT 1 FROM core.AiFeatureRoles r WHERE r.tenant_id = s.tenant_id AND r.feature_key = f.feature_key AND r.role_code = 'admin');

IF COL_LENGTH('core.AiSettings', 'ask_enabled') IS NOT NULL
BEGIN
    ALTER TABLE core.AiSettings DROP CONSTRAINT DF_AiSettings_ask, DF_AiSettings_chart, DF_AiSettings_learning;
    ALTER TABLE core.AiSettings DROP COLUMN ask_enabled, chart_enabled, learning_enabled;
END
