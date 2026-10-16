-- ═════════════════════════════════════════════════════════════════════════════
-- SmartOps — Tenant FK Constraints & Indexes (init-tenant-schema-constraints.sql)
-- ─────────────────────────────────────────────────────────────────────────────
-- Executed AFTER init-tenant-schema.sql creates tables.
-- Idempotent: checks before adding each constraint.
-- ═════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

-- ── Unique Indexes ───────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_Well_current' AND object_id = OBJECT_ID('core.Well'))
    CREATE UNIQUE INDEX UQ_core_Well_current ON core.Well (pdo_well_id) WHERE is_current = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_Project_current' AND object_id = OBJECT_ID('core.Project'))
    CREATE UNIQUE INDEX UQ_core_Project_current ON core.Project (project_uid) WHERE is_current = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_WellScope_well' AND object_id = OBJECT_ID('core.WellScope'))
    CREATE UNIQUE INDEX UQ_core_WellScope_well ON core.WellScope (well_key);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_ScheduleTask_sched_wbs' AND object_id = OBJECT_ID('core.ScheduleTask'))
    CREATE UNIQUE INDEX UQ_core_ScheduleTask_sched_wbs ON core.ScheduleTask (schedule_key, wbs_code);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_DrillingOp_well_seq' AND object_id = OBJECT_ID('core.DrillingOperation'))
    CREATE UNIQUE INDEX UQ_core_DrillingOp_well_seq ON core.DrillingOperation (well_key, sequence_no);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_ProgressSnapshot_scope_date' AND object_id = OBJECT_ID('core.ProgressSnapshot'))
    CREATE UNIQUE INDEX UQ_core_ProgressSnapshot_scope_date ON core.ProgressSnapshot (well_scope_key, date_key);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_ProgressDetail_key' AND object_id = OBJECT_ID('core.ProgressDetail'))
    CREATE UNIQUE INDEX UQ_core_ProgressDetail_key ON core.ProgressDetail (date_key, well_scope_key, activity_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_TaskSnapshot_key' AND object_id = OBJECT_ID('core.ScheduleTaskSnapshot'))
    CREATE UNIQUE INDEX UQ_core_TaskSnapshot_key ON core.ScheduleTaskSnapshot (task_key, date_key);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_WellDeliveryEvent_key' AND object_id = OBJECT_ID('core.WellDeliveryEvent'))
    CREATE UNIQUE INDEX UQ_core_WellDeliveryEvent_key ON core.WellDeliveryEvent (well_scope_key, event_type_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_CrewEmployee_key' AND object_id = OBJECT_ID('core.CrewEmployee'))
    CREATE UNIQUE INDEX UQ_core_CrewEmployee_key ON core.CrewEmployee (crew_id, employee_id, employee_type_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_CrewEquipment_key' AND object_id = OBJECT_ID('core.CrewEquipment'))
    CREATE UNIQUE INDEX UQ_core_CrewEquipment_key ON core.CrewEquipment (crew_id, equipment_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_TaskCrew_key' AND object_id = OBJECT_ID('core.TaskCrew'))
    CREATE UNIQUE INDEX UQ_core_TaskCrew_key ON core.TaskCrew (task_key, crew_id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_core_CrewProductivity_key' AND object_id = OBJECT_ID('core.CrewProductivity'))
    CREATE UNIQUE INDEX UQ_core_CrewProductivity_key ON core.CrewProductivity (date_key, crew_id, employee_id);
GO

-- ── Foreign Keys ─────────────────────────────────────────────────────────────

-- ref.Site → ref.Cluster
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Site_Cluster')
    ALTER TABLE ref.Site ADD CONSTRAINT FK_Site_Cluster FOREIGN KEY (cluster_id) REFERENCES ref.Cluster(cluster_id);
GO

-- core.Well → core.Project, ref.Site, ref.WellFunction, ref.WellCategory, ref.PdoWellType, ref.PcapCategory, ref.LiftType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_Project')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_Project FOREIGN KEY (project_key) REFERENCES core.Project(project_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_Site')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_Site FOREIGN KEY (site_id) REFERENCES ref.Site(site_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_WellFunction')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_WellFunction FOREIGN KEY (well_function_id) REFERENCES ref.WellFunction(well_function_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_WellCategory')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_WellCategory FOREIGN KEY (well_category_id) REFERENCES ref.WellCategory(well_category_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_PdoWellType')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_PdoWellType FOREIGN KEY (pdo_well_type_id) REFERENCES ref.PdoWellType(pdo_well_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_PcapCategory')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_PcapCategory FOREIGN KEY (pcap_category_id) REFERENCES ref.PcapCategory(pcap_category_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Well_LiftType')
    ALTER TABLE core.Well ADD CONSTRAINT FK_Well_LiftType FOREIGN KEY (lift_type_id) REFERENCES ref.LiftType(lift_type_id);
GO

-- core.Project → ref.Cluster, ref.ProjectCategory, ref.WellType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Project_Cluster')
    ALTER TABLE core.Project ADD CONSTRAINT FK_Project_Cluster FOREIGN KEY (cluster_id) REFERENCES ref.Cluster(cluster_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Project_ProjectCategory')
    ALTER TABLE core.Project ADD CONSTRAINT FK_Project_ProjectCategory FOREIGN KEY (project_category_id) REFERENCES ref.ProjectCategory(project_category_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Project_WellType')
    ALTER TABLE core.Project ADD CONSTRAINT FK_Project_WellType FOREIGN KEY (well_type_id) REFERENCES ref.WellType(well_type_id);
GO

-- core.WellScope → core.Well, ref.CompletionType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellScope_Well')
    ALTER TABLE core.WellScope ADD CONSTRAINT FK_WellScope_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellScope_CompletionType')
    ALTER TABLE core.WellScope ADD CONSTRAINT FK_WellScope_CompletionType FOREIGN KEY (completion_type_id) REFERENCES ref.CompletionType(completion_type_id);
GO

-- core.Schedule → core.Project, core.Well
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Schedule_Project')
    ALTER TABLE core.Schedule ADD CONSTRAINT FK_Schedule_Project FOREIGN KEY (project_key) REFERENCES core.Project(project_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Schedule_Well')
    ALTER TABLE core.Schedule ADD CONSTRAINT FK_Schedule_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO

-- core.ScheduleTask → core.Schedule, core.Well, core.Project, ref.TaskType, ref.ActivityMaster, ref.Employee
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ScheduleTask_Schedule')
    ALTER TABLE core.ScheduleTask ADD CONSTRAINT FK_ScheduleTask_Schedule FOREIGN KEY (schedule_key) REFERENCES core.Schedule(schedule_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ScheduleTask_Parent')
    ALTER TABLE core.ScheduleTask ADD CONSTRAINT FK_ScheduleTask_Parent FOREIGN KEY (parent_task_key) REFERENCES core.ScheduleTask(task_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ScheduleTask_TaskType')
    ALTER TABLE core.ScheduleTask ADD CONSTRAINT FK_ScheduleTask_TaskType FOREIGN KEY (task_type_id) REFERENCES ref.TaskType(task_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ScheduleTask_ActivityMaster')
    ALTER TABLE core.ScheduleTask ADD CONSTRAINT FK_ScheduleTask_ActivityMaster FOREIGN KEY (activity_master_id) REFERENCES ref.ActivityMaster(activity_master_id);
GO

-- core.DrillingOperation → core.Well, ref.WorkCenter, ref.Activity, ref.OperationStatus, ref.Date, ref.DurationUnit
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DrillingOp_Well')
    ALTER TABLE core.DrillingOperation ADD CONSTRAINT FK_DrillingOp_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DrillingOp_WorkCenter')
    ALTER TABLE core.DrillingOperation ADD CONSTRAINT FK_DrillingOp_WorkCenter FOREIGN KEY (work_center_id) REFERENCES ref.WorkCenter(work_center_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DrillingOp_Activity')
    ALTER TABLE core.DrillingOperation ADD CONSTRAINT FK_DrillingOp_Activity FOREIGN KEY (activity_id) REFERENCES ref.Activity(activity_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DrillingOp_Status')
    ALTER TABLE core.DrillingOperation ADD CONSTRAINT FK_DrillingOp_Status FOREIGN KEY (status_id) REFERENCES ref.OperationStatus(status_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_DrillingOp_DurationUnit')
    ALTER TABLE core.DrillingOperation ADD CONSTRAINT FK_DrillingOp_DurationUnit FOREIGN KEY (duration_unit_id) REFERENCES ref.DurationUnit(duration_unit_id);
GO

-- core.ProgressSnapshot → core.Well, core.WellScope, ref.ProgressStatus (date_key stores YYYYMMDD directly)
-- FK_ProgressSnapshot_Date removed: date_key uses source timestamp via date_to_key transform
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ProgressSnapshot_Well')
    ALTER TABLE core.ProgressSnapshot ADD CONSTRAINT FK_ProgressSnapshot_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ProgressSnapshot_WellScope')
    ALTER TABLE core.ProgressSnapshot ADD CONSTRAINT FK_ProgressSnapshot_WellScope FOREIGN KEY (well_scope_key) REFERENCES core.WellScope(well_scope_key);
GO

-- core.ProgressDetail → core.ProgressSnapshot, core.WellScope, ref.ProgressActivity
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ProgressDetail_Snapshot')
    ALTER TABLE core.ProgressDetail ADD CONSTRAINT FK_ProgressDetail_Snapshot FOREIGN KEY (progress_snapshot_id) REFERENCES core.ProgressSnapshot(progress_snapshot_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ProgressDetail_Activity')
    ALTER TABLE core.ProgressDetail ADD CONSTRAINT FK_ProgressDetail_Activity FOREIGN KEY (activity_id) REFERENCES ref.ProgressActivity(activity_id);
GO

-- core.ScheduleTaskSnapshot → core.ScheduleTask (date_key stores YYYYMMDD directly)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskSnapshot_Task')
    ALTER TABLE core.ScheduleTaskSnapshot ADD CONSTRAINT FK_TaskSnapshot_Task FOREIGN KEY (task_key) REFERENCES core.ScheduleTask(task_key);
GO
-- FK_TaskSnapshot_Date removed: date_key uses source timestamp via date_to_key transform
GO

-- core.WellDeliveryEvent → core.Well, core.WellScope, ref.EventType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellDeliveryEvent_Well')
    ALTER TABLE core.WellDeliveryEvent ADD CONSTRAINT FK_WellDeliveryEvent_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellDeliveryEvent_WellScope')
    ALTER TABLE core.WellDeliveryEvent ADD CONSTRAINT FK_WellDeliveryEvent_WellScope FOREIGN KEY (well_scope_key) REFERENCES core.WellScope(well_scope_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellDeliveryEvent_EventType')
    ALTER TABLE core.WellDeliveryEvent ADD CONSTRAINT FK_WellDeliveryEvent_EventType FOREIGN KEY (event_type_id) REFERENCES ref.EventType(event_type_id);
GO

-- core.WellDocument → core.WellScope, ref.DocumentType, ref.DocumentStatus
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellDocument_WellScope')
    ALTER TABLE core.WellDocument ADD CONSTRAINT FK_WellDocument_WellScope FOREIGN KEY (well_scope_key) REFERENCES core.WellScope(well_scope_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellDocument_DocType')
    ALTER TABLE core.WellDocument ADD CONSTRAINT FK_WellDocument_DocType FOREIGN KEY (doc_type_id) REFERENCES ref.DocumentType(doc_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellDocument_DocStatus')
    ALTER TABLE core.WellDocument ADD CONSTRAINT FK_WellDocument_DocStatus FOREIGN KEY (doc_status_id) REFERENCES ref.DocumentStatus(doc_status_id);
GO

-- core.WellProcurement → core.WellScope
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellProcurement_WellScope')
    ALTER TABLE core.WellProcurement ADD CONSTRAINT FK_WellProcurement_WellScope FOREIGN KEY (well_scope_key) REFERENCES core.WellScope(well_scope_key);
GO

-- core.OperationDependency → core.DrillingOperation
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_OpDep_Predecessor')
    ALTER TABLE core.OperationDependency ADD CONSTRAINT FK_OpDep_Predecessor FOREIGN KEY (predecessor_operation_id) REFERENCES core.DrillingOperation(operation_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_OpDep_Successor')
    ALTER TABLE core.OperationDependency ADD CONSTRAINT FK_OpDep_Successor FOREIGN KEY (successor_operation_id) REFERENCES core.DrillingOperation(operation_id);
GO

-- core.CrewEmployee → ref.Crew, ref.Employee, ref.EmployeeType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewEmployee_Crew')
    ALTER TABLE core.CrewEmployee ADD CONSTRAINT FK_CrewEmployee_Crew FOREIGN KEY (crew_id) REFERENCES ref.Crew(crew_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewEmployee_Employee')
    ALTER TABLE core.CrewEmployee ADD CONSTRAINT FK_CrewEmployee_Employee FOREIGN KEY (employee_id) REFERENCES ref.Employee(employee_id);
GO

-- core.CrewEquipment → ref.Crew, ref.Equipment
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewEquipment_Crew')
    ALTER TABLE core.CrewEquipment ADD CONSTRAINT FK_CrewEquipment_Crew FOREIGN KEY (crew_id) REFERENCES ref.Crew(crew_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewEquipment_Equipment')
    ALTER TABLE core.CrewEquipment ADD CONSTRAINT FK_CrewEquipment_Equipment FOREIGN KEY (equipment_id) REFERENCES ref.Equipment(equipment_id);
GO

-- core.TaskCrew → core.ScheduleTask, ref.Crew, core.Project
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskCrew_Task')
    ALTER TABLE core.TaskCrew ADD CONSTRAINT FK_TaskCrew_Task FOREIGN KEY (task_key) REFERENCES core.ScheduleTask(task_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskCrew_Crew')
    ALTER TABLE core.TaskCrew ADD CONSTRAINT FK_TaskCrew_Crew FOREIGN KEY (crew_id) REFERENCES ref.Crew(crew_id);
GO

-- core.CrewProductivity → ref.Date, ref.Crew, ref.CrewType, ref.Employee, ref.Company
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewProductivity_Date')
    ALTER TABLE core.CrewProductivity ADD CONSTRAINT FK_CrewProductivity_Date FOREIGN KEY (date_key) REFERENCES ref.[Date](date_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewProductivity_Crew')
    ALTER TABLE core.CrewProductivity ADD CONSTRAINT FK_CrewProductivity_Crew FOREIGN KEY (crew_id) REFERENCES ref.Crew(crew_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewProductivity_CrewType')
    ALTER TABLE core.CrewProductivity ADD CONSTRAINT FK_CrewProductivity_CrewType FOREIGN KEY (crew_type_id) REFERENCES ref.CrewType(crew_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewProductivity_Employee')
    ALTER TABLE core.CrewProductivity ADD CONSTRAINT FK_CrewProductivity_Employee FOREIGN KEY (employee_id) REFERENCES ref.Employee(employee_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrewProductivity_Company')
    ALTER TABLE core.CrewProductivity ADD CONSTRAINT FK_CrewProductivity_Company FOREIGN KEY (company_id) REFERENCES ref.Company(company_id);
GO

-- ref.Employee → ref.EmployeeType, ref.Company, ref.Location, ref.Employee (self)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Employee_EmployeeType')
    ALTER TABLE ref.Employee ADD CONSTRAINT FK_Employee_EmployeeType FOREIGN KEY (employee_type_id) REFERENCES ref.EmployeeType(employee_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Employee_Company')
    ALTER TABLE ref.Employee ADD CONSTRAINT FK_Employee_Company FOREIGN KEY (company_id) REFERENCES ref.Company(company_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Employee_Location')
    ALTER TABLE ref.Employee ADD CONSTRAINT FK_Employee_Location FOREIGN KEY (location_id) REFERENCES ref.Location(location_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Employee_Supervisor')
    ALTER TABLE ref.Employee ADD CONSTRAINT FK_Employee_Supervisor FOREIGN KEY (supervisor_id) REFERENCES ref.Employee(employee_id);
GO

-- ref.Crew → ref.CrewType, ref.Location, ref.Employee
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Crew_CrewType')
    ALTER TABLE ref.Crew ADD CONSTRAINT FK_Crew_CrewType FOREIGN KEY (crew_type_id) REFERENCES ref.CrewType(crew_type_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Crew_Location')
    ALTER TABLE ref.Crew ADD CONSTRAINT FK_Crew_Location FOREIGN KEY (location_id) REFERENCES ref.Location(location_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Crew_Supervisor')
    ALTER TABLE ref.Crew ADD CONSTRAINT FK_Crew_Supervisor FOREIGN KEY (supervisor_id) REFERENCES ref.Employee(employee_id);
GO

-- ref.ActivityMaster → ref.CrewType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActivityMaster_CrewType')
    ALTER TABLE ref.ActivityMaster ADD CONSTRAINT FK_ActivityMaster_CrewType FOREIGN KEY (crew_type_id) REFERENCES ref.CrewType(crew_type_id);
GO

-- ref.Equipment → ref.EquipmentType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Equipment_EquipmentType')
    ALTER TABLE ref.Equipment ADD CONSTRAINT FK_Equipment_EquipmentType FOREIGN KEY (equipment_type_id) REFERENCES ref.EquipmentType(equipment_type_id);
GO

-- ml.FeatureStore / ml.WellVector → core.Well
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FeatureStore_Well')
    ALTER TABLE ml.FeatureStore ADD CONSTRAINT FK_FeatureStore_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WellVector_Well')
    ALTER TABLE ml.WellVector ADD CONSTRAINT FK_WellVector_Well FOREIGN KEY (well_key) REFERENCES core.Well(well_key);
GO

-- core.Reports → core.Category
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Reports_Category_CategoryId')
    ALTER TABLE core.Reports ADD CONSTRAINT FK_Reports_Category_CategoryId FOREIGN KEY (CategoryId) REFERENCES core.Category(CategoryId) ON DELETE NO ACTION;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reports_ReportName_SourceName_CreatedBy' AND object_id = OBJECT_ID('core.Reports'))
    CREATE UNIQUE INDEX IX_Reports_ReportName_SourceName_CreatedBy ON core.Reports (ReportName, SourceName, CreatedBy) WHERE IsDeleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Reports_CategoryId' AND object_id = OBJECT_ID('core.Reports'))
    CREATE INDEX IX_Reports_CategoryId ON core.Reports (CategoryId);
GO

-- core.Widgets → core.Category
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Widgets_Category_CategoryId')
    ALTER TABLE core.Widgets ADD CONSTRAINT FK_Widgets_Category_CategoryId FOREIGN KEY (CategoryId) REFERENCES core.Category(CategoryId) ON DELETE SET NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Widgets_TenantId_CreatedBy' AND object_id = OBJECT_ID('core.Widgets'))
    CREATE INDEX IX_Widgets_TenantId_CreatedBy ON core.Widgets (TenantId, CreatedBy) WHERE IsDeleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Widgets_CategoryId' AND object_id = OBJECT_ID('core.Widgets'))
    CREATE INDEX IX_Widgets_CategoryId ON core.Widgets (CategoryId);
GO

-- core.TaskDaily → core.Project, ref.CrewType
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskDaily_Project')
    ALTER TABLE core.TaskDaily ADD CONSTRAINT FK_TaskDaily_Project FOREIGN KEY (project_id) REFERENCES core.Project(project_key);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_TaskDaily_CrewType')
    ALTER TABLE core.TaskDaily ADD CONSTRAINT FK_TaskDaily_CrewType FOREIGN KEY (crew_type_id) REFERENCES ref.CrewType(crew_type_id);
GO

PRINT '✓ All constraints and indexes created successfully.';
GO
