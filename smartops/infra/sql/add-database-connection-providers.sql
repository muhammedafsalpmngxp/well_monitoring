/* ----------------------------------------------------------------------------
   core.DatabaseConnections.provider: allow the connectors added on top of
   mssql / postgres / mysql — mariadb, redshift, clickhouse, trino.
   Run once per tenant database. Idempotent.
   ---------------------------------------------------------------------------- */

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_core_DatabaseConnections_provider')
    ALTER TABLE core.DatabaseConnections DROP CONSTRAINT CK_core_DatabaseConnections_provider;
GO

ALTER TABLE core.DatabaseConnections
    ADD CONSTRAINT CK_core_DatabaseConnections_provider
    CHECK (provider IN ('mssql', 'postgres', 'mysql', 'mariadb', 'redshift', 'clickhouse', 'trino'));
GO
