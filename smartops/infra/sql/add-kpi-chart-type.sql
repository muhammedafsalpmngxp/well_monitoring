/* ----------------------------------------------------------------------------
   KPI chart type: one big number (a DAX measure, or the Y column aggregated)
   with its label. Adds it to the Chart Builder's chart-type palette.
   Run against the CONTROL-PLANE database. Idempotent.
   ---------------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM control.widget_library WHERE type = 'chart' AND json LIKE '%"chartType":"kpi"%')
INSERT INTO control.widget_library (widget_name, type, json, created_by, created_at, modified_at, is_deleted)
VALUES ('KPI', 'chart',
        N'{"chartType":"kpi","title":"","source":"","sourceType":"","aggregation":"sum","yField":"","highchartsOptions":{}}',
        0, SYSUTCDATETIME(), SYSUTCDATETIME(), 0);
GO
