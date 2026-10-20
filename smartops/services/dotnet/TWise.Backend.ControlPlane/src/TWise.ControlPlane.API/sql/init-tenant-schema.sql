-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — Tenant Data Plane Schema (init-tenant-schema.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates all 52 tables for a tenant database (star + SCD2 model).
-- Executed by TenantProvisioningService AFTER schemas are created.
-- Idempotent: re-runnable with IF NOT EXISTS guards.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 1: ref.* LOOKUP TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'ref.Date', N'U') IS NULL
CREATE TABLE ref.[Date] (
    date_key         int           NOT NULL CONSTRAINT PK_ref_Date PRIMARY KEY,
    full_date        date          NOT NULL CONSTRAINT UQ_ref_Date_full UNIQUE,
    [year]           smallint      NOT NULL,
    [quarter]        tinyint       NOT NULL,
    [month]          tinyint       NOT NULL,
    month_name       varchar(10)   NOT NULL,
    week_no          tinyint       NOT NULL,
    week_ending      date          NOT NULL,
    day_of_week      tinyint       NOT NULL,
    is_month_end     bit           NOT NULL DEFAULT 0
);
GO

IF OBJECT_ID(N'ref.Cluster', N'U') IS NULL
CREATE TABLE ref.Cluster (
    cluster_id       int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Cluster PRIMARY KEY,
    cluster_code     varchar(10)   NOT NULL CONSTRAINT UQ_ref_Cluster_code UNIQUE,
    cluster_name     varchar(50)   NOT NULL CONSTRAINT UQ_ref_Cluster_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.Site', N'U') IS NULL
CREATE TABLE ref.Site (
    site_id          int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Site PRIMARY KEY,
    cluster_id       int           NULL,
    site_code        varchar(20)   NOT NULL CONSTRAINT UQ_ref_Site_code UNIQUE,
    site_name        varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.ProjectCategory', N'U') IS NULL
CREATE TABLE ref.ProjectCategory (
    project_category_id int        IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_ProjectCategory PRIMARY KEY,
    category_name    varchar(100)  NOT NULL CONSTRAINT UQ_ref_ProjectCategory_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.WellType', N'U') IS NULL
CREATE TABLE ref.WellType (
    well_type_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_WellType PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_WellType_code UNIQUE,
    type_name        varchar(100)  NOT NULL CONSTRAINT UQ_ref_WellType_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.CompletionType', N'U') IS NULL
CREATE TABLE ref.CompletionType (
    completion_type_id int         IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_CompletionType PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_CompletionType_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.WellFunction', N'U') IS NULL
CREATE TABLE ref.WellFunction (
    well_function_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_WellFunction PRIMARY KEY,
    name             varchar(100)  NOT NULL CONSTRAINT UQ_ref_WellFunction_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.WellCategory', N'U') IS NULL
CREATE TABLE ref.WellCategory (
    well_category_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_WellCategory PRIMARY KEY,
    name             varchar(100)  NOT NULL CONSTRAINT UQ_ref_WellCategory_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.PdoWellType', N'U') IS NULL
CREATE TABLE ref.PdoWellType (
    pdo_well_type_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_PdoWellType PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_PdoWellType_code UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.PcapCategory', N'U') IS NULL
CREATE TABLE ref.PcapCategory (
    pcap_category_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_PcapCategory PRIMARY KEY,
    name             varchar(100)  NOT NULL CONSTRAINT UQ_ref_PcapCategory_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.LiftType', N'U') IS NULL
CREATE TABLE ref.LiftType (
    lift_type_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_LiftType PRIMARY KEY,
    code             varchar(10)   NOT NULL CONSTRAINT UQ_ref_LiftType_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.WorkCenter', N'U') IS NULL
CREATE TABLE ref.WorkCenter (
    work_center_id   int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_WorkCenter PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_WorkCenter_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.Activity', N'U') IS NULL
CREATE TABLE ref.Activity (
    activity_id      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Activity PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_Activity_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.OperationStatus', N'U') IS NULL
CREATE TABLE ref.OperationStatus (
    status_id        int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_OperationStatus PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_OperationStatus_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.DurationUnit', N'U') IS NULL
CREATE TABLE ref.DurationUnit (
    duration_unit_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_DurationUnit PRIMARY KEY,
    name             varchar(20)   NOT NULL CONSTRAINT UQ_ref_DurationUnit_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.EventType', N'U') IS NULL
CREATE TABLE ref.EventType (
    event_type_id    int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_EventType PRIMARY KEY,
    name             varchar(100)  NOT NULL CONSTRAINT UQ_ref_EventType_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.ProgressStatus', N'U') IS NULL
CREATE TABLE ref.ProgressStatus (
    progress_status_id int         IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_ProgressStatus PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_ProgressStatus_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.ProgressActivity', N'U') IS NULL
CREATE TABLE ref.ProgressActivity (
    activity_id      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_ProgressActivity PRIMARY KEY,
    discipline       varchar(50)   NULL,
    activity_name    varchar(100)  NULL,
    weight_pct       decimal(5,2)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.DocumentType', N'U') IS NULL
CREATE TABLE ref.DocumentType (
    doc_type_id      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_DocumentType PRIMARY KEY,
    code             varchar(30)   NOT NULL CONSTRAINT UQ_ref_DocumentType_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.DocumentStatus', N'U') IS NULL
CREATE TABLE ref.DocumentStatus (
    doc_status_id    int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_DocumentStatus PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_DocumentStatus_code UNIQUE,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.TaskType', N'U') IS NULL
CREATE TABLE ref.TaskType (
    task_type_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_TaskType PRIMARY KEY,
    code             char(1)       NOT NULL CONSTRAINT UQ_ref_TaskType_code UNIQUE,
    name             varchar(50)   NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 2: ref.* WORKFORCE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'ref.EmployeeType', N'U') IS NULL
CREATE TABLE ref.EmployeeType (
    employee_type_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_EmployeeType PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_EmployeeType_code UNIQUE,
    category         varchar(50)   NULL,
    description      varchar(100)  NULL,
    rate             decimal(10,2) NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL,
    source_id        int           NULL
);
GO

IF OBJECT_ID(N'ref.Company', N'U') IS NULL
CREATE TABLE ref.Company (
    company_id       int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Company PRIMARY KEY,
    name             varchar(120)  NOT NULL CONSTRAINT UQ_ref_Company_name UNIQUE,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL,
    source_id        int           NULL
);
GO

IF OBJECT_ID(N'ref.Location', N'U') IS NULL
CREATE TABLE ref.Location (
    location_id      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Location PRIMARY KEY,
    name             varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.Employee', N'U') IS NULL
CREATE TABLE ref.Employee (
    employee_id      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Employee PRIMARY KEY,
    employee_uid     varchar(20)   NOT NULL CONSTRAINT UQ_ref_Employee_uid UNIQUE,
    name             varchar(120)  NULL,
    email            varchar(160)  NULL,
    status           varchar(20)   NULL,
    employee_type_id int           NULL,
    company_id       int           NULL,
    location_id      int           NULL,
    supervisor_id    int           NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.CrewType', N'U') IS NULL
CREATE TABLE ref.CrewType (
    crew_type_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_CrewType PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_CrewType_code UNIQUE,
    description      varchar(100)  NULL,
    employee_count   varchar(500)  NULL,
    equipment_count  varchar(500)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL,
    source_id        int           NULL
);
GO

IF OBJECT_ID(N'ref.Crew', N'U') IS NULL
CREATE TABLE ref.Crew (
    crew_id          int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Crew PRIMARY KEY,
    crew_code        varchar(40)   NOT NULL CONSTRAINT UQ_ref_Crew_code UNIQUE,
    crew_uid         varchar(40)   NULL,
    crew_type_id     int           NULL,
    location_id      int           NULL,
    supervisor_id    int           NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.ActivityMaster', N'U') IS NULL
CREATE TABLE ref.ActivityMaster (
    activity_master_id int         IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_ActivityMaster PRIMARY KEY,
    activity_code    varchar(30)   NOT NULL CONSTRAINT UQ_ref_ActivityMaster_code UNIQUE,
    discipline       varchar(50)   NULL,
    activity_group   varchar(100)  NULL,
    description      varchar(200)  NULL,
    application      varchar(50)   NULL,
    crew_type_id     int           NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.EquipmentType', N'U') IS NULL
CREATE TABLE ref.EquipmentType (
    equipment_type_id int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_EquipmentType PRIMARY KEY,
    code             varchar(20)   NOT NULL CONSTRAINT UQ_ref_EquipmentType_code UNIQUE,
    description      varchar(100)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.Equipment', N'U') IS NULL
CREATE TABLE ref.Equipment (
    equipment_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_Equipment PRIMARY KEY,
    code             varchar(40)   NOT NULL CONSTRAINT UQ_ref_Equipment_code UNIQUE,
    equipment_type_id int          NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'ref.CrewTypeEmployee', N'U') IS NULL
CREATE TABLE ref.CrewTypeEmployee (
    ct_employee_id   int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_CrewTypeEmployee PRIMARY KEY,
    crew_type_id     int           NULL,
    employee_type_id int           NULL,
    quantity         smallint      NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL,
    CONSTRAINT UQ_ref_CrewTypeEmployee UNIQUE (crew_type_id, employee_type_id)
);
GO

IF OBJECT_ID(N'ref.CrewTypeEquipment', N'U') IS NULL
CREATE TABLE ref.CrewTypeEquipment (
    ct_equipment_id  int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_ref_CrewTypeEquipment PRIMARY KEY,
    crew_type_id     int           NULL,
    equipment_type_id int          NULL,
    quantity         smallint      NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL,
    CONSTRAINT UQ_ref_CrewTypeEquipment UNIQUE (crew_type_id, equipment_type_id)
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 3: core.* DIMENSION TABLES (SCD2 + SCD1)
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.Project', N'U') IS NULL
CREATE TABLE core.Project (
    project_key          bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Project PRIMARY KEY,
    project_uid          uniqueidentifier NULL,
    project_code         varchar(20)   NULL,
    project_name         varchar(200)  NULL,
    cluster_id           int           NULL,
    project_category_id  int           NULL,
    well_type_id         int           NULL,
    sort_no              smallint      NULL,
    effective_start_date datetime2(3)  NULL,
    effective_end_date   datetime2(3)  NULL,
    is_current           bit           NOT NULL DEFAULT 1,
    is_active            bit           NOT NULL DEFAULT 1,
    created_at           datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at          datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id     int           NULL
);
GO

IF OBJECT_ID(N'core.Well', N'U') IS NULL
CREATE TABLE core.Well (
    well_key             bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Well PRIMARY KEY,
    pdo_well_id          varchar(20)   NULL,
    well_code            varchar(40)   NULL,
    well_name            varchar(100)  NULL,
    project_key          bigint        NULL,
    site_id              int           NULL,
    field_name           varchar(50)   NULL,
    well_function_id     int           NULL,
    well_category_id     int           NULL,
    pdo_well_type_id     int           NULL,
    pcap_category_id     int           NULL,
    lift_type_id         int           NULL,
    responsible_asset    varchar(50)   NULL,
    northing             decimal(12,2) NULL,
    easting              decimal(12,2) NULL,
    rig                  varchar(20)   NULL,
    well_year_white_space varchar(200) NULL,
    reasons_for_year_2018 varchar(200) NULL,
    data_error        varchar(300)  NULL,
    effective_start_date datetime2(3)  NULL,
    effective_end_date   datetime2(3)  NULL,
    is_current           bit           NOT NULL DEFAULT 1,
    is_active            bit           NOT NULL DEFAULT 1,
    created_at           datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at          datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id     int           NULL
);
GO

IF OBJECT_ID(N'core.WellScope', N'U') IS NULL
CREATE TABLE core.WellScope (
    well_scope_key   int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_WellScope PRIMARY KEY,
    well_key         bigint        NULL,
    completion_type_id int         NULL,
    fl_dia_mm        decimal(6,1)  NULL,
    fl_length_m      decimal(8,1)  NULL,
    ohl_length_m     decimal(8,1)  NULL,
    kpi_days         smallint      NULL,
    station_name     varchar(100)  NULL,
    tie_in_port      varchar(40)   NULL,
    location_dd      varchar(40)   NULL,
    flowline_dl      varchar(40)   NULL,
    ramz_id          varchar(20)   NULL,
    scr_no           varchar(30)   NULL,
    scr_date         date          NULL,
    moc_raised       bit           NULL,
    moc_approved     bit           NULL,
    buffer_status    varchar(20)   NULL,
    attributes_json  nvarchar(max) NULL,
    ssfd_wells       varchar(200)  NULL,
    ipm              varchar(200)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'core.Schedule', N'U') IS NULL
CREATE TABLE core.Schedule (
    schedule_key     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Schedule PRIMARY KEY,
    schedule_no      int           NOT NULL CONSTRAINT UQ_core_Schedule_no UNIQUE,
    project_key      bigint        NULL,
    well_key         bigint        NULL,
    name             varchar(200)  NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'core.ScheduleTask', N'U') IS NULL
CREATE TABLE core.ScheduleTask (
    task_key           bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ScheduleTask PRIMARY KEY,
    source_task_id     bigint        NULL,
    schedule_key       int           NULL,
    well_key           bigint        NULL,
    project_key        bigint        NULL,
    parent_task_key    bigint        NULL,
    wbs_code           varchar(40)   NULL,
    ancestor_path      varchar(200)  NULL,
    task_text          varchar(400)  NULL,
    task_type_id       int           NULL,
    activity_master_id int           NULL,
    task_assignee_id   int           NULL,
    supervisor_id      int           NULL,
    crew_uid           varchar(40)   NULL,
    weightage          decimal(9,8)  NULL,
    planned_duration   smallint      NULL,
    resume_suspend     varchar(10)   NULL,
    is_nonprod         bit           NULL,
    attributes_json    nvarchar(max) NULL,
    is_active          bit           NOT NULL DEFAULT 1,
    created_at         datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at        datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id   int           NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 4: core.* FACT TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.DrillingOperation', N'U') IS NULL
CREATE TABLE core.DrillingOperation (
    operation_id           bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DrillingOperation PRIMARY KEY,
    well_key               bigint        NULL,
    work_center_id         int           NULL,
    activity_id            int           NULL,
    status_id              int           NULL,
    earliest_start_date_key int          NULL,
    earliest_end_date_key  int           NULL,
    sequence_no            smallint      NULL,
    operation_text         varchar(100)  NULL,
    normal_duration        decimal(9,2)  NULL,
    duration_unit_id       int           NULL,
    move_days              tinyint       NULL,
    source_week            date          NULL,
    is_active              bit           NOT NULL DEFAULT 1,
    created_at             datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at            datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id       int           NULL
);
GO

IF OBJECT_ID(N'core.ProgressSnapshot', N'U') IS NULL
CREATE TABLE core.ProgressSnapshot (
    progress_snapshot_id bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ProgressSnapshot PRIMARY KEY,
    date_key           int           NULL,
    well_key           bigint        NULL,
    well_scope_key     int           NULL,
    loc_prep_status_id int           NULL,
    flowline_status_id int           NULL,
    comm_status_id     int           NULL,
    overall_progress   decimal(5,4)  NULL,
    overall_progress_percentage decimal(7,4) NULL,
    remarks_area_of_attention_issues nvarchar(2000) NULL,
    digital_wmr_import_remarks nvarchar(2000) NULL,
    created_at         datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id   int           NULL
);
GO

IF OBJECT_ID(N'core.ProgressDetail', N'U') IS NULL
CREATE TABLE core.ProgressDetail (
    progress_detail_id                                    bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ProgressDetail PRIMARY KEY,
    progress_snapshot_id                                  bigint        NULL,
    date_key                                              int           NULL,
    well_scope_key                                        int           NULL,
    activity_id                                           int           NULL,
    value                                                 decimal(5,4)  NULL,
    Flowline_Construction_Progress_Value                   decimal(5,4)  NULL,
    Ohl_Progress_Value                                    decimal(5,4)  NULL,
    Flow_Line_Test_Pack_Completion_Progress_Value          decimal(5,4)  NULL,
    Access_Road_5_Value                                   decimal(5,4)  NULL,
    Earth_Work_60_Value                                   decimal(5,4)  NULL,
    Cellar_20_Value                                       decimal(5,4)  NULL,
    Beam_Pump_Base_Esp_Pcp_Foundation_5_Value              decimal(5,4)  NULL,
    Earthing_1_Value                                      decimal(5,4)  NULL,
    Septic_Tank_1_Value                                   decimal(5,4)  NULL,
    Water_2_Value                                         decimal(5,4)  NULL,
    Waste_Water_2_Value                                   decimal(5,4)  NULL,
    Hdpe_Liner_Instalat_4_Value                           decimal(5,4)  NULL,
    Overall_Loc_Preparation_10_100_Value                   decimal(5,4)  NULL,
    Site_Survey_5_Value                                   decimal(5,4)  NULL,
    Survey_Report_Issue_5_Value                           decimal(5,4)  NULL,
    Design_Sta_5_Value                                    decimal(5,4)  NULL,
    Design_Completed_Issue_For_Ta2_5_40_Value             decimal(5,4)  NULL,
    Approved_By_15_Value                                  decimal(5,4)  NULL,
    Afc_3_30_Value                                        decimal(5,4)  NULL,
    Overall_Engg_10_100_Value                             decimal(5,4)  NULL,
    Piping_Mech_50_Value                                  decimal(5,4)  NULL,
    Elect_30_Value                                        decimal(5,4)  NULL,
    Instr_20_Value                                        decimal(5,4)  NULL,
    Overall_Material_10_100_Value                         decimal(5,4)  NULL,
    Cold_B_2_Value                                        decimal(5,4)  NULL,
    Sleeper_Pre_Cast_Ins_15_Value                         decimal(5,4)  NULL,
    Cs_Pipe_Welding_Ndt_10_Rt_For_Op_100_For_60_Value     decimal(5,4)  NULL,
    Pe_Fussion_Pull_20_Value                              decimal(5,4)  NULL,
    Final_Hydro_T_3_Value                                 decimal(5,4)  NULL,
    Overall_Const_10_100_Value                            decimal(5,4)  NULL,
    Pole_Hole_Drill_40_Value                              decimal(5,4)  NULL,
    Pole_Erect_40_Value                                   decimal(5,4)  NULL,
    Conductor_String_18_Value                             decimal(5,4)  NULL,
    Ohl_Ti_2_Value                                        decimal(5,4)  NULL,
    Overall_Ohl_Progr_100_Value                           decimal(5,4)  NULL,
    Mechani_60_Value                                      decimal(5,4)  NULL,
    Electri_15_Value                                      decimal(5,4)  NULL,
    Instrumentat_20_Value                                 decimal(5,4)  NULL,
    Overall_Comm_Mi_5_Value                               decimal(5,4)  NULL,
    Overall_Comm_Progress_100_Value                       decimal(5,4)  NULL,
    Progress_Value                                        decimal(7,4)  NULL,
    created_at                                            datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id                                      int           NULL
);
GO

IF OBJECT_ID(N'core.ScheduleTaskSnapshot', N'U') IS NULL
CREATE TABLE core.ScheduleTaskSnapshot (
    task_snapshot_id   bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ScheduleTaskSnapshot PRIMARY KEY,
    task_key           bigint        NULL,
    date_key           int           NULL,
    progress           decimal(5,4)  NULL,
    remaining_duration smallint      NULL,
    planned_start      datetime2(3)  NULL,
    planned_end        datetime2(3)  NULL,
    target_start       datetime2(3)  NULL,
    target_end         datetime2(3)  NULL,
    actual_start       datetime2(3)  NULL,
    actual_end         datetime2(3)  NULL,
    qty_planned        decimal(12,3) NULL,
    qty_actual         decimal(12,3) NULL,
    qty_forecast       decimal(12,3) NULL,
    manhours_planned   decimal(12,4) NULL,
    manhours_actual    decimal(12,4) NULL,
    manhours_forecast  decimal(12,4) NULL,
    created_at         datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id   int           NULL
);
GO

IF OBJECT_ID(N'core.WellDeliveryEvent', N'U') IS NULL
CREATE TABLE core.WellDeliveryEvent (
    event_id                        bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_WellDeliveryEvent PRIMARY KEY,
    well_key                        bigint        NULL,
    well_scope_key                  int           NULL,
    event_type_id                   int           NULL,
     planned_date_key                datetime2(3)  NULL,
    actual_date_key                 datetime2(3)  NULL,
    variance_days                   int           NULL,
    Location_Start_Date             datetime2(3)  NULL,
    Esp_Cable_Odc_Request_Date      datetime2(3)  NULL,
    Esp_Cable_Callout_Date          datetime2(3)  NULL,
    Esp_Cable_Delivery_Date         datetime2(3)  NULL,
    Esp_Cable_Install_Date          datetime2(3)  NULL,
    Location_Finish_Date            datetime2(3)  NULL,
    Edm_Location_Name_Added_Date    datetime2(3)  NULL,
    Esp_Prelim_Design_Request_Date  datetime2(3)  NULL,
    Esp_Skid_Vendor_Request_Date    datetime2(3)  NULL,
    Esp_Skid_Delivery_Date          datetime2(3)  NULL,
    Esp_Skid_Install_Date           datetime2(3)  NULL,
    Tie_In_Port_Ready_Date          datetime2(3)  NULL,
    Engineering_Start_Date          datetime2(3)  NULL,
    Engineering_Finish_Date         datetime2(3)  NULL,
    Construction_Start_Date         datetime2(3)  NULL,
    Construction_Complete_Date      datetime2(3)  NULL,
    Ohl_Complete_Date               datetime2(3)  NULL,
    Sap_Notif_Z6_Date               datetime2(3)  NULL,
    Rig_On_Date                     datetime2(3)  NULL,
    Rig_Off_Date                    datetime2(3)  NULL,
    Wlctf_Acceptance_Date           datetime2(3)  NULL,
    Hoist_On_Date                   datetime2(3)  NULL,
    Hoist_Off_Date                  datetime2(3)  NULL,
    Wellpad_Handover_Date           datetime2(3)  NULL,
    Eng_Completion_Date             datetime2(3)  NULL,
    Commissioning_Start_Date        datetime2(3)  NULL,
    Commissioning_Finish_Date       datetime2(3)  NULL,
    Esp_Cable_Odc_Install_Request_Date datetime2(3) NULL,
    Rig_On_Expected_Date           datetime2(3)  NULL,
    Rig_Off_Expected_Date          datetime2(3)  NULL,
    EspCableOdcRequestDate_toInstall_esp_pcp_skid datetime2(3) NULL,
    is_active                       bit           NOT NULL DEFAULT 1,
    created_at                      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at                     datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id                int           NULL
);
GO

IF OBJECT_ID(N'core.WellDocument', N'U') IS NULL
CREATE TABLE core.WellDocument (
    document_id                int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_WellDocument PRIMARY KEY,
    well_scope_key             int           NULL,
    doc_type_id                int           NULL,
    doc_status_id              int           NULL,
    issue_date_key             int           NULL,
    doc_no                     varchar(50)   NULL,
    Flaf_Date                  datetime2(3)  NULL,
    Ramz_Date                  datetime2(3)  NULL,
    Site_Survey_Report_Date    datetime2(3)  NULL,
    Rlmu_Date                  datetime2(3)  NULL,
    Fl_Test_Pack_Date          datetime2(3)  NULL,
    is_active                  bit           NOT NULL DEFAULT 1,
    created_at                 datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at                datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id           int           NULL
);
GO

IF OBJECT_ID(N'core.WellProcurement', N'U') IS NULL
CREATE TABLE core.WellProcurement (
    po_id              bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_WellProcurement PRIMARY KEY,
    well_scope_key     int           NULL,
    material_available_date_key int  NULL,
    po_category        varchar(20)   NULL,
    location_po_received_date_key int NULL,
    material_po_received_date_key int NULL,
    f_l_po_received_date_key int   NULL,
    location_po_no   varchar(20)   NULL,
    flow_line_po_no  varchar(20)   NULL,
    location_purpose_value varchar(100) NULL,
    flowline_purpose_value varchar(100) NULL,
    is_active          bit           NOT NULL DEFAULT 1,
    created_at         datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at        datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id   int           NULL
);
GO

IF OBJECT_ID(N'core.CrewProductivity', N'U') IS NULL
CREATE TABLE core.CrewProductivity (
    crew_productivity_id bigint      IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_CrewProductivity PRIMARY KEY,
    date_key           int           NULL,
    crew_id            int           NULL,
    crew_type_id       int           NULL,
    employee_id        int           NULL,
    company_id         int           NULL,
    pi_cmr             decimal(6,2)  NULL,
    pi_twise           decimal(6,2)  NULL,
    avg_productivity_pct decimal(7,2) NULL,
    is_active          bit           NOT NULL DEFAULT 1,
    created_at         datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at        datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id   int           NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 5: core.* BRIDGE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.OperationDependency', N'U') IS NULL
CREATE TABLE core.OperationDependency (
    edge_id                   bigint       IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_OperationDependency PRIMARY KEY,
    predecessor_operation_id  bigint       NULL,
    successor_operation_id    bigint       NULL,
    link_type                 char(2)      NULL,
    lag_days                  decimal(6,2) NULL,
    is_active                 bit          NOT NULL DEFAULT 1,
    created_at                datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at               datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id          int          NULL
);
GO

IF OBJECT_ID(N'core.CrewEmployee', N'U') IS NULL
CREATE TABLE core.CrewEmployee (
    crew_employee_id int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_CrewEmployee PRIMARY KEY,
    crew_id          int           NULL,
    employee_id      int           NULL,
    employee_type_id int           NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'core.CrewEquipment', N'U') IS NULL
CREATE TABLE core.CrewEquipment (
    crew_equipment_id int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_CrewEquipment PRIMARY KEY,
    crew_id          int           NULL,
    equipment_id     int           NULL,
    equipment_type_id int          NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

IF OBJECT_ID(N'core.TaskCrew', N'U') IS NULL
CREATE TABLE core.TaskCrew (
    task_crew_id     int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_TaskCrew PRIMARY KEY,
    task_key         bigint        NULL,
    crew_id          int           NULL,
    project_key      bigint        NULL,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 5b: core.* WORKFORCE FACT TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.TaskDaily', N'U') IS NULL
CREATE TABLE core.TaskDaily (
    task_daily_id    int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_TaskDaily PRIMARY KEY,
    action_on        date          NOT NULL,
    task_code        varchar(100)  NULL,
    project_id       bigint        NULL,
    task_assignee    nvarchar(500) NULL,
    data_qty         decimal(18,6) NULL,
    data_hours       decimal(18,6) NULL,
    source_system_id int           NULL,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    crew_type_id     int           NULL,
    supervisor_email varchar(200)  NULL
);
GO

IF OBJECT_ID(N'core.CrewActivityNorms', N'U') IS NULL
CREATE TABLE core.CrewActivityNorms (
    crew_activity_norm_id bigint    IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_CrewActivityNorms PRIMARY KEY,
    is_active        bit           NOT NULL DEFAULT 1,
    created_at       datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_at      datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    source_system_id int           NULL,
    activity_id      varchar(50)   NULL,
    old_activity_code varchar(100) NULL,
    new_activity_code varchar(100) NULL,
    new_crew_code    varchar(100)  NULL,
    unit             varchar(20)   NULL,
    norm             decimal(18,6) NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 6: ml.* AI TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'ml.FeatureStore', N'U') IS NULL
CREATE TABLE ml.FeatureStore (
    feature_row_id   bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_ml_FeatureStore PRIMARY KEY,
    well_key         bigint        NULL,
    as_of_date       date          NULL,
    features_json    nvarchar(max) NULL
);
GO

IF OBJECT_ID(N'ml.WellVector', N'U') IS NULL
CREATE TABLE ml.WellVector (
    well_vector_id   bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_ml_WellVector PRIMARY KEY,
    well_key         bigint        NULL,
    embedding        varbinary(max) NULL,
    built_at         datetime2(3)  NULL
);
GO

IF OBJECT_ID(N'ml.Model', N'U') IS NULL
CREATE TABLE ml.Model (
    model_id         bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_ml_Model PRIMARY KEY,
    feature_code     varchar(40)   NULL,
    version          varchar(20)   NULL,
    trained_at       datetime2(3)  NULL,
    artifact_ref     varchar(200)  NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 7: meta + raw SYSTEM TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'meta.SchemaInfo', N'U') IS NULL
CREATE TABLE meta.SchemaInfo (
    schema_info_id    int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_meta_SchemaInfo PRIMARY KEY,
    schema_version_no varchar(20)   NULL,
    built_at          datetime2(3)  NULL,
    migrated_at       datetime2(3)  NULL
);
GO

IF OBJECT_ID(N'raw.SourceLanding', N'U') IS NULL
CREATE TABLE raw.SourceLanding (
    load_run_id      bigint        NULL,
    payload          nvarchar(max) NULL
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 8: core.* APPLICATION TABLES (Reports / Widgets)
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.Category', N'U') IS NULL
CREATE TABLE core.Category (
    CategoryId       int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_Category PRIMARY KEY,
    CategoryName     varchar(200)  NOT NULL,
    Description      varchar(500)  NULL,
    ControlType      varchar(50)   NOT NULL DEFAULT '',
    IsActive         bit           NOT NULL DEFAULT 1,
    IsDeleted        bit           NOT NULL DEFAULT 0,
    CreatedAt        datetime2(7)  NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedAt       datetime2(7)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy        nvarchar(200) NULL,
    ModifiedBy       nvarchar(200) NULL,
    DeletedBy        nvarchar(200) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Category_Name_Type' AND object_id = OBJECT_ID('core.Category'))
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Category_Name' AND object_id = OBJECT_ID('core.Category'))
        DROP INDEX UQ_Category_Name ON core.Category;
    CREATE UNIQUE INDEX UQ_Category_Name_Type ON core.Category (CategoryName, ControlType) WHERE IsDeleted = 0;
END
GO

-- Seed default Category row if not present
IF NOT EXISTS (SELECT 1 FROM core.Category WHERE CategoryName = 'Others' AND ControlType = 'dashboard')
    INSERT INTO core.Category (CategoryName, Description, ControlType, IsActive, IsDeleted, CreatedAt, ModifiedAt)
    VALUES ('Others', 'Default category', 'dashboard', 1, 0, SYSUTCDATETIME(), SYSUTCDATETIME());
GO

IF OBJECT_ID(N'core.Reports', N'U') IS NULL
CREATE TABLE core.Reports (
    Id               bigint        IDENTITY(1,1) NOT NULL,
    ReportName       nvarchar(200) NOT NULL,
    SourceName       nvarchar(200) NOT NULL,
    SourceType       nvarchar(20)  NOT NULL,
    ReportJson       nvarchar(max) NULL,
    Status           nvarchar(20)  NOT NULL CONSTRAINT DF_Reports_Status    DEFAULT N'draft',
    PublishedOn      datetime2(7)  NULL,
    IsDeleted        bit           NOT NULL CONSTRAINT DF_Reports_IsDeleted DEFAULT 0,
    CreatedBy        bigint        NOT NULL,
    TenantId         bigint        NOT NULL,
    CategoryId       int           NOT NULL,
    CreatedAt        datetime2(7)  NOT NULL CONSTRAINT DF_Reports_CreatedAt DEFAULT GETUTCDATE(),
    UpdatedAt        datetime2(7)  NOT NULL CONSTRAINT DF_Reports_UpdatedAt DEFAULT GETUTCDATE(),

    CONSTRAINT PK_Reports PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Reports_Category_CategoryId
        FOREIGN KEY (CategoryId) REFERENCES core.Category (CategoryId)
        ON DELETE NO ACTION
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reports_ReportName_SourceName_CreatedBy' AND object_id = OBJECT_ID(N'core.Reports'))
    CREATE UNIQUE INDEX IX_Reports_ReportName_SourceName_CreatedBy
        ON core.Reports (ReportName, SourceName, CreatedBy)
        WHERE IsDeleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reports_CategoryId' AND object_id = OBJECT_ID(N'core.Reports'))
    CREATE INDEX IX_Reports_CategoryId ON core.Reports (CategoryId);
GO

IF OBJECT_ID(N'core.Widgets', N'U') IS NULL
CREATE TABLE core.Widgets (
    Id               bigint        IDENTITY(1,1) NOT NULL,
    Name             nvarchar(200) NOT NULL,
    Type             nvarchar(20)  NOT NULL,
    LibraryId        int           NULL,
    Source           nvarchar(200) NOT NULL,
    SourceType       nvarchar(20)  NOT NULL,
    DesignJson       nvarchar(max) NULL,
    Status           nvarchar(20)  NOT NULL CONSTRAINT DF_Widgets_Status     DEFAULT N'draft',
    IsDeleted        bit           NOT NULL CONSTRAINT DF_Widgets_IsDeleted  DEFAULT 0,
    TenantId         bigint        NOT NULL,
    CreatedBy        bigint        NOT NULL,
    CreatedAt        datetime2(7)  NOT NULL CONSTRAINT DF_Widgets_CreatedAt  DEFAULT GETUTCDATE(),
    ModifiedBy       bigint        NULL,
    ModifiedOn       datetime2(7)  NOT NULL CONSTRAINT DF_Widgets_ModifiedOn DEFAULT GETUTCDATE(),
    CategoryId       int           NULL,

    CONSTRAINT PK_Widgets PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_Widgets_Category_CategoryId
        FOREIGN KEY (CategoryId) REFERENCES core.Category (CategoryId)
        ON DELETE SET NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Widgets_TenantId_CreatedBy' AND object_id = OBJECT_ID(N'core.Widgets'))
    CREATE INDEX IX_Widgets_TenantId_CreatedBy
        ON core.Widgets (TenantId, CreatedBy)
        WHERE IsDeleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Widgets_CategoryId' AND object_id = OBJECT_ID(N'core.Widgets'))
    CREATE INDEX IX_Widgets_CategoryId ON core.Widgets (CategoryId);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 8b: core.* DASHBOARD TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.Dashboard', N'U') IS NULL
CREATE TABLE core.Dashboard (
    DashboardId      int           IDENTITY(1,1) NOT NULL CONSTRAINT PK_Dashboard PRIMARY KEY,
    DashboardName    varchar(100)  NOT NULL,
    CategoryId       int           NOT NULL,
    Status           varchar(20)   NOT NULL DEFAULT 'In Progress',
    Description      varchar(500)  NULL,
    ConfigJson       nvarchar(max) NULL,
    IsActive         bit           NOT NULL DEFAULT 1,
    IsDeleted        bit           NOT NULL DEFAULT 0,
    CreatedAt        datetime2(7)  NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedAt       datetime2(7)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy        nvarchar(200) NULL,
    ModifiedBy       nvarchar(200) NULL,
    PublishedBy      nvarchar(200) NULL,
    DeletedBy        nvarchar(200) NULL,

    CONSTRAINT FK_Dashboard_Category
        FOREIGN KEY (CategoryId) REFERENCES core.Category (CategoryId)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_Dashboard_Name_Category' AND object_id = OBJECT_ID('core.Dashboard'))
    CREATE UNIQUE INDEX UQ_Dashboard_Name_Category ON core.Dashboard (DashboardName, CategoryId) WHERE IsDeleted = 0;
GO

IF OBJECT_ID(N'ref.DashboardWidget', N'U') IS NULL
CREATE TABLE ref.DashboardWidget (
    DashboardWidgetId int          IDENTITY(1,1) NOT NULL CONSTRAINT PK_DashboardWidget PRIMARY KEY,
    DashboardId      int           NOT NULL,
    ChartId          int           NOT NULL,
    SortOrder        int           NOT NULL DEFAULT 0,
    IsDeleted        bit           NOT NULL DEFAULT 0,
    CreatedAt        datetime2(7)  NOT NULL DEFAULT SYSUTCDATETIME(),
    ModifiedAt       datetime2(7)  NOT NULL DEFAULT SYSUTCDATETIME(),
    CreatedBy        nvarchar(200) NULL,
    ModifiedBy       nvarchar(200) NULL,
    DeletedBy        nvarchar(200) NULL,
    WidgetConfig     nvarchar(max) NULL,

    CONSTRAINT FK_DashboardWidget_Dashboard
        FOREIGN KEY (DashboardId) REFERENCES core.Dashboard (DashboardId)
);
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 9: core.* APPLICATION CONFIGURATION TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

IF OBJECT_ID(N'core.DatabaseConnections', N'U') IS NULL
CREATE TABLE core.DatabaseConnections (
    id                      bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DatabaseConnections PRIMARY KEY,
    connection_name         varchar(100)  NOT NULL,
    server                  varchar(200)  NOT NULL,
    port                    int           NOT NULL DEFAULT 1433,
    database_name           varchar(128)  NOT NULL,
    username                varchar(128)  NOT NULL,
    password_hash           varchar(500)  NOT NULL,
    provider                varchar(20)   NOT NULL DEFAULT 'mssql',
    trust_server_certificate bit          NULL DEFAULT 1,
    is_active               bit           NOT NULL DEFAULT 1,
    tenant_id               bigint        NOT NULL,
    created_by              bigint        NOT NULL,
    created_at              datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by             bigint        NULL,
    modified_at             datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted              bit           NOT NULL DEFAULT 0
);
GO

-- Unique connection name per tenant (only non-deleted)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_DatabaseConnections_tenant_name')
CREATE UNIQUE INDEX UQ_core_DatabaseConnections_tenant_name
    ON core.DatabaseConnections (tenant_id, connection_name)
    WHERE is_deleted = 0;
GO

IF OBJECT_ID(N'core.DatabaseSchema', N'U') IS NULL
CREATE TABLE core.DatabaseSchema (
    id                      bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DatabaseSchema PRIMARY KEY,
    connection_id           bigint        NOT NULL,
    schema_name             varchar(128)  NOT NULL,
    table_name              varchar(128)  NOT NULL,
    column_name             varchar(128)  NOT NULL,
    data_type               varchar(50)   NOT NULL,
    is_nullable             bit           NOT NULL DEFAULT 1,
    is_primary_key          bit           NOT NULL DEFAULT 0,
    is_foreign_key          bit           NOT NULL DEFAULT 0,
    foreign_key_schema      varchar(128)  NULL,
    foreign_key_table       varchar(128)  NULL,
    foreign_key_column      varchar(128)  NULL,
    max_length              int           NULL,
    ordinal_position        int           NOT NULL DEFAULT 0,
    tenant_id               bigint        NOT NULL,
    synced_at               datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted              bit           NOT NULL DEFAULT 0,
    CONSTRAINT FK_DatabaseSchema_Connection FOREIGN KEY (connection_id)
        REFERENCES core.DatabaseConnections (id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_DatabaseSchema_connection')
CREATE INDEX IX_core_DatabaseSchema_connection
    ON core.DatabaseSchema (connection_id, schema_name, table_name)
    WHERE is_deleted = 0;
GO

IF OBJECT_ID(N'core.DatabaseViews', N'U') IS NULL
CREATE TABLE core.DatabaseViews (
    id                      bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DatabaseViews PRIMARY KEY,
    connection_id           bigint        NOT NULL,
    view_name               varchar(128)  NOT NULL,
    description             varchar(500)  NULL,
    is_distinct             bit           NOT NULL DEFAULT 0,
    tables_json             nvarchar(max) NOT NULL,
    joins_json              nvarchar(max) NOT NULL,
    selected_columns_json   nvarchar(max) NOT NULL,
    column_aliases_json     nvarchar(max) NULL,
    filters_json            nvarchar(max) NULL,
    generated_sql           nvarchar(max) NOT NULL,
    manual_sql              nvarchar(max) NULL,
    preview_data_json       nvarchar(max) NULL,
    preview_columns_json    nvarchar(max) NULL,
    preview_row_count       int           NULL,
    preview_executed_at     datetime2(3)  NULL,
    tables_used             varchar(500)  NOT NULL,
    column_count            int           NOT NULL DEFAULT 0,
    row_count               bigint        NULL,
    source_type             varchar(20)   NOT NULL DEFAULT 'custom',
    tenant_id               bigint        NOT NULL,
    created_by              bigint        NOT NULL,
    created_at              datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by             bigint        NULL,
    modified_at             datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted              bit           NOT NULL DEFAULT 0,
    view_type               nvarchar(20)  NOT NULL CONSTRAINT DF_DatabaseViews_ViewType DEFAULT 'view',
    referenced_cte_ids_json nvarchar(max) NULL,
    referenced_component_ids_json nvarchar(max) NULL,
    reliability             decimal(5,2)  NULL,
    CONSTRAINT FK_DatabaseViews_Connection FOREIGN KEY (connection_id)
        REFERENCES core.DatabaseConnections (id)
);
GO

-- Add newer columns to existing tenant databases (idempotent)
IF COL_LENGTH('core.DatabaseViews', 'view_type') IS NULL
    ALTER TABLE core.DatabaseViews
        ADD view_type nvarchar(20) NOT NULL CONSTRAINT DF_DatabaseViews_ViewType DEFAULT 'view';
GO

IF COL_LENGTH('core.DatabaseViews', 'referenced_cte_ids_json') IS NULL
    ALTER TABLE core.DatabaseViews ADD referenced_cte_ids_json nvarchar(max) NULL;
GO

IF COL_LENGTH('core.DatabaseViews', 'referenced_component_ids_json') IS NULL
    ALTER TABLE core.DatabaseViews ADD referenced_component_ids_json nvarchar(max) NULL;
GO

IF COL_LENGTH('core.DatabaseViews', 'reliability') IS NULL
    ALTER TABLE core.DatabaseViews ADD reliability decimal(5,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_DatabaseViews_tenant_name')
CREATE UNIQUE INDEX UQ_core_DatabaseViews_tenant_name
    ON core.DatabaseViews (tenant_id, view_name)
    WHERE is_deleted = 0;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- AI: per-tenant LLM settings and usage log (see infra/sql/add-ai-settings.sql)
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('core.AiSettings', 'U') IS NULL
CREATE TABLE core.AiSettings (
    id                 bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiSettings PRIMARY KEY,
    tenant_id          bigint         NOT NULL CONSTRAINT UQ_core_AiSettings_tenant UNIQUE,
    is_enabled        bit            NOT NULL CONSTRAINT DF_core_AiSettings_enabled DEFAULT 0,
    prompts_json       nvarchar(max)  NULL,       -- no longer used: AI prompts are in core.AiPrompt
    row_ver            rowversion     NOT NULL,   -- changes on every update
    -- Ask Data: what it may read and its limits (Settings → AI Settings; see infra/sql/add-ai-askdata-settings.sql).
    -- No schemas = not set up: Ask Data refuses until an admin chooses them.
    askdata_allowed_schemas  nvarchar(max) NULL,   -- JSON array of schema names
    askdata_excluded_tables  nvarchar(max) NULL,   -- JSON array: schema.table | table
    askdata_excluded_columns nvarchar(max) NULL,   -- JSON array: schema.table.column | table.column | column
    askdata_max_rows         int           NOT NULL CONSTRAINT DF_core_AiSettings_askdata_max_rows DEFAULT 500,
    askdata_query_timeout    int           NOT NULL CONSTRAINT DF_core_AiSettings_askdata_timeout DEFAULT 60,
    askdata_max_queries      int           NOT NULL CONSTRAINT DF_core_AiSettings_askdata_max_queries DEFAULT 3,
    askdata_sql_retries      int           NOT NULL CONSTRAINT DF_core_AiSettings_askdata_sql_retries DEFAULT 2,
    askdata_verify_retries   int           NOT NULL CONSTRAINT DF_core_AiSettings_askdata_verify_retries DEFAULT 1,
    askdata_history_turns    int           NOT NULL CONSTRAINT DF_core_AiSettings_askdata_history DEFAULT 3,
    askdata_org_name         nvarchar(200) NULL,
    askdata_export_prefix    nvarchar(40)  NULL,
    askdata_chat_mode        nvarchar(10)  NOT NULL CONSTRAINT DF_core_AiSettings_askdata_chat_mode DEFAULT 'deep'
                             CONSTRAINT CK_core_AiSettings_askdata_chat_mode CHECK (askdata_chat_mode IN ('deep', 'normal')),
                             -- how the Ask your data chatbot answers; agents choose per step
    -- Agentic Features: each feature's settings and the tables it may read (Settings → AI Settings). NULL = defaults.
    slippage_settings_json    nvarchar(max) NULL,
    dailyreport_settings_json nvarchar(max) NULL,
    anomaly_settings_json     nvarchar(max) NULL,
    created_by         nvarchar(100)  NULL,
    created_at         datetime2      NOT NULL CONSTRAINT DF_core_AiSettings_created DEFAULT SYSUTCDATETIME(),
    modified_by        nvarchar(100)  NULL,
    modified_at        datetime2      NOT NULL CONSTRAINT DF_core_AiSettings_modified DEFAULT SYSUTCDATETIME(),
    is_deleted         bit            NOT NULL CONSTRAINT DF_core_AiSettings_deleted DEFAULT 0
);
GO

-- Every version of every AI prompt (Settings → AI Prompts). Version 1 of a key is its original text ('seed'),
-- copied in by the Tenant API the first time the tenant needs the prompt.
IF OBJECT_ID('core.AiPromptHistory', 'U') IS NULL
CREATE TABLE core.AiPromptHistory (
    id                 bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiPromptHistory PRIMARY KEY,
    tenant_id          bigint         NOT NULL,
    prompt_key         nvarchar(100)  NOT NULL,
    version_no         int            NOT NULL,
    body               nvarchar(max)  NOT NULL,
    action             nvarchar(20)   NOT NULL,       -- seed | update | restore
    note               nvarchar(400)  NULL,
    changed_by         nvarchar(200)  NOT NULL,
    changed_at         datetime2      NOT NULL CONSTRAINT DF_core_AiPromptHistory_changed DEFAULT SYSUTCDATETIME(),
    is_current         bit            NOT NULL,
    CONSTRAINT UQ_core_AiPromptHistory_version UNIQUE (tenant_id, prompt_key, version_no),
    CONSTRAINT CK_core_AiPromptHistory_action CHECK (action IN ('seed', 'update', 'restore'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_AiPromptHistory_current' AND object_id = OBJECT_ID('core.AiPromptHistory'))
CREATE UNIQUE INDEX UX_core_AiPromptHistory_current ON core.AiPromptHistory (tenant_id, prompt_key) WHERE is_current = 1;
GO

-- The active text of every AI prompt: one row per prompt, always the history's live version (version_no).
-- Copied in by the Tenant API the first time the tenant needs the prompt (see infra/sql/add-ai-prompt-table.sql).
IF OBJECT_ID('core.AiPrompt', 'U') IS NULL
CREATE TABLE core.AiPrompt (
    id                 bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiPrompt PRIMARY KEY,
    tenant_id          bigint         NOT NULL,
    prompt_key         nvarchar(100)  NOT NULL,
    body               nvarchar(max)  NOT NULL,
    version_no         int            NOT NULL,       -- the live version in core.AiPromptHistory
    modified_by        nvarchar(200)  NOT NULL,
    modified_at        datetime2      NOT NULL CONSTRAINT DF_core_AiPrompt_modified DEFAULT SYSUTCDATETIME(),
    row_ver            rowversion     NOT NULL,       -- changes on every update: the Tenant API's prompt cache key
    CONSTRAINT UQ_core_AiPrompt_key UNIQUE (tenant_id, prompt_key)
);
GO

-- Agentic Features (Agentic AI → Agentic Features): verified SQL, Data Anomaly rules / probes / runs / reports /
-- proposals, and long operations (see infra/sql/add-agentic-features.sql).
IF OBJECT_ID('core.AiFeatureQuery', 'U') IS NULL
    CREATE TABLE core.AiFeatureQuery (
        id           bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiFeatureQuery PRIMARY KEY,
        tenant_id    bigint         NOT NULL,
        feature      nvarchar(40)   NOT NULL,
        query_key    nvarchar(80)   NOT NULL,
        label        nvarchar(200)  NOT NULL,
        description  nvarchar(1000) NULL,
        sql_text     nvarchar(max)  NOT NULL,
        params_json  nvarchar(1000) NOT NULL CONSTRAINT DF_core_AiFeatureQuery_params DEFAULT N'[]',
        columns_json nvarchar(max)  NOT NULL CONSTRAINT DF_core_AiFeatureQuery_columns DEFAULT N'[]',
        seed_hash    char(64)       NULL,
        modified_by  nvarchar(200)  NOT NULL,
        modified_at  datetime2      NOT NULL CONSTRAINT DF_core_AiFeatureQuery_modified DEFAULT SYSUTCDATETIME(),
        row_ver      rowversion     NOT NULL,
        CONSTRAINT UQ_core_AiFeatureQuery_key UNIQUE (tenant_id, feature, query_key)
    );
GO

IF OBJECT_ID('core.AnomalyRule', 'U') IS NULL
    CREATE TABLE core.AnomalyRule (
        id              bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyRule PRIMARY KEY,
        tenant_id       bigint         NOT NULL,
        rule_id         nvarchar(80)   NOT NULL,
        title           nvarchar(400)  NOT NULL,
        category        nvarchar(100)  NULL,
        severity        nvarchar(20)   NOT NULL,
        status          nvarchar(20)   NOT NULL,       -- active | probation | draft | disabled | rejected
        source          nvarchar(20)   NOT NULL,       -- declared | discovered
        definition_json nvarchar(max)  NOT NULL,       -- the whole rule (prose, method, parameters, tags…)
        seed_hash       char(64)       NULL,
        created_by      nvarchar(200)  NOT NULL,
        created_at      datetime2      NOT NULL CONSTRAINT DF_core_AnomalyRule_created DEFAULT SYSUTCDATETIME(),
        modified_by     nvarchar(200)  NOT NULL,
        modified_at     datetime2      NOT NULL CONSTRAINT DF_core_AnomalyRule_modified DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_AnomalyRule_rule UNIQUE (tenant_id, rule_id),
        CONSTRAINT CK_core_AnomalyRule_status CHECK (status IN ('active', 'probation', 'draft', 'disabled', 'rejected')),
        CONSTRAINT CK_core_AnomalyRule_severity CHECK (severity IN ('critical', 'high', 'medium', 'low'))
    );
GO

IF OBJECT_ID('core.AnomalyProbe', 'U') IS NULL
    CREATE TABLE core.AnomalyProbe (
        id           bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyProbe PRIMARY KEY,
        tenant_id    bigint         NOT NULL,
        probe_id     nvarchar(200)  NOT NULL,          -- the rule id, or rule id + family member
        rule_id      nvarchar(80)   NOT NULL,
        status       nvarchar(20)   NOT NULL,          -- active | failed | not_applicable
        probe_json   nvarchar(max)  NOT NULL,          -- summary / detail SQL, fingerprints, reviewer notes…
        compiled_at  datetime2      NOT NULL,
        CONSTRAINT UQ_core_AnomalyProbe_probe UNIQUE (tenant_id, probe_id)
    );
GO

IF OBJECT_ID('core.AnomalyRun', 'U') IS NULL
    CREATE TABLE core.AnomalyRun (
        id                   bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyRun PRIMARY KEY,
        tenant_id            bigint         NOT NULL,
        run_id               nvarchar(40)   NOT NULL,
        status               nvarchar(20)   NOT NULL,  -- succeeded | failed
        database_name        nvarchar(200)  NULL,
        started_at           datetime2      NOT NULL,
        finished_at          datetime2      NULL,
        score                decimal(6, 2)  NULL,
        probes_run           int            NULL,
        records_examined     bigint         NULL,
        records_flagged      bigint         NULL,
        rule_set_fingerprint nvarchar(40)   NULL,
        result_json          nvarchar(max)  NULL,       -- totals, ranked findings, coverage gaps, AI summary…
        error                nvarchar(4000) NULL,
        started_by           nvarchar(200)  NOT NULL,
        CONSTRAINT UQ_core_AnomalyRun_run UNIQUE (tenant_id, run_id)
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AnomalyRun_started' AND object_id = OBJECT_ID('core.AnomalyRun'))
    CREATE INDEX IX_core_AnomalyRun_started ON core.AnomalyRun (tenant_id, started_at DESC);
GO

IF OBJECT_ID('core.AnomalyRunReport', 'U') IS NULL
    CREATE TABLE core.AnomalyRunReport (
        id          bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyRunReport PRIMARY KEY,
        tenant_id   bigint          NOT NULL,
        run_id      nvarchar(40)    NOT NULL,
        format      nvarchar(10)    NOT NULL,          -- xlsx | docx
        file_name   nvarchar(200)   NOT NULL,
        content     varbinary(max)  NOT NULL,
        size_bytes  bigint          NOT NULL,
        created_at  datetime2       NOT NULL CONSTRAINT DF_core_AnomalyRunReport_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_AnomalyRunReport UNIQUE (tenant_id, run_id, format),
        CONSTRAINT CK_core_AnomalyRunReport_format CHECK (format IN ('xlsx', 'docx'))
    );
GO

IF OBJECT_ID('core.AnomalyProposal', 'U') IS NULL
    CREATE TABLE core.AnomalyProposal (
        id             bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AnomalyProposal PRIMARY KEY,
        tenant_id      bigint         NOT NULL,
        proposal_hash  nvarchar(64)   NOT NULL,
        status         nvarchar(20)   NOT NULL,        -- pending | dropped | accepted | rejected
        title          nvarchar(400)  NOT NULL,
        proposal_json  nvarchar(max)  NOT NULL,
        rule_id        nvarchar(80)   NULL,            -- the rule it became when accepted
        reason         nvarchar(1000) NULL,
        decided_by     nvarchar(200)  NULL,
        decided_at     datetime2      NULL,
        created_at     datetime2      NOT NULL CONSTRAINT DF_core_AnomalyProposal_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_core_AnomalyProposal_hash UNIQUE (tenant_id, proposal_hash),
        CONSTRAINT CK_core_AnomalyProposal_status CHECK (status IN ('pending', 'dropped', 'accepted', 'rejected'))
    );
GO

IF OBJECT_ID('core.AiFeatureJob', 'U') IS NULL
    CREATE TABLE core.AiFeatureJob (
        id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiFeatureJob PRIMARY KEY,
        tenant_id     bigint         NOT NULL,
        feature       nvarchar(40)   NOT NULL,
        kind          nvarchar(40)   NOT NULL,         -- compile | run | discover
        status        nvarchar(20)   NOT NULL,         -- queued | running | succeeded | failed | cancelled
        request_json  nvarchar(max)  NULL,             -- options (rule ids, force, formats…)
        progress_json nvarchar(max)  NULL,             -- latest {stage, done, total, label}
        result_json   nvarchar(max)  NULL,             -- short outcome (ids, counts, run id)
        error         nvarchar(4000) NULL,
        requested_by  nvarchar(200)  NOT NULL,
        created_at    datetime2      NOT NULL CONSTRAINT DF_core_AiFeatureJob_created DEFAULT SYSUTCDATETIME(),
        started_at    datetime2      NULL,
        finished_at   datetime2      NULL,
        heartbeat_at  datetime2      NULL,
        CONSTRAINT CK_core_AiFeatureJob_status CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_AiFeatureJob_active' AND object_id = OBJECT_ID('core.AiFeatureJob'))
    CREATE UNIQUE INDEX UX_core_AiFeatureJob_active ON core.AiFeatureJob (tenant_id, feature)
        WHERE status IN ('queued', 'running');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiFeatureJob_recent' AND object_id = OBJECT_ID('core.AiFeatureJob'))
    CREATE INDEX IX_core_AiFeatureJob_recent ON core.AiFeatureJob (tenant_id, feature, created_at DESC);
GO

IF OBJECT_ID('core.AiProviders', 'U') IS NULL
CREATE TABLE core.AiProviders (
    id                 bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiProviders PRIMARY KEY,
    tenant_id          bigint         NOT NULL,
    name               nvarchar(100)  NOT NULL,
    provider           nvarchar(20)   NOT NULL,
    base_url           nvarchar(500)  NOT NULL,
    model              nvarchar(100)  NOT NULL,
    api_key_encrypted  nvarchar(1000) NULL,
    daily_quota        int            NOT NULL CONSTRAINT DF_core_AiProviders_quota DEFAULT 500,  -- calls per UTC day while active; 0 = unlimited
    is_active          bit            NOT NULL CONSTRAINT DF_core_AiProviders_active DEFAULT 0,
    created_by         nvarchar(100)  NULL,
    created_at         datetime2      NOT NULL CONSTRAINT DF_core_AiProviders_created DEFAULT SYSUTCDATETIME(),
    modified_by        nvarchar(100)  NULL,
    modified_at        datetime2      NOT NULL CONSTRAINT DF_core_AiProviders_modified DEFAULT SYSUTCDATETIME(),
    deleted_by         nvarchar(100)  NULL
    -- no is_deleted: providers are deleted for real (remove-ai-providers-soft-delete.sql)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiProviders_tenant')
CREATE INDEX IX_core_AiProviders_tenant ON core.AiProviders (tenant_id, is_active);
GO

IF OBJECT_ID('core.AiFeatureRoles', 'U') IS NULL
CREATE TABLE core.AiFeatureRoles (
    id           bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiFeatureRoles PRIMARY KEY,
    tenant_id    bigint        NOT NULL,
    feature_key  nvarchar(40)  NOT NULL,
    role_code    nvarchar(100) NOT NULL,
    CONSTRAINT UQ_core_AiFeatureRoles UNIQUE (tenant_id, feature_key, role_code)
);
GO

IF OBJECT_ID('core.AiUsageLog', 'U') IS NULL
CREATE TABLE core.AiUsageLog (
    id                 bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiUsageLog PRIMARY KEY,
    tenant_id          bigint         NOT NULL,
    user_id            nvarchar(100)  NULL,
    purpose            nvarchar(40)   NOT NULL,
    model              nvarchar(100)  NOT NULL,
    prompt_tokens      int            NOT NULL CONSTRAINT DF_core_AiUsageLog_pt DEFAULT 0,
    completion_tokens  int            NOT NULL CONSTRAINT DF_core_AiUsageLog_ct DEFAULT 0,
    latency_ms         int            NOT NULL CONSTRAINT DF_core_AiUsageLog_lat DEFAULT 0,
    succeeded          bit            NOT NULL CONSTRAINT DF_core_AiUsageLog_ok DEFAULT 0,
    error              nvarchar(1000) NULL,
    created_at         datetime2      NOT NULL CONSTRAINT DF_core_AiUsageLog_created DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiUsageLog_tenant_created')
CREATE INDEX IX_core_AiUsageLog_tenant_created ON core.AiUsageLog (tenant_id, created_at);
GO

IF OBJECT_ID('core.AiConversations', 'U') IS NULL
CREATE TABLE core.AiConversations (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiConversations PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    user_id       nvarchar(100)  NOT NULL,
    source_type   nvarchar(10)   NOT NULL,
    source_id     bigint         NOT NULL,
    source_name   nvarchar(200)  NOT NULL,
    title         nvarchar(120)  NOT NULL,
    created_at    datetime2      NOT NULL CONSTRAINT DF_core_AiConversations_created DEFAULT SYSUTCDATETIME(),
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiConversations_modified DEFAULT SYSUTCDATETIME(),
    is_deleted    bit            NOT NULL CONSTRAINT DF_core_AiConversations_deleted DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiConversations_tenant_user')
CREATE INDEX IX_core_AiConversations_tenant_user ON core.AiConversations (tenant_id, user_id, modified_at DESC);
GO

IF OBJECT_ID('core.AiChatMessages', 'U') IS NULL
CREATE TABLE core.AiChatMessages (
    id               bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiChatMessages PRIMARY KEY,
    conversation_id  bigint         NOT NULL CONSTRAINT FK_core_AiChatMessages_conversation REFERENCES core.AiConversations (id),
    role             nvarchar(10)   NOT NULL,
    content          nvarchar(max)  NOT NULL,
    query_spec_json  nvarchar(max)  NULL,
    created_at       datetime2      NOT NULL CONSTRAINT DF_core_AiChatMessages_created DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiChatMessages_conversation')
CREATE INDEX IX_core_AiChatMessages_conversation ON core.AiChatMessages (conversation_id, id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiChatMessages_role_created')
CREATE INDEX IX_core_AiChatMessages_role_created ON core.AiChatMessages (role, created_at) INCLUDE (conversation_id);
GO

IF OBJECT_ID('core.AiDatasetNotes', 'U') IS NULL
CREATE TABLE core.AiDatasetNotes (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiDatasetNotes PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,
    source_id     bigint         NOT NULL,
    column_name   nvarchar(200)  NULL,
    note          nvarchar(1000) NOT NULL,
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiDatasetNotes_modified DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiDatasetNotes_dataset')
CREATE INDEX IX_core_AiDatasetNotes_dataset ON core.AiDatasetNotes (tenant_id, source_type, source_id);
GO

IF COL_LENGTH('core.AiDatasetNotes', 'display_name') IS NULL
ALTER TABLE core.AiDatasetNotes ADD display_name nvarchar(200) NULL;  -- what people call the column; used in headers, prompts and answers
GO

IF OBJECT_ID('core.AiExamples', 'U') IS NULL
CREATE TABLE core.AiExamples (
    id               bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiExamples PRIMARY KEY,
    tenant_id        bigint         NOT NULL,
    source_type      nvarchar(10)   NOT NULL,
    source_id        bigint         NOT NULL,
    message_id       bigint         NOT NULL CONSTRAINT UQ_core_AiExamples_message UNIQUE,
    question         nvarchar(2000) NOT NULL,
    query_spec_json  nvarchar(max)  NOT NULL,
    status           nvarchar(20)   NOT NULL CONSTRAINT DF_core_AiExamples_status DEFAULT N'liked',  -- liked | approved | pending | rejected | disliked
    review           nvarchar(500)  NULL,
    created_by       nvarchar(100)  NOT NULL,
    created_at       datetime2      NOT NULL CONSTRAINT DF_core_AiExamples_created DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiExamples_dataset')
CREATE INDEX IX_core_AiExamples_dataset ON core.AiExamples (tenant_id, source_type, source_id);
GO

IF OBJECT_ID('core.AiNoteProposals', 'U') IS NULL
CREATE TABLE core.AiNoteProposals (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiNoteProposals PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,
    source_id     bigint         NOT NULL,
    column_name   nvarchar(200)  NULL,
    note          nvarchar(1000) NOT NULL,
    confidence    nvarchar(10)   NOT NULL,
    question      nvarchar(2000) NOT NULL,
    status        nvarchar(10)   NOT NULL CONSTRAINT DF_core_AiNoteProposals_status DEFAULT 'pending',
    created_at    datetime2      NOT NULL CONSTRAINT DF_core_AiNoteProposals_created DEFAULT SYSUTCDATETIME(),
    reviewed_by   nvarchar(100)  NULL,
    reviewed_at   datetime2      NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiNoteProposals_dataset')
CREATE INDEX IX_core_AiNoteProposals_dataset ON core.AiNoteProposals (tenant_id, source_type, source_id, status);
GO

IF OBJECT_ID('core.AiMetrics', 'U') IS NULL
CREATE TABLE core.AiMetrics (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiMetrics PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,
    source_id     bigint         NOT NULL,
    name          nvarchar(100)  NOT NULL,
    agg           nvarchar(20)   NOT NULL,
    column_name   nvarchar(200)  NULL,
    description   nvarchar(500)  NULL,
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiMetrics_modified DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_core_AiMetrics_name UNIQUE (tenant_id, source_type, source_id, name)
);
GO

-- AiTerms: business terms per dataset (see infra/sql/add-ai-terms.sql)
IF OBJECT_ID('core.AiTerms', 'U') IS NULL
CREATE TABLE core.AiTerms (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiTerms PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,   -- view | import
    source_id     bigint         NOT NULL,
    term          nvarchar(100)  NOT NULL,
    synonyms      nvarchar(500)  NULL,       -- comma separated
    column_name   nvarchar(200)  NULL,       -- with value: the term is the filter column = value
    value         nvarchar(400)  NULL,
    meaning       nvarchar(500)  NULL,       -- anything that is not a single filter
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiTerms_modified DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_core_AiTerms_term UNIQUE (tenant_id, source_type, source_id, term)
);
GO

-- AiTraces: prompts, replies and timings behind each Ask AI answer, kept 30 days (see infra/sql/add-ai-trace.sql)
IF OBJECT_ID('core.AiTraces', 'U') IS NULL
CREATE TABLE core.AiTraces (
    id          bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiTraces PRIMARY KEY,
    message_id  bigint         NOT NULL,
    trace_json  nvarchar(max)  NOT NULL,
    created_at  datetime2      NOT NULL CONSTRAINT DF_core_AiTraces_created DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiTraces_message')
CREATE INDEX IX_core_AiTraces_message ON core.AiTraces (message_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiTraces_created')
CREATE INDEX IX_core_AiTraces_created ON core.AiTraces (created_at);
GO

-- AiAlerts: watched Ask AI answers (see infra/sql/add-ai-alerts.sql)
IF OBJECT_ID('core.AiAlerts', 'U') IS NULL
CREATE TABLE core.AiAlerts (
    id               bigint          IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiAlerts PRIMARY KEY,
    tenant_id        bigint          NOT NULL,
    user_id          nvarchar(100)   NOT NULL,   -- owner; notified and checked as this user
    source_type      nvarchar(10)    NOT NULL,   -- view | import
    source_id        bigint          NOT NULL,
    source_name      nvarchar(200)   NOT NULL,
    question         nvarchar(2000)  NOT NULL,
    query_spec_json  nvarchar(max)   NOT NULL,   -- the answer's query, run again on each check
    kind             nvarchar(10)    NOT NULL,   -- above | below | unusual | change
    threshold        float           NULL,       -- the limit for above / below, or the percent allowed for change
    every_hours      int             NOT NULL CONSTRAINT DF_core_AiAlerts_every DEFAULT 24,
    notify_emails    nvarchar(1000)  NULL,       -- comma-separated addresses also mailed when it starts firing
    is_triggered     bit             NOT NULL CONSTRAINT DF_core_AiAlerts_triggered DEFAULT 0,
    last_message     nvarchar(1000)  NULL,
    history_json     nvarchar(max)   NULL,       -- last 30 single values, the baseline for unusual
    last_checked_at  datetime2       NULL,
    next_check_at    datetime2       NOT NULL,
    created_at       datetime2       NOT NULL CONSTRAINT DF_core_AiAlerts_created DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAlerts_due')
CREATE INDEX IX_core_AiAlerts_due ON core.AiAlerts (next_check_at);
GO
IF COL_LENGTH('core.AiAlerts', 'notify_emails') IS NULL
ALTER TABLE core.AiAlerts ADD notify_emails nvarchar(1000) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiAlerts_owner')
CREATE INDEX IX_core_AiAlerts_owner ON core.AiAlerts (tenant_id, user_id);
GO

-- AiDatasetPrompts: AI instructions overridden per dataset (see infra/sql/add-ai-dataset-prompts.sql)
IF OBJECT_ID('core.AiDatasetPrompts', 'U') IS NULL
CREATE TABLE core.AiDatasetPrompts (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiDatasetPrompts PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    source_type   nvarchar(10)   NOT NULL,   -- view | import
    source_id     bigint         NOT NULL,
    prompt_key    nvarchar(40)   NOT NULL,   -- ask-rules | answer | report | alert-message
    prompt_text   nvarchar(4000) NOT NULL,
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiDatasetPrompts_modified DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_AiDatasetPrompts_key')
CREATE UNIQUE INDEX UX_core_AiDatasetPrompts_key ON core.AiDatasetPrompts (tenant_id, source_type, source_id, prompt_key);
GO

-- AiDatasetRelations: relationship graph between datasets (see infra/sql/add-ai-dataset-relations.sql)
IF OBJECT_ID('core.AiDatasetRelations', 'U') IS NULL
CREATE TABLE core.AiDatasetRelations (
    id            bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_AiDatasetRelations PRIMARY KEY,
    tenant_id     bigint         NOT NULL,
    from_type     nvarchar(10)   NOT NULL,   -- view | import
    from_id       bigint         NOT NULL,
    from_name     nvarchar(200)  NOT NULL,
    from_column   nvarchar(200)  NOT NULL,
    to_type       nvarchar(10)   NOT NULL,
    to_id         bigint         NOT NULL,
    to_name       nvarchar(200)  NOT NULL,
    to_column     nvarchar(200)  NOT NULL,
    status        nvarchar(10)   NOT NULL CONSTRAINT DF_core_AiDatasetRelations_status DEFAULT 'suggested',  -- suggested | confirmed | rejected
    overlap       float          NULL,       -- share of sample values shared (0-1)
    modified_by   nvarchar(100)  NULL,
    modified_at   datetime2      NOT NULL CONSTRAINT DF_core_AiDatasetRelations_modified DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_AiDatasetRelations_tenant')
CREATE INDEX IX_core_AiDatasetRelations_tenant ON core.AiDatasetRelations (tenant_id, status);
GO

/* ===================================================================
   DataSourceConnections — pull-based external sources (Google Sheets/Drive, REST)
   ========================================================================== */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.DataSourceConnections', N'U') IS NULL
CREATE TABLE core.DataSourceConnections (
    id                      bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DataSourceConnections PRIMARY KEY,
    connection_name         nvarchar(200) NOT NULL,
    -- google_sheets | google_drive | rest_api
    kind                    varchar(50)   NOT NULL,
    -- none | api_key | bearer | basic | oauth2
    auth_type               varchar(30)   NOT NULL DEFAULT 'none',
    -- AES-256-GCM ciphertext of a JSON credential bag. Never returned by the API.
    credentials_encrypted   nvarchar(max) NULL,
    -- Non-secret, kind-specific settings (url, spreadsheetId, headers, paging...).
    config_json             nvarchar(max) NOT NULL DEFAULT N'{}',
    -- untested | ok | failed — result of the most recent test or ingest.
    last_status             varchar(20)   NULL DEFAULT 'untested',
    last_error_message      nvarchar(500) NULL,
    last_tested_at          datetime2(3)  NULL,
    is_active               bit           NOT NULL DEFAULT 1,
    tenant_id               bigint        NOT NULL,
    created_by              bigint        NOT NULL,
    created_at              datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by             bigint        NULL,
    modified_at             datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted              bit           NOT NULL DEFAULT 0
);
GO

-- Unique data source name per tenant (only non-deleted)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_DataSourceConnections_tenant_name')
CREATE UNIQUE INDEX UX_core_DataSourceConnections_tenant_name
    ON core.DataSourceConnections (tenant_id, connection_name)
    WHERE is_deleted = 0;
GO

-- Supports the "list my sources, filtered by kind" grid query
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_DataSourceConnections_tenant_kind')
CREATE INDEX IX_core_DataSourceConnections_tenant_kind
    ON core.DataSourceConnections (tenant_id, kind)
    WHERE is_deleted = 0;
GO

-- Reject unknown connector kinds at the database level as well as in the API,
-- so a bad direct insert cannot produce a row no connector can serve.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DataSourceConnections_kind')
ALTER TABLE core.DataSourceConnections
    ADD CONSTRAINT CK_core_DataSourceConnections_kind
    CHECK (kind IN ('google_sheets', 'google_drive', 'rest_api'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DataSourceConnections_auth_type')
ALTER TABLE core.DataSourceConnections
    ADD CONSTRAINT CK_core_DataSourceConnections_auth_type
    CHECK (auth_type IN ('none', 'api_key', 'bearer', 'basic', 'oauth2'));
GO

/* ==========================================================================
   ReportVersions — immutable publish snapshots, for rollback
   ========================================================================== */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

IF OBJECT_ID(N'core.ReportVersions', N'U') IS NULL
CREATE TABLE core.ReportVersions (
    id                        bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_ReportVersions PRIMARY KEY,
    report_id                 bigint        NOT NULL,
    -- 0, 1, 2... assigned per report in publish order.
    version_no                int           NOT NULL,

    -- Snapshot of the report definition at publish time.
    report_name               nvarchar(200) NOT NULL,
    description               nvarchar(1000) NULL,
    category_id               int           NOT NULL,
    source_name               nvarchar(200) NOT NULL,
    source_type               varchar(20)   NOT NULL,
    report_json               nvarchar(max) NULL,

    -- publish | restore
    reason                    varchar(20)   NOT NULL DEFAULT 'publish',
    -- Set only when reason = 'restore': the version this snapshot was restored from.
    restored_from_version_no  int           NULL,

    published_by              bigint        NOT NULL,
    published_at              datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    tenant_id                 bigint        NOT NULL
);
GO

-- Version numbers are unique and gap-free within a report.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_ReportVersions_report_version')
CREATE UNIQUE INDEX UX_core_ReportVersions_report_version
    ON core.ReportVersions (report_id, version_no);
GO

-- Supports the per-report history lookup.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_ReportVersions_tenant_report')
CREATE INDEX IX_core_ReportVersions_tenant_report
    ON core.ReportVersions (tenant_id, report_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_ReportVersions_reason')
ALTER TABLE core.ReportVersions
    ADD CONSTRAINT CK_core_ReportVersions_reason
    CHECK (reason IN ('publish', 'restore'));
GO

/* ==========================================================================
   Refresh scheduling and monitoring
   ========================================================================== */

IF SCHEMA_ID(N'core') IS NULL
    EXEC(N'CREATE SCHEMA core');
GO

/* ── Schedules ───────────────────────────────────────────────────────────── */

IF OBJECT_ID(N'core.RefreshSchedules', N'U') IS NULL
CREATE TABLE core.RefreshSchedules (
    id                         bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_RefreshSchedules PRIMARY KEY,
    schedule_name              nvarchar(200) NOT NULL,
    data_source_connection_id  bigint        NOT NULL,
    imported_dataset_id        bigint        NOT NULL,
    -- Connector object to fetch (sheet tab, Drive file id); NULL uses the source default.
    object_ref                 nvarchar(500) NULL,
    -- Standard 5-field cron expression, evaluated in time_zone_id.
    cron_expression            varchar(100)  NOT NULL,
    time_zone_id               varchar(100)  NOT NULL DEFAULT 'UTC',
    -- Display label only ("Daily", "Every 5 minutes"); the cron is authoritative.
    frequency_label            nvarchar(50)  NULL,
    -- full | incremental
    refresh_mode               varchar(20)   NOT NULL DEFAULT 'full',
    -- Incremental only: column holding a monotonically increasing value.
    incremental_column         nvarchar(200) NULL,
    last_watermark             nvarchar(400) NULL,
    is_enabled                 bit           NOT NULL DEFAULT 1,
    last_run_at                datetime2(3)  NULL,
    -- Next fire time in UTC. The worker claims schedules whose value is in the past.
    next_run_at                datetime2(3)  NULL,
    last_status                varchar(20)   NULL,
    tenant_id                  bigint        NOT NULL,
    created_by                 bigint        NOT NULL,
    created_at                 datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by                bigint        NULL,
    modified_at                datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted                 bit           NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_RefreshSchedules_tenant_name')
CREATE UNIQUE INDEX UX_core_RefreshSchedules_tenant_name
    ON core.RefreshSchedules (tenant_id, schedule_name)
    WHERE is_deleted = 0;
GO

-- The worker's hot query is "enabled schedules that are due".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_RefreshSchedules_due')
CREATE INDEX IX_core_RefreshSchedules_due
    ON core.RefreshSchedules (is_enabled, next_run_at)
    WHERE is_deleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_RefreshSchedules_mode')
ALTER TABLE core.RefreshSchedules
    ADD CONSTRAINT CK_core_RefreshSchedules_mode
    CHECK (refresh_mode IN ('full', 'incremental'));
GO

/* ── Jobs (refresh history) ──────────────────────────────────────────────── */

IF OBJECT_ID(N'core.RefreshJobs', N'U') IS NULL
CREATE TABLE core.RefreshJobs (
    id                         bigint        IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_RefreshJobs PRIMARY KEY,
    -- Short human-facing code shown in the Data Sync grid, e.g. 'JB-1088'.
    job_code                   varchar(30)   NOT NULL,
    -- NULL for a manual, unscheduled refresh.
    schedule_id                bigint        NULL,
    data_source_connection_id  bigint        NOT NULL,
    imported_dataset_id        bigint        NOT NULL,
    job_process                nvarchar(200) NOT NULL,
    -- queued | processing | succeeded | failed
    status                     varchar(20)   NOT NULL DEFAULT 'queued',
    -- schedule | manual | retry
    triggered_by               varchar(20)   NOT NULL DEFAULT 'manual',
    refresh_mode               varchar(20)   NOT NULL DEFAULT 'full',
    queued_at                  datetime2(3)  NOT NULL DEFAULT SYSUTCDATETIME(),
    started_at                 datetime2(3)  NULL,
    completed_at               datetime2(3)  NULL,
    duration_ms                int           NULL,
    row_count                  int           NULL,
    error_message              nvarchar(2000) NULL,
    triggered_by_user_id       bigint        NULL,
    tenant_id                  bigint        NOT NULL,
    is_deleted                 bit           NOT NULL DEFAULT 0
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_RefreshJobs_job_code')
CREATE UNIQUE INDEX UX_core_RefreshJobs_job_code
    ON core.RefreshJobs (job_code);
GO

-- History is always read newest-first for a tenant.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_RefreshJobs_tenant_queued')
CREATE INDEX IX_core_RefreshJobs_tenant_queued
    ON core.RefreshJobs (tenant_id, queued_at)
    WHERE is_deleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_RefreshJobs_schedule')
CREATE INDEX IX_core_RefreshJobs_schedule
    ON core.RefreshJobs (schedule_id)
    WHERE is_deleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_RefreshJobs_status')
ALTER TABLE core.RefreshJobs
    ADD CONSTRAINT CK_core_RefreshJobs_status
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed'));
GO

/* ── Last-refresh markers on the dataset ─────────────────────────────────── */

IF COL_LENGTH('core.ImportedDatasets', 'last_refreshed_at') IS NULL
    ALTER TABLE core.ImportedDatasets ADD last_refreshed_at datetime2(3) NULL;
GO

IF COL_LENGTH('core.ImportedDatasets', 'last_refresh_status') IS NULL
    ALTER TABLE core.ImportedDatasets ADD last_refresh_status varchar(20) NULL;
GO

IF COL_LENGTH('core.ImportedDatasets', 'last_refresh_job_code') IS NULL
    ALTER TABLE core.ImportedDatasets ADD last_refresh_job_code varchar(30) NULL;
GO

/* ── Dataset origin, so a dataset knows what to refresh from ─────────────── */

IF COL_LENGTH('core.ImportedDatasets', 'data_source_connection_id') IS NULL
    ALTER TABLE core.ImportedDatasets ADD data_source_connection_id bigint NULL;
GO

IF COL_LENGTH('core.ImportedDatasets', 'source_object_ref') IS NULL
    ALTER TABLE core.ImportedDatasets ADD source_object_ref nvarchar(500) NULL;
GO

/* Best-effort back-fill for datasets ingested before the origin columns existed.
   Connector ingests wrote file_name as 'connectionName/objectRef' and file_type as the
   connector kind, so the source can be recovered by matching on those. File uploads
   (file_type csv/xlsx/xls/json) are left NULL — they have no source to refresh from. */
UPDATE d
   SET d.data_source_connection_id = c.id,
       d.source_object_ref = NULLIF(
           STUFF(d.file_name, 1, LEN(c.connection_name) + 1, ''), 'default')
  FROM core.ImportedDatasets d
  JOIN core.DataSourceConnections c
    ON c.tenant_id = d.tenant_id
   AND c.is_deleted = 0
   AND d.file_name LIKE c.connection_name + '/%'
 WHERE d.data_source_connection_id IS NULL
   AND d.file_type IN ('google_sheets', 'google_drive', 'rest_api');
GO

/* MarketplaceCatalogs - tenant-registered visual catalogs. Mirrors infra/sql/add-marketplace-catalogs.sql. */
IF OBJECT_ID(N'core.MarketplaceCatalogs', N'U') IS NULL
CREATE TABLE core.MarketplaceCatalogs (
    id                    bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_MarketplaceCatalogs PRIMARY KEY,
    catalog_key           nvarchar(50)   NOT NULL,
    name                  nvarchar(100)  NOT NULL,
    url                   nvarchar(2000) NOT NULL,
    auth_header           nvarchar(100)  NULL,
    auth_value_encrypted  nvarchar(4000) NULL,
    tenant_id             bigint         NOT NULL,
    created_by            bigint         NOT NULL,
    created_at            datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplaceCatalogs_created_at DEFAULT SYSUTCDATETIME(),
    modified_at           datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplaceCatalogs_modified_at DEFAULT SYSUTCDATETIME(),
    is_deleted            bit            NOT NULL CONSTRAINT DF_core_MarketplaceCatalogs_is_deleted DEFAULT 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_MarketplaceCatalogs_tenant_key')
    CREATE UNIQUE INDEX UX_core_MarketplaceCatalogs_tenant_key ON core.MarketplaceCatalogs (tenant_id, catalog_key) WHERE is_deleted = 0;
GO

/* MarketplacePlugins - the built-in TWise Visuals marketplace. Mirrors infra/sql/add-marketplace-plugins.sql, which also seeds the rows. */
IF OBJECT_ID(N'core.MarketplacePlugins', N'U') IS NULL
CREATE TABLE core.MarketplacePlugins (
    id                     bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_MarketplacePlugins PRIMARY KEY,
    plugin_id              nvarchar(100)  NOT NULL,
    name                   nvarchar(100)  NOT NULL,
    description            nvarchar(1000) NOT NULL,
    version                nvarchar(20)   NOT NULL,
    publisher              nvarchar(100)  NOT NULL,
    visual_key             nvarchar(100)  NOT NULL,
    render_kind            nvarchar(50)   NOT NULL,
    icon                   nvarchar(50)   NULL,
    data_roles_json        nvarchar(max)  NOT NULL,
    features_json          nvarchar(max)  NULL,
    image_url              nvarchar(max)  NULL,
    options_template_json  nvarchar(max)  NOT NULL,
    is_active              bit            NOT NULL CONSTRAINT DF_core_MarketplacePlugins_is_active DEFAULT 1,
    created_at             datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplacePlugins_created_at DEFAULT SYSUTCDATETIME(),
    modified_at            datetime2(7)   NOT NULL CONSTRAINT DF_core_MarketplacePlugins_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_MarketplacePlugins_plugin_id')
    CREATE UNIQUE INDEX UX_core_MarketplacePlugins_plugin_id ON core.MarketplacePlugins (plugin_id);
GO

/* PowerBiConnections - the tenant's Power BI embedding identity. Mirrors infra/sql/add-powerbi-connections.sql. */
IF OBJECT_ID(N'core.PowerBiConnections', N'U') IS NULL
CREATE TABLE core.PowerBiConnections (
    id                       bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_PowerBiConnections PRIMARY KEY,
    tenant_id                bigint         NOT NULL,
    azure_tenant_id          nvarchar(36)   NOT NULL,
    client_id                nvarchar(36)   NOT NULL,
    client_secret_encrypted  nvarchar(4000) NOT NULL,
    workspace_id             nvarchar(36)   NOT NULL,
    modified_by              bigint         NOT NULL,
    created_at               datetime2(7)   NOT NULL CONSTRAINT DF_core_PowerBiConnections_created_at DEFAULT SYSUTCDATETIME(),
    modified_at              datetime2(7)   NOT NULL CONSTRAINT DF_core_PowerBiConnections_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_core_PowerBiConnections_tenant')
    CREATE UNIQUE INDEX UX_core_PowerBiConnections_tenant ON core.PowerBiConnections (tenant_id);
GO

/* LearnVideos - "Learn" video URL + chapters per builder screen. Mirrors infra/sql/add-learn-videos.sql, which also seeds sample rows. */
IF OBJECT_ID(N'core.LearnVideos', N'U') IS NULL
CREATE TABLE core.LearnVideos (
    id             bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_LearnVideos PRIMARY KEY,
    screen_key     nvarchar(50)   NOT NULL,
    title          nvarchar(200)  NOT NULL,
    video_url      nvarchar(2000) NOT NULL,
    poster_url     nvarchar(2000) NULL,
    chapters_json  nvarchar(max)  NULL,
    is_active      bit            NOT NULL CONSTRAINT DF_core_LearnVideos_is_active DEFAULT 1,
    created_at     datetime2(7)   NOT NULL CONSTRAINT DF_core_LearnVideos_created_at DEFAULT SYSUTCDATETIME(),
    modified_at    datetime2(7)   NOT NULL CONSTRAINT DF_core_LearnVideos_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_LearnVideos_screen_key')
    CREATE INDEX IX_core_LearnVideos_screen_key ON core.LearnVideos (screen_key);
GO

/* DaxModels - saved DAX models (Settings -> Dax Model). Mirrors infra/sql/add-dax-models.sql, which also seeds sample rows. */
IF OBJECT_ID(N'core.DaxModels', N'U') IS NULL
CREATE TABLE core.DaxModels (
    id             bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DaxModels PRIMARY KEY,
    name           nvarchar(128)  NOT NULL,
    source_type    nvarchar(10)   NOT NULL CONSTRAINT CK_core_DaxModels_source_type CHECK (source_type IN (N'Table', N'View')),
    data_source    nvarchar(256)  NOT NULL,
    calculated_by  nvarchar(10)   NOT NULL CONSTRAINT CK_core_DaxModels_calculated_by CHECK (calculated_by IN (N'Column', N'Row')),
    operation      nvarchar(64)   NULL,
    columns_json   nvarchar(max)  NULL,
    expression     nvarchar(4000) NOT NULL,
    status         nvarchar(10)   NOT NULL CONSTRAINT DF_core_DaxModels_status DEFAULT N'Active'
                                  CONSTRAINT CK_core_DaxModels_status CHECK (status IN (N'Active', N'Draft')),
    created_by     bigint         NULL,   -- owner; each user sees only their own models, admins see all
    is_deleted     bit            NOT NULL CONSTRAINT DF_core_DaxModels_is_deleted DEFAULT 0,
    created_at     datetime2(7)   NOT NULL CONSTRAINT DF_core_DaxModels_created_at DEFAULT SYSUTCDATETIME(),
    modified_at    datetime2(7)   NOT NULL CONSTRAINT DF_core_DaxModels_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_DaxModels_created_at')
    CREATE INDEX IX_core_DaxModels_created_at ON core.DaxModels (created_at DESC) WHERE is_deleted = 0;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_DaxModels_created_by')
    CREATE INDEX IX_core_DaxModels_created_by ON core.DaxModels (created_by, created_at DESC);
GO

PRINT '✓ All tenant tables created successfully.';
GO

/* DataDictionary - governance documentation per dataset column. Mirrors infra/sql/add-governance.sql. */
IF OBJECT_ID(N'core.DataDictionary', N'U') IS NULL
CREATE TABLE core.DataDictionary (
    id              bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_DataDictionary PRIMARY KEY,
    dataset_kind    varchar(20)    NOT NULL,            -- import | view
    dataset_id      bigint         NOT NULL,
    column_name     nvarchar(200)  NULL,                -- NULL = dataset-level entry
    business_name   nvarchar(200)  NULL,
    description     nvarchar(2000) NULL,
    owner           nvarchar(200)  NULL,
    sensitivity     varchar(20)    NOT NULL DEFAULT 'internal',  -- public | internal | confidential | pii
    tags            nvarchar(500)  NULL,
    tenant_id       bigint         NOT NULL,
    created_by      bigint         NOT NULL,
    created_at      datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    modified_by     bigint         NULL,
    modified_at     datetime2(3)   NOT NULL DEFAULT SYSUTCDATETIME(),
    is_deleted      bit            NOT NULL DEFAULT 0,
    CONSTRAINT CK_core_DataDictionary_kind CHECK (dataset_kind IN ('import', 'view')),
    CONSTRAINT CK_core_DataDictionary_sensitivity CHECK (sensitivity IN ('public', 'internal', 'confidential', 'pii'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_core_DataDictionary_column')
CREATE UNIQUE INDEX UX_core_DataDictionary_column
    ON core.DataDictionary (tenant_id, dataset_kind, dataset_id, column_name) WHERE is_deleted = 0;
GO

