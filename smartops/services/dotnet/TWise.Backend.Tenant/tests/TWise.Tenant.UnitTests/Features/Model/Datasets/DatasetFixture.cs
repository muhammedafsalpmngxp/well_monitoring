using System.Text.Json;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

/// <summary>A dataset over core.TaskDaily and ref.CrewType on connection 4 of tenant 2, as on QA.</summary>
internal static class DatasetFixture
{
    public const long TenantId = 2;

    public static readonly CatalogColumn[] Columns =
    [
        new("core", "TaskDaily", "task_daily_id", true, false, null, null, null),
        new("core", "TaskDaily", "task_code", false, false, null, null, null),
        new("core", "TaskDaily", "task_assignee", false, false, null, null, null),
        new("core", "TaskDaily", "data_hours", false, false, null, null, null),
        new("core", "TaskDaily", "project_id", false, true, "core", "Project", "project_key"),
        new("core", "TaskDaily", "crew_type_id", false, true, "ref", "CrewType", "crew_type_id"),
        new("ref", "CrewType", "crew_type_id", true, false, null, null, null),
        new("ref", "CrewType", "code", false, false, null, null, null),
        new("ref", "CrewType", "employee_count", false, false, null, null, null),
        new("core", "Project", "project_key", true, false, null, null, null),
    ];

    public static readonly MeasureNode TaskCount = new AggregateNode("count", new ColumnNode("TaskDaily", "task_daily_id"));

    public static Dataset NewDataset() => new() { Id = 1, TenantId = TenantId, ConnectionId = 4, Name = "Slice check", Status = "draft" };

    /// <summary>Connection 4 of tenant 2, the tenant database.</summary>
    public static DatabaseConnection TenantConnection() => new()
        { Id = 4, TenantId = TenantId, ConnectionName = "Tenant database", DatabaseName = "smartops_tenant_TNT-1000", Provider = "mssql" };

    /// <summary>The fixture dataset as the repository reads it for the cache, with the given parts and the fixture catalogue.</summary>
    public static ModelSnapshot Snapshot(DatasetParts parts)
        => new(0, NewDataset(), TenantConnection(), parts.Sources, parts.Relationships, parts.Measures, Columns,
            parts.CalculatedColumns, parts.Transforms);

    /// <summary>A cache with the default lifetime and size limit.</summary>
    public static ModelCache NewCache() => new(TimeSpan.FromMinutes(10), 200_000);

    public static DatasetSource Tasks() => new()
        { Id = 1, DatasetId = 1, SourceKind = "table", SchemaName = "core", SourceName = "TaskDaily", Alias = "TaskDaily", RlsMode = "none" };

    public static DatasetSource Crews() => new()
        { Id = 2, DatasetId = 1, SourceKind = "table", SchemaName = "ref", SourceName = "CrewType", Alias = "CrewType", RlsMode = "none" };

    public static DatasetSource Projects() => new()
        { Id = 3, DatasetId = 1, SourceKind = "table", SchemaName = "core", SourceName = "Project", Alias = "Project", RlsMode = "none" };

    public static DatasetRelationship TasksToProjects() => new()
    {
        Id = 11, DatasetId = 1, FromSourceId = 1, FromColumn = "project_id", ToSourceId = 3, ToColumn = "project_key",
        Cardinality = "many_to_one", IsActive = true, DetectedFrom = "fk",
    };

    public static DatasetRelationship TasksToCrews() => new()
    {
        Id = 10, DatasetId = 1, FromSourceId = 1, FromColumn = "crew_type_id", ToSourceId = 2, ToColumn = "crew_type_id",
        Cardinality = "many_to_one", IsActive = true, DetectedFrom = "fk",
    };

    public static DatasetMeasure Measure(long id, string name, MeasureNode expression) => new()
        { Id = id, DatasetId = 1, Name = name, ExpressionAst = Json(expression) };

    public static string Json(MeasureNode node) => JsonSerializer.Serialize(node, MeasureNode.JsonOptions);

    /// <summary>The expression as a client sends it in a request body.</summary>
    public static JsonElement Element(MeasureNode node) => JsonSerializer.SerializeToElement(node, MeasureNode.JsonOptions);

    /// <summary>Sources, relationships, measures, calculated columns and transforms in any order.</summary>
    public static DatasetParts Parts(params object[] items) => new(
        items.OfType<DatasetSource>().ToList(), items.OfType<DatasetRelationship>().ToList(), items.OfType<DatasetMeasure>().ToList(),
        items.OfType<DatasetCalculatedColumn>().ToList(), items.OfType<DatasetTransform>().ToList());

    /// <summary>A calculated column of a table of dataset 1 (TaskDaily unless sourceId says otherwise), stored as the API stores it.</summary>
    public static DatasetCalculatedColumn Calculated(long id, string name, MeasureNode expression, long sourceId = 1) => new()
    {
        Id = id, DatasetId = 1, SourceId = sourceId, Name = name, ExpressionAst = Json(expression),
        ExpressionText = MeasureText.Print(expression), DataType = QueryCompiler.ResultType(expression) == "nvarchar" ? "text" : "number",
    };

    /// <summary>A transform of a column of a table of dataset 1 (TaskDaily unless sourceId says otherwise).</summary>
    public static DatasetTransform Transform(long id, string column, string kind, string? value = null, int sortOrder = 1, long sourceId = 1) => new()
    {
        Id = id, DatasetId = 1, SourceId = sourceId, ColumnName = column, Kind = kind,
        ConfigJson = value is null ? "{}" : JsonSerializer.Serialize(new { value }), SortOrder = sortOrder,
    };

    /// <summary>A repository holding one dataset with the given parts and the fixture catalogue.</summary>
    public static Mock<IDatasetRepository> Repo(Dataset dataset, DatasetParts parts)
    {
        var repo = new Mock<IDatasetRepository>();
        repo.Setup(r => r.GetAsync(dataset.Id, dataset.TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(dataset);
        repo.Setup(r => r.GetConnectionsAsync(dataset.TenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([TenantConnection(), new DatabaseConnection { Id = 10005, TenantId = TenantId, ConnectionName = "AlTasnimBI", DatabaseName = "AlTasnimBI", Provider = "mssql" }]);
        repo.Setup(r => r.TenantDatabaseName).Returns("smartops_tenant_TNT-1000");
        repo.Setup(r => r.GetPartsAsync(dataset.Id, It.IsAny<CancellationToken>())).ReturnsAsync(parts);
        repo.Setup(r => r.GetColumnsAsync(dataset.ConnectionId, dataset.TenantId, It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Columns);
        repo.Setup(r => r.GetViewSourceColumnsAsync(dataset.ConnectionId, dataset.TenantId, It.IsAny<IReadOnlyCollection<DatasetSource>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<CatalogColumn>());
        repo.Setup(r => r.RemoveSourceAsync(dataset.Id, It.IsAny<long>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);
        repo.Setup(r => r.GetSnapshotAsync(dataset.Id, dataset.TenantId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => Snapshot(parts) with { Dataset = dataset });
        return repo;
    }
}
