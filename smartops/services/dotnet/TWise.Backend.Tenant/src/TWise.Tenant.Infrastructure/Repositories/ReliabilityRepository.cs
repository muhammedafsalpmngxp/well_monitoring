using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class ReliabilityRepository(TenantDbContext db) : IReliabilityRepository
{
    private const string NoData = "N/a";

    public async Task<IReadOnlyList<DataRule>> GetScoredRulesAsync(CancellationToken cancellationToken = default)
        => await db.DataRules
            .AsNoTracking()
            .Where(rule => rule.ReliabilityScore != null
                && ((rule.Fields != null && rule.Fields != "") || rule.ViewId != null))
            .Select(rule => new DataRule
            {
                RuleId = rule.RuleId,
                TableName = rule.TableName,
                Fields = rule.Fields,
                SourceType = rule.SourceType,
                ViewId = rule.ViewId,
                ReliabilityScore = rule.ReliabilityScore
            })
            .ToListAsync(cancellationToken);

    public async Task<TableReliabilityDto> GetTableReliabilityAsync(string tableName, CancellationToken cancellationToken = default)
    {
        var unqualifiedTableName = tableName.Contains('.')
            ? tableName[(tableName.LastIndexOf('.') + 1)..]
            : tableName;

        // Keep the database read LINQ-translated; grouping latest records is done
        // in memory because EF Core cannot translate this GroupBy/First shape.
        var openRuleLogs = await db.DataRules
            .Where(rule => rule.TableName == tableName
                || rule.TableName == unqualifiedTableName
                || rule.TableName.EndsWith("." + unqualifiedTableName))
            .SelectMany(rule => rule.ErrorLogs
                .Where(error => error.Status == "Open")
                .Select(error => new
                {
                    rule.Category,
                    error.CreatedAt,
                    error.RecordsFound,
                    error.RecordsTotal
                }))
            .ToListAsync(cancellationToken);

        var latestByCategory = openRuleLogs
            .GroupBy(error => error.Category, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(error => error.CreatedAt).First())
            .Where(error => error.RecordsFound.HasValue && error.RecordsTotal.HasValue && error.RecordsTotal > 0)
            .ToList();

        if (latestByCategory.Count == 0)
            return new TableReliabilityDto(null, NoData);

        // Reliability = correctness %: 100 minus the error rate (found/total), matching views.
        var score = Math.Clamp(latestByCategory.Average(error =>
            100m - ((decimal)error.RecordsFound!.Value / error.RecordsTotal!.Value * 100m)), 0m, 100m);
        var categories = latestByCategory
            .Select(error => error.Category)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(category => category)
            .ToArray();

        return new TableReliabilityDto(
            Math.Floor(score * 100m) / 100m,
            $"The reliability score is calculated using validation rules that check {string.Join(", ", categories)}.");
    }
}