-- =============================================================================
-- T-Wise Tenant: reverses 015-schedule-insight-target.sql
-- -----------------------------------------------------------------------------
-- Narrows CK_delivery_Schedule_TargetType back to 'Report', 'Dashboard' and
-- 'Canvas'. Stops without changes while an insight schedule is stored,
-- including deleted ones: the narrower constraint would refuse it. Delete those
-- rows first. Run history (delivery.ScheduleRun) has no such constraint.
-- Idempotent: the constraint is recreated only while it allows 'Insight'.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 015-schedule-insight-target.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID('delivery.Schedule', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM delivery.Schedule WHERE TargetType = 'Insight')
BEGIN
    RAISERROR('Some schedules send insight reports. Delete them first. Nothing was changed.', 16, 1);
    RETURN;
END

IF OBJECT_ID('delivery.Schedule', 'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = 'CK_delivery_Schedule_TargetType' AND parent_object_id = OBJECT_ID('delivery.Schedule')
                 AND definition LIKE '%''Insight''%')
BEGIN
    ALTER TABLE delivery.Schedule DROP CONSTRAINT CK_delivery_Schedule_TargetType;
    ALTER TABLE delivery.Schedule ADD CONSTRAINT CK_delivery_Schedule_TargetType
        CHECK (TargetType IN ('Report', 'Dashboard', 'Canvas'));
END
GO
