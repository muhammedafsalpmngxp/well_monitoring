using System.Data;
using System.Data.Common;
using System.Reflection;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// The tenant's AI prompts in the tenant database (see IAiPromptStore):
///   core.AiSettings.prompts_json  the active text of every prompt, {key: text}
///   core.AiSettings.row_ver       rowversion: the cache is refreshed when it changes (any server's save)
///   core.AiPromptHistory          every version; version 1 of a key is its original ('seed'), is_current marks the live one
/// Saves, restores and seeding each run in one transaction holding an update lock on the tenant's AiSettings row, so
/// concurrent requests cannot interleave. The seed (Resources/ai-prompts.seed.json) is only copied into the database;
/// prompts are always read from the database.
/// </summary>
public sealed class AiPromptStore(TenantDbContext db, IMemoryCache cache, ILogger<AiPromptStore> logger) : IAiPromptStore
{
    private const string SystemUser = "system";
    private static readonly JsonSerializerOptions JsonOut = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private static readonly Lazy<IReadOnlyDictionary<string, string>> SeedTexts = new(LoadSeed);

    /// <summary>The texts every tenant starts with, from the embedded seed file. Checked against the catalog.</summary>
    public static IReadOnlyDictionary<string, string> Seed => SeedTexts.Value;

    private sealed record Cached(byte[] RowVer, IReadOnlyDictionary<string, string> Texts);
    private sealed record Current(int Version, string Body, string ChangedBy, DateTime ChangedAt);

    public async Task<IReadOnlyDictionary<string, string>> GetAsync(long tenantId, CancellationToken ct)
    {
        var key = CacheKey(tenantId);
        var rowVer = await ScalarAsync<byte[]>("SELECT row_ver FROM core.AiSettings WHERE tenant_id = @t", null, ct, ("@t", tenantId));
        if (rowVer is not null && cache.TryGetValue(key, out Cached? hit) && hit!.RowVer.AsSpan().SequenceEqual(rowVer))
            return hit.Texts;

        var texts = AiPrompts.Parse(await ScalarAsync<string>("SELECT prompts_json FROM core.AiSettings WHERE tenant_id = @t", null, ct, ("@t", tenantId)));
        if (rowVer is null || AiPromptCatalog.All.Any(d => !texts.ContainsKey(d.Key)) || !await HistoryCompleteAsync(tenantId, ct))
        {
            await SeedAsync(tenantId, ct);
            rowVer = await ScalarAsync<byte[]>("SELECT row_ver FROM core.AiSettings WHERE tenant_id = @t", null, ct, ("@t", tenantId));
            texts = AiPrompts.Parse(await ScalarAsync<string>("SELECT prompts_json FROM core.AiSettings WHERE tenant_id = @t", null, ct, ("@t", tenantId)));
        }
        cache.Set(key, new Cached(rowVer!, texts), TimeSpan.FromMinutes(30));
        return texts;
    }

    public async Task<IReadOnlyList<AiPromptItemDto>> ListAsync(long tenantId, CancellationToken ct)
    {
        var texts = await GetAsync(tenantId, ct);
        var current = new Dictionary<string, Current>(StringComparer.Ordinal);
        var original = new Dictionary<string, string>(StringComparer.Ordinal);
        await ReadAsync("""
            SELECT prompt_key, version_no, body, changed_by, changed_at, is_current FROM core.AiPromptHistory
            WHERE tenant_id = @t AND (is_current = 1 OR version_no = 1)
            """, null, ct, r =>
        {
            var k = r.GetString(0);
            if (r.GetInt32(1) == 1) original[k] = r.GetString(2);
            if (r.GetBoolean(5)) current[k] = new Current(r.GetInt32(1), r.GetString(2), r.GetString(3), r.GetDateTime(4));
        }, ("@t", tenantId));
        return AiPromptCatalog.All.Select(d =>
        {
            var c = current.TryGetValue(d.Key, out var cur) ? cur : new Current(1, texts[d.Key], SystemUser, DateTime.UtcNow);
            return Item(d, texts[d.Key], original.TryGetValue(d.Key, out var o) ? o : texts[d.Key], c);
        }).ToList();
    }

    public async Task<IReadOnlyList<AiPromptVersionDto>> HistoryAsync(long tenantId, string key, CancellationToken ct)
    {
        AiPromptCatalog.Get(key);
        await GetAsync(tenantId, ct);
        var versions = new List<AiPromptVersionDto>();
        await ReadAsync("""
            SELECT version_no, action, note, changed_by, changed_at, is_current, body FROM core.AiPromptHistory
            WHERE tenant_id = @t AND prompt_key = @k ORDER BY version_no DESC
            """, null, ct, r => versions.Add(new AiPromptVersionDto(r.GetInt32(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2),
                r.GetString(3), DateTime.SpecifyKind(r.GetDateTime(4), DateTimeKind.Utc), r.GetBoolean(5), r.GetString(6))),
            ("@t", tenantId), ("@k", key));
        return versions;
    }

    public Task<AiPromptItemDto> SaveAsync(long tenantId, string key, string? text, string? note, int? expectedVersion, string userId, CancellationToken ct) =>
        WriteAsync(tenantId, key, _ => (text ?? "").Trim(), "update", note, expectedVersion, userId, ct);

    public Task<AiPromptItemDto> RestoreAsync(long tenantId, string key, int version, int? expectedVersion, string? note, string userId, CancellationToken ct) =>
        WriteAsync(tenantId, key, versions => versions.TryGetValue(version, out var body)
                ? body
                : throw new InvalidOperationException($"Version {version} of this prompt does not exist."),
            "restore", string.IsNullOrWhiteSpace(note) ? (version == 1 ? "Restored the original" : $"Restored version {version}") : note,
            expectedVersion, userId, ct);

    /// <summary>One new version of one prompt, atomically: history row, previous version no longer current, prompts_json.</summary>
    private async Task<AiPromptItemDto> WriteAsync(long tenantId, string key, Func<IReadOnlyDictionary<int, string>, string> newText,
        string action, string? note, int? expectedVersion, string userId, CancellationToken ct)
    {
        var def = AiPromptCatalog.Get(key);
        await GetAsync(tenantId, ct);   // seeds the tenant first if needed
        var strategy = db.Database.CreateExecutionStrategy();
        var item = await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            var dbTx = tx.GetDbTransaction();
            var texts = new Dictionary<string, string>(AiPrompts.Parse(await ScalarAsync<string>(
                "SELECT prompts_json FROM core.AiSettings WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @t", dbTx, ct, ("@t", tenantId))));
            var versions = new Dictionary<int, string>();
            Current? current = null;
            await ReadAsync("""
                SELECT version_no, body, changed_by, changed_at, is_current FROM core.AiPromptHistory WITH (UPDLOCK)
                WHERE tenant_id = @t AND prompt_key = @k
                """, dbTx, ct, r =>
            {
                versions[r.GetInt32(0)] = r.GetString(1);
                if (r.GetBoolean(4)) current = new Current(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetDateTime(3));
            }, ("@t", tenantId), ("@k", key));
            if (current is null || !versions.TryGetValue(1, out var original))
                throw new InvalidOperationException($"The AI prompt '{key}' has no history yet. Reload the page and try again.");
            if (expectedVersion is { } expected && expected != current.Version)
                throw new InvalidOperationException($"Someone saved version {current.Version} of this prompt after you opened version {expected}. " +
                                                    "Reload to see it, then save again.");

            var text = newText(versions);
            if (AiPromptCatalog.Problem(def, text, original) is { } problem) throw new InvalidOperationException(problem);
            if (text == current.Body)
            {
                await tx.RollbackAsync(ct);
                return Item(def, current.Body, original, current);
            }

            var next = versions.Keys.Max() + 1;
            var now = DateTime.UtcNow;
            await ExecAsync("UPDATE core.AiPromptHistory SET is_current = 0 WHERE tenant_id = @t AND prompt_key = @k AND is_current = 1",
                dbTx, ct, ("@t", tenantId), ("@k", key));
            await InsertVersionAsync(dbTx, tenantId, key, next, text, action, note, userId, now, isCurrent: true, ct);
            texts[key] = text;
            await ExecAsync("UPDATE core.AiSettings SET prompts_json = @j, modified_by = @u, modified_at = @now WHERE tenant_id = @t",
                dbTx, ct, ("@j", JsonSerializer.Serialize(texts, JsonOut)), ("@u", Trim(userId, 100)), ("@now", now), ("@t", tenantId));
            await tx.CommitAsync(ct);
            logger.LogInformation("AI prompt {Key} saved as version {Version} ({Action}) for tenant {TenantId} by {User}", key, next, action, tenantId, userId);
            return Item(def, text, original, new Current(next, text, userId, now));
        });
        cache.Remove(CacheKey(tenantId));
        return item;
    }

    /// <summary>
    /// Copies every catalog key the tenant lacks from the seed: into prompts_json and as version 1 ('seed') in the history.
    /// A key already in prompts_json without history (customised before history existed) keeps its text: the seed is
    /// recorded as version 1 and the tenant's text as version 2. Creates the AiSettings row (AI off) when there is none.
    /// </summary>
    private async Task SeedAsync(long tenantId, CancellationToken ct)
    {
        var seed = Seed;
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            var dbTx = tx.GetDbTransaction();
            await ExecAsync("""
                IF NOT EXISTS (SELECT 1 FROM core.AiSettings WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @t)
                    INSERT INTO core.AiSettings (tenant_id, created_by, modified_by) VALUES (@t, @u, @u)
                """, dbTx, ct, ("@t", tenantId), ("@u", SystemUser));
            var json = await ScalarAsync<string>("SELECT prompts_json FROM core.AiSettings WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @t",
                dbTx, ct, ("@t", tenantId));
            var texts = new Dictionary<string, string>(AiPrompts.Parse(json));
            var currentBodies = new Dictionary<string, string>(StringComparer.Ordinal);
            var maxVersion = new Dictionary<string, int>(StringComparer.Ordinal);
            await ReadAsync("""
                SELECT prompt_key, version_no, body, is_current FROM core.AiPromptHistory WITH (UPDLOCK, HOLDLOCK) WHERE tenant_id = @t
                """, dbTx, ct, r =>
            {
                var k = r.GetString(0);
                maxVersion[k] = Math.Max(maxVersion.GetValueOrDefault(k), r.GetInt32(1));
                if (r.GetBoolean(3)) currentBodies[k] = r.GetString(2);
            }, ("@t", tenantId));

            var now = DateTime.UtcNow;
            var changed = false;
            foreach (var def in AiPromptCatalog.All)
            {
                var hasHistory = maxVersion.ContainsKey(def.Key);
                if (texts.TryGetValue(def.Key, out var own))
                {
                    if (hasHistory) continue;
                    var seedText = seed[def.Key];
                    await InsertVersionAsync(dbTx, tenantId, def.Key, 1, seedText, "seed", null, SystemUser, now, isCurrent: own == seedText, ct);
                    if (own != seedText)
                        await InsertVersionAsync(dbTx, tenantId, def.Key, 2, own, "update", "Customised before prompt history", SystemUser, now, isCurrent: true, ct);
                }
                else if (hasHistory && currentBodies.TryGetValue(def.Key, out var live))
                {
                    texts[def.Key] = live;   // prompts_json lost the key: put the live version back
                    changed = true;
                }
                else if (!hasHistory)
                {
                    texts[def.Key] = seed[def.Key];
                    await InsertVersionAsync(dbTx, tenantId, def.Key, 1, seed[def.Key], "seed", null, SystemUser, now, isCurrent: true, ct);
                    changed = true;
                }
            }
            if (changed)
                await ExecAsync("UPDATE core.AiSettings SET prompts_json = @j, modified_at = @now WHERE tenant_id = @t",
                    dbTx, ct, ("@j", JsonSerializer.Serialize(texts, JsonOut)), ("@now", now), ("@t", tenantId));
            await tx.CommitAsync(ct);
        });
        cache.Remove(CacheKey(tenantId));
        logger.LogInformation("AI prompts seeded for tenant {TenantId}", tenantId);
    }

    /// <summary>Every catalog key has a live version in the history (false sends GetAsync to SeedAsync once).</summary>
    private async Task<bool> HistoryCompleteAsync(long tenantId, CancellationToken ct)
    {
        var live = await ScalarAsync<int?>("SELECT COUNT(DISTINCT prompt_key) FROM core.AiPromptHistory WHERE tenant_id = @t AND is_current = 1",
            null, ct, ("@t", tenantId)) ?? 0;
        return live >= AiPromptCatalog.All.Count;
    }

    private Task InsertVersionAsync(DbTransaction tx, long tenantId, string key, int version, string body, string action, string? note,
        string userId, DateTime at, bool isCurrent, CancellationToken ct) =>
        ExecAsync("""
            INSERT INTO core.AiPromptHistory (tenant_id, prompt_key, version_no, body, action, note, changed_by, changed_at, is_current)
            VALUES (@t, @k, @v, @b, @a, @n, @u, @at, @c)
            """, tx, ct, ("@t", tenantId), ("@k", key), ("@v", version), ("@b", body), ("@a", action),
            ("@n", (object?)Trim(note, 400) ?? DBNull.Value), ("@u", Trim(userId, 200)), ("@at", at), ("@c", isCurrent));

    private static AiPromptItemDto Item(AiPromptDefinition d, string text, string original, Current c) =>
        new(d.Key, d.Group, d.Name, d.Description, text, original, c.Version, c.ChangedBy,
            DateTime.SpecifyKind(c.ChangedAt, DateTimeKind.Utc), AiPromptCatalog.Placeholders(original), d.ReplyKeys, d.AllowEmpty);

    private static string CacheKey(long tenantId) => $"ai-prompts:{tenantId}";

    private static string? Trim(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];

    private static IReadOnlyDictionary<string, string> LoadSeed()
    {
        var asm = typeof(AiPromptStore).Assembly;
        var name = asm.GetManifestResourceNames().Single(n => n.EndsWith("ai-prompts.seed.json", StringComparison.Ordinal));
        using var stream = asm.GetManifestResourceStream(name)!;
        using var doc = JsonDocument.Parse(stream);
        var seed = doc.RootElement.GetProperty("prompts").EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString() ?? "", StringComparer.Ordinal);
        var missing = AiPromptCatalog.All.Where(d => !seed.ContainsKey(d.Key)).Select(d => d.Key).ToList();
        if (missing.Count > 0) throw new InvalidOperationException($"The AI prompt seed lacks: {string.Join(", ", missing)}.");
        return seed;
    }

    // ── ADO on the context's connection (inside the EF transaction when one is given) ─────────────────────────────

    private async Task<DbCommand> CommandAsync(string sql, DbTransaction? tx, CancellationToken ct, (string Name, object? Value)[] args)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open) await db.Database.OpenConnectionAsync(ct);
        var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.Transaction = tx ?? db.Database.CurrentTransaction?.GetDbTransaction();
        foreach (var (n, v) in args)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = n;
            p.Value = v ?? DBNull.Value;
            if (v is string s && p is SqlParameter sp) { sp.SqlDbType = SqlDbType.NVarChar; sp.Size = s.Length > 4000 ? -1 : 4000; }
            cmd.Parameters.Add(p);
        }
        return cmd;
    }

    private async Task<T?> ScalarAsync<T>(string sql, DbTransaction? tx, CancellationToken ct, params (string, object?)[] args)
    {
        await using var cmd = await CommandAsync(sql, tx, ct, args);
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is null || v is DBNull ? default : (T)(v is int i && typeof(T) == typeof(int?) ? (object)(int?)i : v);
    }

    private async Task ExecAsync(string sql, DbTransaction? tx, CancellationToken ct, params (string, object?)[] args)
    {
        await using var cmd = await CommandAsync(sql, tx, ct, args);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task ReadAsync(string sql, DbTransaction? tx, CancellationToken ct, Action<DbDataReader> row, params (string, object?)[] args)
    {
        await using var cmd = await CommandAsync(sql, tx, ct, args);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) row(r);
    }
}
