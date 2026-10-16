using MediatR;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Model.Datasets;

// Every command carries the caller's tenant id, taken from the token by the controller.
// Changes return the whole dataset so the client can swap it in. Every change to an existing
// dataset implements IChangesDataset, which moves its cache version (DatasetChangeBehavior).

// ── Datasets ───────────────────────────────────────────────────────────────────

public record ListDatasetsQuery(long TenantId) : IRequest<Result<IReadOnlyList<DatasetSummaryDto>>>;

public record GetDatasetQuery(long Id, long TenantId) : IRequest<Result<DatasetDetailDto>>;

/// <summary>The connections a new dataset may use: active SQL Server connections of the tenant.</summary>
public record ListDatasetConnectionsQuery(long TenantId) : IRequest<Result<IReadOnlyList<DatasetConnectionDto>>>;

/// <summary>View Builder views on the dataset's connection, for the Get Data navigator.</summary>
public record ListDatasetViewsQuery(long DatasetId, long TenantId) : IRequest<Result<IReadOnlyList<ViewChoiceDto>>>;

/// <summary>The tenant's connections, for the Get Data database choice, each saying whether the dataset can add its tables.</summary>
public record ListSourceConnectionsQuery(long DatasetId, long TenantId) : IRequest<Result<IReadOnlyList<DatasetConnectionDto>>>;

/// <summary>A new dataset has nothing cached, so this is the one change without IChangesDataset.</summary>
public record CreateDatasetCommand(CreateDatasetRequest Request, long TenantId, long UserId) : IRequest<Result<DatasetDetailDto>>;

public record UpdateDatasetCommand(long Id, UpdateDatasetRequest Request, long TenantId, long UserId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset
{
    long IChangesDataset.DatasetId => Id;
}

public record DeleteDatasetCommand(long Id, long TenantId, long UserId) : IRequest<Result>, IChangesDataset
{
    long IChangesDataset.DatasetId => Id;
}

// ── Sources ────────────────────────────────────────────────────────────────────

public record AddSourceCommand(long DatasetId, AddSourceRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record SetSourceDetailsCommand(long DatasetId, long SourceId, SourceDetailsRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record SetHiddenColumnsCommand(long DatasetId, long SourceId, HiddenColumnsRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record UpdateSourceCommand(long DatasetId, long SourceId, UpdateSourceRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record RemoveSourceCommand(long DatasetId, long SourceId, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

/// <summary>Replaces the bindings of a saved view's variables to model fields; a variable left out is unbound.</summary>
public record SetSourceParametersCommand(long DatasetId, long SourceId, IReadOnlyList<ParameterBindingRequest> Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

/// <summary>Reads a view source's view again, checks it as when it was added, and stores its SQL as it is now.</summary>
public record RefreshViewSourceCommand(long DatasetId, long SourceId, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

// ── Relationships ──────────────────────────────────────────────────────────────

public record AddRelationshipCommand(long DatasetId, AddRelationshipRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record UpdateRelationshipCommand(long DatasetId, long RelationshipId, UpdateRelationshipRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record RemoveRelationshipCommand(long DatasetId, long RelationshipId, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record GetRelationshipSuggestionsQuery(long DatasetId, long TenantId) : IRequest<Result<IReadOnlyList<RelationshipSuggestionDto>>>;

// ── Measures ───────────────────────────────────────────────────────────────────

public record AddMeasureCommand(long DatasetId, SaveMeasureRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record UpdateMeasureCommand(long DatasetId, long MeasureId, SaveMeasureRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record RemoveMeasureCommand(long DatasetId, long MeasureId, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

// ── Calculated columns ─────────────────────────────────────────────────────────

public record AddCalculatedColumnCommand(long DatasetId, SaveCalculatedColumnRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record UpdateCalculatedColumnCommand(long DatasetId, long ColumnId, UpdateCalculatedColumnRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record RemoveCalculatedColumnCommand(long DatasetId, long ColumnId, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

// ── Publishing ─────────────────────────────────────────────────────────────────

public record PublishDatasetCommand(long DatasetId, long TenantId, long UserId) : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record DiscardDraftCommand(long DatasetId, long TenantId) : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record PlaceMeasureCommand(long DatasetId, long MeasureId, MeasurePlacementRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

// ── Formula checks (write nothing, so they do not change the dataset) ─────────

public record CheckMeasureQuery(long DatasetId, CheckMeasureRequest Request, long TenantId) : IRequest<Result<FormulaCheckDto>>;

public record CheckCalculatedColumnQuery(long DatasetId, CheckCalculatedColumnRequest Request, long TenantId) : IRequest<Result<FormulaCheckDto>>;

// ── Transforms ─────────────────────────────────────────────────────────────────

public record AddTransformCommand(long DatasetId, AddTransformRequest Request, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;

public record RemoveTransformCommand(long DatasetId, long TransformId, long TenantId)
    : IRequest<Result<DatasetDetailDto>>, IChangesDataset;
