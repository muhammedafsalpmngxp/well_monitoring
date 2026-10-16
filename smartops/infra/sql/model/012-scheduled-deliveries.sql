-- =============================================================================
-- T-Wise Tenant: scheduled deliveries of reports, dashboards and canvases
-- (012-scheduled-deliveries.sql)
-- -----------------------------------------------------------------------------
-- Creates schema delivery and its tables:
--   Schedule           what is sent (a report, dashboard or canvas), when (a
--                      cron in a time zone, or one run time), the subject and
--                      message, the format, and the next and last run.
--   ScheduleRecipient  To, Cc and Bcc of a schedule: users, roles, mail groups
--                      and typed addresses.
--   MailGroup          named address lists that schedules send to.
--   MailGroupMember    the addresses of a mail group.
--   ScheduleRun        one row per run, kept after its schedule is deleted.
-- The Tenant API's background worker reads Schedule and writes ScheduleRun.
-- Changes no data.
-- Idempotent: each table and index is created only while it is missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 012-scheduled-deliveries.sql
-- Reverse with 012-scheduled-deliveries.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF SCHEMA_ID('delivery') IS NULL
    EXEC('CREATE SCHEMA delivery');
GO

IF OBJECT_ID('delivery.Schedule', 'U') IS NULL
BEGIN
    CREATE TABLE delivery.Schedule (
        Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_Schedule PRIMARY KEY,
        TenantId    BIGINT         NOT NULL,
        Name        NVARCHAR(120)  NOT NULL,
        TargetType  VARCHAR(20)    NOT NULL CONSTRAINT CK_delivery_Schedule_TargetType CHECK (TargetType IN ('Report', 'Dashboard', 'Canvas')),
        TargetId    BIGINT         NOT NULL,
        Format      VARCHAR(10)    NOT NULL CONSTRAINT CK_delivery_Schedule_Format CHECK (Format IN ('Link', 'Xlsx', 'Csv')),
        Cron        VARCHAR(100)   NULL,
        RunOnceAt   DATETIME2(0)   NULL,
        TimeZone    VARCHAR(64)    NOT NULL,
        StartAt     DATETIME2(0)   NULL,
        EndAt       DATETIME2(0)   NULL,
        SkipIfEmpty BIT            NOT NULL CONSTRAINT DF_delivery_Schedule_SkipIfEmpty DEFAULT 0,
        Subject     NVARCHAR(200)  NOT NULL,
        Body        NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_delivery_Schedule_Body DEFAULT N'',
        IsActive    BIT            NOT NULL CONSTRAINT DF_delivery_Schedule_IsActive DEFAULT 1,
        OwnerUserId BIGINT         NOT NULL,
        NextRunAt   DATETIME2(0)   NULL,
        LastRunAt   DATETIME2(0)   NULL,
        LastStatus  VARCHAR(10)    NULL,
        CreatedBy   BIGINT         NOT NULL,
        CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_delivery_Schedule_CreatedAt DEFAULT SYSUTCDATETIME(),
        ModifiedBy  BIGINT         NULL,
        ModifiedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_delivery_Schedule_ModifiedAt DEFAULT SYSUTCDATETIME(),
        IsDeleted   BIT            NOT NULL CONSTRAINT DF_delivery_Schedule_IsDeleted DEFAULT 0,
        CONSTRAINT CK_delivery_Schedule_When CHECK (Cron IS NOT NULL OR RunOnceAt IS NOT NULL)
    );
END
GO

IF OBJECT_ID('delivery.Schedule', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_Schedule_Due' AND object_id = OBJECT_ID('delivery.Schedule'))
    CREATE INDEX IX_delivery_Schedule_Due ON delivery.Schedule (IsActive, IsDeleted, NextRunAt);
GO

IF OBJECT_ID('delivery.Schedule', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_delivery_Schedule_Target' AND object_id = OBJECT_ID('delivery.Schedule'))
    CREATE INDEX IX_delivery_Schedule_Target ON delivery.Schedule (TenantId, TargetType, TargetId);
GO

IF OBJECT_ID('delivery.ScheduleRecipient', 'U') IS NULL
BEGIN
    CREATE TABLE delivery.ScheduleRecipient (
        Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_ScheduleRecipient PRIMARY KEY,
        ScheduleId    BIGINT         NOT NULL CONSTRAINT FK_delivery_ScheduleRecipient_Schedule
                                         REFERENCES delivery.Schedule (Id) ON DELETE CASCADE,
        Kind          VARCHAR(3)     NOT NULL CONSTRAINT CK_delivery_ScheduleRecipient_Kind CHECK (Kind IN ('To', 'Cc', 'Bcc')),
        RecipientType VARCHAR(5)     NOT NULL CONSTRAINT CK_delivery_ScheduleRecipient_Type CHECK (RecipientType IN ('User', 'Role', 'Group', 'Email')),
        Value         NVARCHAR(320)  NOT NULL,
        Label         NVARCHAR(200)  NULL
    );
    CREATE INDEX IX_delivery_ScheduleRecipient_Schedule ON delivery.ScheduleRecipient (ScheduleId);
END
GO

IF OBJECT_ID('delivery.MailGroup', 'U') IS NULL
BEGIN
    CREATE TABLE delivery.MailGroup (
        Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_MailGroup PRIMARY KEY,
        TenantId    BIGINT         NOT NULL,
        Name        NVARCHAR(120)  NOT NULL,
        Description NVARCHAR(400)  NULL,
        CreatedBy   BIGINT         NOT NULL,
        CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_delivery_MailGroup_CreatedAt DEFAULT SYSUTCDATETIME(),
        ModifiedBy  BIGINT         NULL,
        ModifiedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_delivery_MailGroup_ModifiedAt DEFAULT SYSUTCDATETIME(),
        IsDeleted   BIT            NOT NULL CONSTRAINT DF_delivery_MailGroup_IsDeleted DEFAULT 0
    );
    CREATE UNIQUE INDEX UX_delivery_MailGroup_Name ON delivery.MailGroup (TenantId, Name) WHERE IsDeleted = 0;
END
GO

IF OBJECT_ID('delivery.MailGroupMember', 'U') IS NULL
BEGIN
    CREATE TABLE delivery.MailGroupMember (
        Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_MailGroupMember PRIMARY KEY,
        MailGroupId BIGINT         NOT NULL CONSTRAINT FK_delivery_MailGroupMember_MailGroup
                                       REFERENCES delivery.MailGroup (Id) ON DELETE CASCADE,
        Email       NVARCHAR(320)  NOT NULL
    );
    CREATE INDEX IX_delivery_MailGroupMember_Group ON delivery.MailGroupMember (MailGroupId);
END
GO

-- No foreign key to Schedule: the log of a deleted schedule is kept.
IF OBJECT_ID('delivery.ScheduleRun', 'U') IS NULL
BEGIN
    CREATE TABLE delivery.ScheduleRun (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_delivery_ScheduleRun PRIMARY KEY,
        TenantId        BIGINT          NOT NULL,
        ScheduleId      BIGINT          NULL,
        ScheduleName    NVARCHAR(120)   NOT NULL,
        TargetType      VARCHAR(20)     NOT NULL,
        TargetId        BIGINT          NOT NULL,
        TargetName      NVARCHAR(200)   NULL,
        [Trigger]       VARCHAR(10)     NOT NULL CONSTRAINT CK_delivery_ScheduleRun_Trigger CHECK ([Trigger] IN ('Schedule', 'RunNow', 'Test')),
        Status          VARCHAR(10)     NOT NULL CONSTRAINT CK_delivery_ScheduleRun_Status CHECK (Status IN ('Sent', 'Skipped', 'Failed')),
        StartedAt       DATETIME2(3)    NOT NULL,
        FinishedAt      DATETIME2(3)    NULL,
        RecipientCount  INT             NOT NULL CONSTRAINT DF_delivery_ScheduleRun_RecipientCount DEFAULT 0,
        AttachmentBytes BIGINT          NOT NULL CONSTRAINT DF_delivery_ScheduleRun_AttachmentBytes DEFAULT 0,
        Attempt         INT             NOT NULL CONSTRAINT DF_delivery_ScheduleRun_Attempt DEFAULT 0,
        Error           NVARCHAR(2000)  NULL
    );
    CREATE INDEX IX_delivery_ScheduleRun_Started ON delivery.ScheduleRun (TenantId, StartedAt DESC);
END
GO
