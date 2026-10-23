-- =============================================================================
-- T-Wise Tenant: scheduled insight reports
-- (015-schedule-insight-target.sql)
-- -----------------------------------------------------------------------------
-- Widens CK_delivery_Schedule_TargetType (012) with 'Insight': an Ask AI
-- answer's insight report e-mailed on a schedule (TargetId is the answer,
-- core.AiChatMessages.id). Changes no data. Run 012 first: without its tables
-- this script changes nothing.
-- Idempotent: the constraint is recreated only while it lacks 'Insight'.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 015-schedule-insight-target.sql
-- Reverse with 015-schedule-insight-target.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('delivery.Schedule', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = 'CK_delivery_Schedule_TargetType' AND parent_object_id = OBJECT_ID('delivery.Schedule')
                     AND definition LIKE '%''Insight''%')
BEGIN
    IF OBJECT_ID('delivery.CK_delivery_Schedule_TargetType', 'C') IS NOT NULL
        ALTER TABLE delivery.Schedule DROP CONSTRAINT CK_delivery_Schedule_TargetType;
    ALTER TABLE delivery.Schedule ADD CONSTRAINT CK_delivery_Schedule_TargetType
        CHECK (TargetType IN ('Report', 'Dashboard', 'Canvas', 'Insight'));
END
GO
