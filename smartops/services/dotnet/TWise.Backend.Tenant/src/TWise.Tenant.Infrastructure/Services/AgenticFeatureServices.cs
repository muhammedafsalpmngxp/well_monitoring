using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// The verified SQL of the Agentic Features in core.AiFeatureQuery. The seed (Resources/agentic-features.seed.json) is
/// copied into the tenant's database the first time a feature is used in this process, and again when a newer seed
/// changes a query nobody edited (seed_hash is the hash of the seed it was copied from; NULL once edited by hand).
/// Queries are always read from the database. Only the seed's keys are sent: the runtime's code asks for those.
/// </summary>
public sealed class AiFeatureQueryStore(TenantDbContext db, ILogger<AiFeatureQueryStore> logger) : IAiFeatureQueryStore
{
    private const string SystemUser = "system";
    private static readonly ConcurrentDictionary<(long, string), bool> Synced = new();

    public async Task<IReadOnlyDictionary<string, FeatureQueryPayload>> GetAsync(long tenantId, string feature, CancellationToken ct)
    {
        var rows = await RowsAsync(tenantId, feature, ct);
        return rows.ToDictionary(r => r.QueryKey, r => new FeatureQueryPayload(r.SqlText, Strings(r.ParamsJson), Strings(r.ColumnsJson)),
            StringComparer.Ordinal);
    }

    public async Task<IReadOnlyList<AgenticFeatureQueryDto>> ListAsync(long tenantId, string feature, CancellationToken ct)
    {
        var seed = AgenticFeatureCatalog.Get(feature).Queries.ToDictionary(q => q.Key, StringComparer.Ordinal);
        return (await RowsAsync(tenantId, feature, ct))
            .Select(r => new AgenticFeatureQueryDto(r.QueryKey, r.Label, r.Description, r.SqlText, Strings(r.ParamsJson),
                Strings(r.ColumnsJson), r.ModifiedAt, r.SeedHash is null || seed.TryGetValue(r.QueryKey, out var s) && Hash(s) != r.SeedHash))
            .ToList();
    }

    private async Task<List<AiFeatureQuery>> RowsAsync(long tenantId, string feature, CancellationToken ct)
    {
        var seed = AgenticFeatureCatalog.Get(feature);
        if (seed.Queries.Count == 0) return [];
        if (!Synced.ContainsKey((tenantId, feature)))
        {
            await SyncAsync(tenantId, seed, ct);
            Synced[(tenantId, feature)] = true;
        }
        var keys = seed.Queries.Select(q => q.Key).ToList();
        var rows = await db.AiFeatureQueries.AsNoTracking()
            .Where(q => q.TenantId == tenantId && q.Feature == feature && keys.Contains(q.QueryKey))
            .ToListAsync(ct);
        return rows.OrderBy(r => keys.IndexOf(r.QueryKey)).ToList();
    }

    /// <summary>Adds the seed's missing queries and upgrades those still as seeded. A concurrent first use of the same
    /// feature may insert the same row: the unique index refuses one of them, and the loser re-reads.</summary>
    private async Task SyncAsync(long tenantId, FeatureSeed seed, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var existing = await db.AiFeatureQueries
                .Where(q => q.TenantId == tenantId && q.Feature == seed.Key)
                .ToDictionaryAsync(q => q.QueryKey, StringComparer.Ordinal, ct);
            var changed = 0;
            foreach (var q in seed.Queries)
            {
                var hash = Hash(q);
                if (!existing.TryGetValue(q.Key, out var row))
                {
                    db.AiFeatureQueries.Add(Copy(new AiFeatureQuery { TenantId = tenantId, Feature = seed.Key, QueryKey = q.Key }, q, hash));
                    changed++;
                }
                else if (row.SeedHash is not null && row.SeedHash != hash)
                {
                    Copy(row, q, hash);
                    changed++;
                }
            }
            if (changed == 0) return;
            try
            {
                await db.SaveChangesAsync(ct);
                logger.LogInformation("Agentic Feature {Feature}: {Count} verified queries seeded or upgraded for tenant {TenantId}.",
                    seed.Key, changed, tenantId);
                return;
            }
            catch (DbUpdateException) when (attempt < 3)
            {
                db.ChangeTracker.Clear();
            }
        }
    }

    private static AiFeatureQuery Copy(AiFeatureQuery row, FeatureQuerySeed q, string hash)
    {
        row.Label = q.Label;
        row.Description = q.Description;
        row.SqlText = q.Sql;
        row.ParamsJson = JsonSerializer.Serialize(q.Params);
        row.ColumnsJson = JsonSerializer.Serialize(q.Columns);
        row.SeedHash = hash;
        row.ModifiedBy = SystemUser;
        row.ModifiedAt = DateTime.UtcNow;
        return row;
    }

    /// <summary>SHA-256 of what the seed says about a query (lower-case hex, 64 characters).</summary>
    internal static string Hash(FeatureQuerySeed q) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
            new object?[] { q.Label, q.Description, q.Sql, q.Params, q.Columns })))).ToLowerInvariant();

    private static IReadOnlyList<string> Strings(string json)
    {
        try { return JsonSerializer.Deserialize<List<string>>(json) ?? []; }
        catch (JsonException) { return []; }
    }
}

/// <summary>The envelope of a feature request: the tenant's AI provider (only when the call needs it), the feature's
/// prompts, settings, readable tables and verified SQL, all from the tenant database.</summary>
public sealed class AgenticFeatureContext(IAiSettingsRepository settings, IAiPromptStore prompts, IAiFeatureQueryStore queries,
    IAiService ai) : IAgenticFeatureContext
{
    public async Task<AgenticFeatureEnvelope> BuildAsync(long tenantId, string feature, bool needsAi, CancellationToken ct)
    {
        var seed = AgenticFeatureCatalog.Get(feature);
        AgentRuntimeLlm? llm = null;
        if (needsAi)
        {
            var (p, key) = await ai.ResolveProviderAsync(tenantId, ct);
            llm = new AgentRuntimeLlm(p.Provider, p.BaseUrl, p.Model, key, p.FastModel);
        }
        var state = AgenticFeatureSettingsRules.Resolve(seed, AgenticFeatureSettingsRules.Stored(await settings.GetAsync(tenantId, ct), feature));
        var texts = AiPromptCatalog.FeatureTexts(await prompts.GetAsync(tenantId, ct), feature);
        var verified = await queries.GetAsync(tenantId, feature, ct);
        return new AgenticFeatureEnvelope(llm, texts, state.Values, state.Access, verified);
    }
}

/// <summary>Calls the agent runtime for a feature and logs each model call it reports ("usage") in core.AiUsageLog with
/// the feature as purpose, so the daily quota and the AI activity page count them.</summary>
public sealed class AgenticFeatureGateway(IAgenticFeatureContext context, IAgentRuntimeClient runtime, IAiUsageRepository usage)
    : IAgenticFeatureGateway
{
    public async Task<JsonElement> CallAsync(long tenantId, string? userId, string feature, string path, object? body, bool needsAi,
        CancellationToken ct)
    {
        var envelope = await context.BuildAsync(tenantId, feature, needsAi, ct);
        var result = await runtime.FeatureCallAsync(feature, path, envelope, body, ct);
        await LogUsageAsync(usage, tenantId, userId, feature, result);
        return result;
    }

    public async Task<AskDataExportFile> FileAsync(long tenantId, string feature, string path, object? body, CancellationToken ct)
    {
        var envelope = await context.BuildAsync(tenantId, feature, needsAi: false, ct);
        return await runtime.FeatureFileAsync(feature, path, envelope, body, ct);
    }

    /// <summary>One row per entry of the reply's "usage" array ({agent, model, calls, input, output}).</summary>
    internal static async Task LogUsageAsync(IAiUsageRepository usage, long tenantId, string? userId, string feature, JsonElement reply)
    {
        if (reply.ValueKind != JsonValueKind.Object || !reply.TryGetProperty("usage", out var rows) || rows.ValueKind != JsonValueKind.Array)
            return;
        foreach (var u in rows.EnumerateArray())
        {
            if (u.ValueKind != JsonValueKind.Object) continue;
            await usage.AddAsync(new AiUsageLog
            {
                TenantId = tenantId, UserId = userId, Purpose = feature,
                Model = u.TryGetProperty("model", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "",
                PromptTokens = Int(u, "input"), CompletionTokens = Int(u, "output"), Succeeded = true,
            }, CancellationToken.None);
        }
    }

    private static int Int(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var i)
            ? (int)Math.Clamp(i, 0, int.MaxValue) : 0;
}
