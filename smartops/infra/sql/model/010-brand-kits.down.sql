-- =============================================================================
-- T-Wise Tenant: reverses 010-brand-kits.sql
-- -----------------------------------------------------------------------------
-- Drops model.BrandKit and every saved kit in it. Canvases keep the brand kit
-- they applied, since each canvas stores its own copy.
-- Idempotent: the table is dropped only while it exists.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 010-brand-kits.down.sql
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

DROP TABLE IF EXISTS model.BrandKit;
GO
