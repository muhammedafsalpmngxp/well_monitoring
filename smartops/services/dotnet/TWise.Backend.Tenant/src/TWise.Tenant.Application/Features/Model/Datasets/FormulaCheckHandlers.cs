using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.Application.Features.Model.Datasets;

/// <summary>
/// Runs the checks that saving a measure runs, and writes nothing, so the formula dialog can show a
/// problem while the modeller types instead of only on Save. A blank name skips the name check.
/// </summary>
public sealed class CheckMeasureHandler(IDatasetRepository repo) : IRequestHandler<CheckMeasureQuery, Result<FormulaCheckDto>>
{
    public async Task<Result<FormulaCheckDto>> Handle(CheckMeasureQuery cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return Result<FormulaCheckDto>.NotFound("The data model does not exist.");
        if (DatasetRules.ReadMeasure(cmd.Request.Expression) is not { } expression)
            return Result<FormulaCheckDto>.ValidationError("Build the measure before saving it.");

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        var name = cmd.Request.Name.Trim();
        if (name.Length > 0 && parts.Measures.Any(m => m.Id != cmd.Request.MeasureId && string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)))
            return Result<FormulaCheckDto>.Conflict($"A measure called \"{name}\" already exists in this data model.");

        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var ast = DatasetRules.CheckMeasure(dataset.Id, name.Length > 0 ? name : "the measure", expression, parts.Sources,
            parts.Relationships, columns, parts.CalculatedColumns, parts.Transforms, parts.Measures);
        return ast.IsSuccess ? Result<FormulaCheckDto>.Success(new FormulaCheckDto("number")) : FormulaCheck.Failed(ast);
    }
}

/// <summary>The checks that saving a calculated column runs, as a new column or as a change to ColumnId, writing nothing.</summary>
public sealed class CheckCalculatedColumnHandler(IDatasetRepository repo) : IRequestHandler<CheckCalculatedColumnQuery, Result<FormulaCheckDto>>
{
    public async Task<Result<FormulaCheckDto>> Handle(CheckCalculatedColumnQuery cmd, CancellationToken ct)
    {
        if (await repo.GetAsync(cmd.DatasetId, cmd.TenantId, ct) is not { } dataset) return Result<FormulaCheckDto>.NotFound("The data model does not exist.");
        if (DatasetRules.ReadMeasure(cmd.Request.Expression) is not { } expression)
            return Result<FormulaCheckDto>.ValidationError("Build the calculated column before saving it.");

        var parts = await repo.GetPartsAsync(dataset.Id, ct);
        var stored = cmd.Request.ColumnId is { } columnId ? parts.CalculatedColumns.FirstOrDefault(c => c.Id == columnId) : null;
        if (cmd.Request.ColumnId is not null && stored is null)
            return Result<FormulaCheckDto>.NotFound("The calculated column is not part of this data model.");
        var sourceId = stored?.SourceId ?? cmd.Request.SourceId;
        if (parts.Sources.FirstOrDefault(s => s.Id == sourceId) is not { } source)
            return Result<FormulaCheckDto>.ValidationError("The table is not part of this data model.");

        var others = stored is null ? parts : parts with { CalculatedColumns = parts.CalculatedColumns.Where(c => c.Id != stored.Id).ToList() };
        var columns = await DatasetFlow.ColumnsAsync(repo, dataset, parts.Sources, ct);
        var name = cmd.Request.Name.Trim();
        var column = DatasetRules.NewCalculatedColumn(dataset.Id, source, name.Length > 0 ? name : "New column", expression, others, columns);
        if (!column.IsSuccess) return FormulaCheck.Failed(column);

        if (stored is not null)
        {
            column.Value!.Id = stored.Id;
            var broken = DatasetFlow.BreaksADependant(parts, others with { CalculatedColumns = [.. others.CalculatedColumns, column.Value] }, columns);
            if (broken is not null) return FormulaCheck.Failed(broken);
        }
        return Result<FormulaCheckDto>.Success(new FormulaCheckDto(column.Value!.DataType));
    }
}

internal static class FormulaCheck
{
    public static Result<FormulaCheckDto> Failed<T>(Result<T> failed) => failed.Status switch
    {
        ResultStatus.Conflict => Result<FormulaCheckDto>.Conflict(failed.ErrorMessage!),
        ResultStatus.NotFound => Result<FormulaCheckDto>.NotFound(failed.ErrorMessage!),
        _ => Result<FormulaCheckDto>.ValidationError(failed.ErrorMessage!),
    };
}
