namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>MariaDB speaks the MySQL protocol; MySqlConnector serves both. Own key so the UI can name it.</summary>
public sealed class MariaDbDialectProvider : MySqlDialectProvider
{
    public override string Provider => "mariadb";
}
