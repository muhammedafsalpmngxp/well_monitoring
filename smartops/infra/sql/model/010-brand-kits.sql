-- =============================================================================
-- T-Wise Tenant: saved brand kits for the reporting canvas
-- (010-brand-kits.sql)
-- -----------------------------------------------------------------------------
-- Creates model.BrandKit: a named set of chart colours, a font, a logo and
-- text sizes that canvas authors save once and apply to any canvas. The kit
-- itself is JSON (Kit); a canvas keeps its own copy, so changing or deleting a
-- kit never changes a canvas that used it.
-- Changes no data. Run 001 first: the table goes in schema model.
-- Idempotent: the table is created only while it is missing.
--
-- Usage:
--   sqlcmd -S <server> -d smartops_tenant_TNT-1000 -i 010-brand-kits.sql
-- Reverse with 010-brand-kits.down.sql.
-- =============================================================================

SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
SET ANSI_NULLS ON;
GO

IF SCHEMA_ID('model') IS NOT NULL AND OBJECT_ID('model.BrandKit', 'U') IS NULL
BEGIN
    CREATE TABLE model.BrandKit (
        Id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_model_BrandKit PRIMARY KEY,
        TenantId    BIGINT         NOT NULL,
        Name        NVARCHAR(80)   NOT NULL,
        Kit         NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_model_BrandKit_Kit CHECK (ISJSON(Kit) = 1),
        CreatedBy   BIGINT         NOT NULL,
        CreatedAt   DATETIME2(3)   NOT NULL CONSTRAINT DF_model_BrandKit_CreatedAt DEFAULT SYSUTCDATETIME(),
        ModifiedBy  BIGINT         NULL,
        ModifiedAt  DATETIME2(3)   NOT NULL CONSTRAINT DF_model_BrandKit_ModifiedAt DEFAULT SYSUTCDATETIME(),
        IsDeleted   BIT            NOT NULL CONSTRAINT DF_model_BrandKit_IsDeleted DEFAULT 0
    );
    CREATE UNIQUE INDEX UX_model_BrandKit_Name ON model.BrandKit (TenantId, Name) WHERE IsDeleted = 0;
END
GO
