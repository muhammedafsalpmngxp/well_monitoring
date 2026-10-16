-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — Tenant Seed Data (init-tenant-schema-seed.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Seeds static lookup data and the ref.Date dimension.
-- Executed AFTER init-tenant-schema.sql creates tables.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

-- ── ref.Date dimension (2015-01-01 → 2035-12-31) ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.[Date])
BEGIN
    DECLARE @d date = '2015-01-01';
    WHILE @d <= '2035-12-31'
    BEGIN
        INSERT INTO ref.[Date] (date_key, full_date, [year], [quarter], [month], month_name, week_no, week_ending, day_of_week, is_month_end)
        VALUES (
            CAST(FORMAT(@d, 'yyyyMMdd') AS int),
            @d,
            YEAR(@d),
            DATEPART(QUARTER, @d),
            MONTH(@d),
            LEFT(DATENAME(MONTH, @d), 3),
            DATEPART(ISO_WEEK, @d),
            DATEADD(DAY, 7 - DATEPART(WEEKDAY, @d), @d),
            DATEPART(WEEKDAY, @d),
            CASE WHEN @d = EOMONTH(@d) THEN 1 ELSE 0 END
        );
        SET @d = DATEADD(DAY, 1, @d);
    END
    PRINT '✓ ref.Date seeded (2015–2035)';
END
GO

-- ── ref.ProgressStatus ────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.ProgressStatus)
BEGIN
    INSERT INTO ref.ProgressStatus (code, name) VALUES ('INP', 'In Progress');
    INSERT INTO ref.ProgressStatus (code, name) VALUES ('CMP', 'Completed');
    INSERT INTO ref.ProgressStatus (code, name) VALUES ('NS', 'Not Started');
    PRINT '✓ ref.ProgressStatus seeded';
END
GO

-- ── ref.DurationUnit ──────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.DurationUnit)
BEGIN
    INSERT INTO ref.DurationUnit (name) VALUES ('DAY');
    INSERT INTO ref.DurationUnit (name) VALUES ('HOUR');
    INSERT INTO ref.DurationUnit (name) VALUES ('WEEK');
    PRINT '✓ ref.DurationUnit seeded';
END
GO

-- ── ref.EventType ─────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.EventType)
BEGIN
    INSERT INTO ref.EventType (name) VALUES ('FLAF Issue');
    INSERT INTO ref.EventType (name) VALUES ('Rig On');
    INSERT INTO ref.EventType (name) VALUES ('Rig Off');
    INSERT INTO ref.EventType (name) VALUES ('Comm Start');
    PRINT '✓ ref.EventType seeded';
END
GO

-- ── ref.DocumentType ──────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.DocumentType)
BEGIN
    INSERT INTO ref.DocumentType (code, name) VALUES ('FLAF', 'Field Layout Approval Form');
    INSERT INTO ref.DocumentType (code, name) VALUES ('Z6', 'SAP Z6 Notification');
    INSERT INTO ref.DocumentType (code, name) VALUES ('RLMU', 'Red-line Markup');
    PRINT '✓ ref.DocumentType seeded';
END
GO

-- ── ref.DocumentStatus ────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.DocumentStatus)
BEGIN
    INSERT INTO ref.DocumentStatus (code, name) VALUES ('DRF', 'Draft');
    INSERT INTO ref.DocumentStatus (code, name) VALUES ('ISS', 'Issued');
    INSERT INTO ref.DocumentStatus (code, name) VALUES ('APR', 'Approved');
    PRINT '✓ ref.DocumentStatus seeded';
END
GO

-- ── ref.TaskType ──────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ref.TaskType)
BEGIN
    INSERT INTO ref.TaskType (code, name) VALUES ('W', 'Well');
    INSERT INTO ref.TaskType (code, name) VALUES ('F', 'Flowline');
    INSERT INTO ref.TaskType (code, name) VALUES ('M', 'Milestone');
    PRINT '✓ ref.TaskType seeded';
END
GO

PRINT '✓ All seed data inserted successfully.';
GO
