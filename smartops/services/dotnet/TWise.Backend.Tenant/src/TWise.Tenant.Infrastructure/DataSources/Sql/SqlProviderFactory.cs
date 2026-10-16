using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.DataSources.Sql;

/// <summary>Resolves an <see cref="ISqlDialectProvider"/> by provider key, case-insensitively.</summary>
public sealed class SqlProviderFactory : ISqlProviderFactory
{
    private readonly Dictionary<string, ISqlDialectProvider> _providers;

    public SqlProviderFactory(IEnumerable<ISqlDialectProvider> providers)
    {
        _providers = providers.ToDictionary(p => p.Provider, StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyList<string> SupportedProviders => _providers.Keys.OrderBy(k => k).ToList();

    public ISqlDialectProvider Get(string provider)
    {
        // Older rows predate the provider column being populated — treat blank as SQL Server.
        var key = string.IsNullOrWhiteSpace(provider) ? "mssql" : provider.Trim();

        if (_providers.TryGetValue(key, out var found)) return found;

        throw new NotSupportedException(
            $"Provider '{provider}' is not supported. Supported providers: {string.Join(", ", SupportedProviders)}.");
    }

    public ISqlDialectProvider Get(DatabaseConnection connection) => Get(connection.Provider);
}
