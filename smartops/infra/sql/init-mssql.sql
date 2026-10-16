-- ─────────────────────────────────────────────────────────────────────────────
-- Create per-service databases. The .NET services each call EnsureCreated()
-- on startup to provision their tables — this script just creates the DBs.
-- ─────────────────────────────────────────────────────────────────────────────
IF DB_ID(N'smartops_auth')        IS NULL CREATE DATABASE smartops_auth;
IF DB_ID(N'smartops_wells')       IS NULL CREATE DATABASE smartops_wells;
IF DB_ID(N'smartops_finance')     IS NULL CREATE DATABASE smartops_finance;
IF DB_ID(N'smartops_workflow')    IS NULL CREATE DATABASE smartops_workflow;
IF DB_ID(N'smartops_reports')     IS NULL CREATE DATABASE smartops_reports;
IF DB_ID(N'smartops_integrations') IS NULL CREATE DATABASE smartops_integrations;
GO
