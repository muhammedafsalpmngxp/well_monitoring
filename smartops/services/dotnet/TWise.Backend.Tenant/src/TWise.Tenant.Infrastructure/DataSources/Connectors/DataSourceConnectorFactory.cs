using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.DataSources.Connectors;

/// <summary>Resolves an <see cref="IDataSourceConnector"/> by kind, case-insensitively.</summary>
public sealed class DataSourceConnectorFactory : IDataSourceConnectorFactory
{
    private readonly Dictionary<string, IDataSourceConnector> _connectors;

    public DataSourceConnectorFactory(IEnumerable<IDataSourceConnector> connectors)
    {
        _connectors = connectors.ToDictionary(c => c.Kind, StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyList<string> SupportedKinds => _connectors.Keys.OrderBy(k => k).ToList();

    public IDataSourceConnector Get(string kind)
    {
        if (!string.IsNullOrWhiteSpace(kind) && _connectors.TryGetValue(kind.Trim(), out var found))
            return found;

        throw new NotSupportedException(
            $"Data source kind '{kind}' is not supported. Supported kinds: {string.Join(", ", SupportedKinds)}.");
    }

    public IDataSourceConnector Get(DataSourceConnection connection) => Get(connection.Kind);
}
