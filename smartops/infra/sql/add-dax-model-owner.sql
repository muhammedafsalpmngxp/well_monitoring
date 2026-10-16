/* ----------------------------------------------------------------------------
   core.DaxModels.created_by: who created each DAX model. Each user sees only
   their own models; admins see all. Models saved before this column existed
   stay NULL (visible to admins only); to give them to a user run e.g.
     UPDATE core.DaxModels SET created_by = <userId> WHERE created_by IS NULL;
   Run once per tenant database. Idempotent; GO-free (one script in DBeaver / SSMS).
   ---------------------------------------------------------------------------- */

IF COL_LENGTH('core.DaxModels', 'created_by') IS NULL
    ALTER TABLE core.DaxModels ADD created_by BIGINT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_core_DaxModels_created_by' AND object_id = OBJECT_ID('core.DaxModels'))
    EXEC(N'CREATE INDEX IX_core_DaxModels_created_by ON core.DaxModels (created_by, created_at DESC);');
