-- =============================================================================
-- T-Wise Tenant: reverses 012-scheduled-deliveries.sql
-- -----------------------------------------------------------------------------
-- Drops schema delivery with every schedule, mail group and delivery log row
-- in it. Reports, dashboards and canvases are not changed.
-- Idempotent: each table is dropped only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 012-scheduled-deliveries.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

DROP TABLE IF EXISTS delivery.ScheduleRun;
DROP TABLE IF EXISTS delivery.ScheduleRecipient;
DROP TABLE IF EXISTS delivery.Schedule;
DROP TABLE IF EXISTS delivery.MailGroupMember;
DROP TABLE IF EXISTS delivery.MailGroup;
GO

IF SCHEMA_ID('delivery') IS NOT NULL
    EXEC('DROP SCHEMA delivery');
GO
