-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps Tenant — Crew Activity Assignment table (add-crew-activity-assignment.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates [core].[CrewActivityAssignment] in the tenant DB.
-- Stores crew→activity assignments made from the Activity Breakdown board.
-- Referenced crew/activity keys live in the legacy AppMasterDB (no cross-DB FK).
-- Idempotent: safe to run multiple times.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i add-crew-activity-assignment.sql
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

-- Adjust the database name per tenant if required.
USE [smartops_tenant_TNT-1000];
GO

IF SCHEMA_ID('core') IS NULL
    EXEC('CREATE SCHEMA core;');
GO

IF OBJECT_ID('core.CrewActivityAssignment', 'U') IS NULL
BEGIN
    CREATE TABLE core.CrewActivityAssignment (
        id                BIGINT IDENTITY(1,1) NOT NULL,

        -- WHO the activity is assigned to (from legacy dbo.crews / OLD_NEW_CREW_MAPPING)
        crew_group_code   NVARCHAR(50)   NOT NULL,   -- e.g. 'FBB-0503' (CrewType.Code)
        crew_uid          NVARCHAR(128)  NOT NULL,   -- e.g. 'MML_MBB0503_15ATE' (crews.Code)
        crew_type_code    NVARCHAR(50)   NULL,       -- e.g. 'MBB0503' (crews.Composition / Old_Crew_Code)

        -- WHAT activity is assigned (from legacy dbo.ActivityMasterCSV)
        activity_code     NVARCHAR(50)   NOT NULL,   -- e.g. 'FLCO1020-36105'
        activity_name     NVARCHAR(500)  NOT NULL,
        well_id           NVARCHAR(50)   NULL,       -- target well (board is well-scoped)
        project_id        NVARCHAR(64)   NULL,       -- cluster/project scope

        -- WHEN / planning
        planned_start     DATETIME2      NULL,
        planned_end       DATETIME2      NULL,
        progress          DECIMAL(5,2)   NOT NULL CONSTRAINT DF_CAA_progress DEFAULT (0),

        -- lifecycle: assigned | in-progress | completed | cancelled
        status            NVARCHAR(20)   NOT NULL CONSTRAINT DF_CAA_status DEFAULT ('assigned'),

        -- audit (BaseEntity)
        is_deleted        BIT            NOT NULL CONSTRAINT DF_CAA_is_deleted  DEFAULT (0),
        created_at        DATETIME2      NOT NULL CONSTRAINT DF_CAA_created_at  DEFAULT (SYSUTCDATETIME()),
        modified_at       DATETIME2      NOT NULL CONSTRAINT DF_CAA_modified_at DEFAULT (SYSUTCDATETIME()),
        created_by        NVARCHAR(256)  NULL,
        modified_by       NVARCHAR(256)  NULL,
        deleted_by        NVARCHAR(256)  NULL,

        CONSTRAINT PK_CrewActivityAssignment PRIMARY KEY CLUSTERED (id)
    );
END
GO

-- Prevent assigning the same activity to the same crew twice (live rows only).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrewActivityAssignment_Crew_Activity'
               AND object_id = OBJECT_ID('core.CrewActivityAssignment'))
BEGIN
    CREATE UNIQUE INDEX IX_CrewActivityAssignment_Crew_Activity
        ON core.CrewActivityAssignment (crew_uid, activity_code, well_id)
        WHERE is_deleted = 0;
END
GO

-- Fast lookup when overlaying tenant assignments onto the calendar read.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrewActivityAssignment_Group'
               AND object_id = OBJECT_ID('core.CrewActivityAssignment'))
BEGIN
    CREATE INDEX IX_CrewActivityAssignment_Group
        ON core.CrewActivityAssignment (crew_group_code)
        WHERE is_deleted = 0;
END
GO

PRINT 'core.CrewActivityAssignment is ready.';
GO
