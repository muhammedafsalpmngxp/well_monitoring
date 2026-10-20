using System.Data;
using System.Data.Common;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// The tenant's AI prompts in the tenant database (see IAiPromptStore):
///   core.AiPrompt          one row per prompt: its active text and live version number (row_ver refreshes the cache)
///   core.AiPromptHistory   every version; version 1 of a key is its original ('seed'), is_current marks the live one
/// The history decides which version is live; core.AiPrompt always holds that version's text. Saves, restores and the
/// sync that seeds a tenant each run in one transaction holding the tenant's prompt lock (sp_getapplock), so concurrent
/// requests cannot interleave. The seed (Resources/ai-prompts.seed.json) is only copied into the database; prompts are
/// always read from the database. core.AiSettings.prompts_json, where prompts lived before core.AiPrompt, is only read
/// once, to carry over a text that has neither a row nor history yet.
/// </summary>
public sealed class AiPromptStore(TenantDbContext db, IMemoryCache cache, ILogger<AiPromptStore> logger) : IAiPromptStore
{
    private const string SystemUser = "system";
    private static readonly Lazy<IReadOnlyDictionary<string, string>> SeedTexts = new(LoadSeed);

    /// <summary>The texts every tenant starts with, from the embedded seed file. Checked against the catalog.</summary>
    public static IReadOnlyDictionary<string, string> Seed => SeedTexts.Value;

    /// <summary>What a cached copy was read at: core.AiPrompt's newest row_ver and row count, the newest history row.</summary>
    private sealed record Stamp(byte[]? RowVer, int Rows, long? HistoryId)
    {
        public bool Matches(Stamp other) =>
            Rows == other.Rows && HistoryId == other.HistoryId && (RowVer ?? []).AsSpan().SequenceEqual(other.RowVer ?? []);
    }

    private sealed record Current(int Version, string Body, string ChangedBy, DateTime ChangedAt);
    private sealed record Cached(Stamp Stamp, IReadOnlyDictionary<string, string> Texts, IReadOnlyDictionary<string, Current> Live);

    public async Task<IReadOnlyDictionary<string, string>> GetAsync(long tenantId, CancellationToken ct) => (await LoadAsync(tenantId, ct)).Texts;

    public async Task<IReadOnlyList<AiPromptItemDto>> ListAsync(long tenantId, CancellationToken ct)
    {
        var loaded = await LoadAsync(tenantId, ct);
        var original = new Dictionary<string, string>(StringComparer.Ordinal);
        await ReadAsync("SELECT prompt_key, body FROM core.AiPromptHistory WHERE tenant_id = @t AND version_no = 1", null, ct,
            r => original[r.GetString(0)] = r.GetString(1), ("@t", tenantId));
        return AiPromptCatalog.All.Select(d =>
        {
            var c = loaded.Live[d.Key];
            return Item(d, c.Body, original.TryGetValue(d.Key, out var o) ? o : c.Body, c);
        }).ToList();
    }

    public async Task<IReadOnlyList<AiPromptVersionDto>> HistoryAsync(long tenantId, string key, CancellationToken ct)
    {
        AiPromptCatalog.Get(key);
        await LoadAsync(tenantId, ct);
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

    /// <summary>
    /// The live prompts, from the cache while nothing changed (one small query per call), else from core.AiPrompt.
    /// A tenant whose rows or history are incomplete or disagree is synced first (SyncAsync).
    /// </summary>
    private async Task<Cached> LoadAsync(long tenantId, CancellationToken ct)
    {
        var key = CacheKey(tenantId);
        var stamp = await StampAsync(tenantId, ct);
        if (cache.TryGetValue(key, out Cached? hit) && hit!.Stamp.Matches(stamp))
            return hit;

        var live = await LiveAsync(tenantId, ct);
        if (!await ConsistentAsync(tenantId, live, ct))
        {
            await SyncAsync(tenantId, ct);
            stamp = await StampAsync(tenantId, ct);
            live = await LiveAsync(tenantId, ct);
        }
        var texts = AiPromptCatalog.All.ToDictionary(d => d.Key, d => live[d.Key].Body, StringComparer.Ordinal);
        var loaded = new Cached(stamp, texts, live);
        cache.Set(key, loaded, TimeSpan.FromMinutes(30));
        return loaded;
    }

    private async Task<Stamp> StampAsync(long tenantId, CancellationToken ct)
    {
        Stamp stamp = new(null, 0, null);
        await ReadAsync("""
            SELECT (SELECT MAX(row_ver) FROM core.AiPrompt WHERE tenant_id = @t),
                   (SELECT COUNT(*) FROM core.AiPrompt WHERE tenant_id = @t),
                   (SELECT MAX(id) FROM core.AiPromptHistory WHERE tenant_id = @t)
            """, null, ct, r => stamp = new Stamp(r.IsDBNull(0) ? null : (byte[])r.GetValue(0), r.GetInt32(1),
                r.IsDBNull(2) ? null : r.GetInt64(2)), ("@t", tenantId));
        return stamp;
    }

    private async Task<Dictionary<string, Current>> LiveAsync(long tenantId, CancellationToken ct)
    {
        var live = new Dictionary<string, Current>(StringComparer.Ordinal);
        await ReadAsync("SELECT prompt_key, version_no, body, modified_by, modified_at FROM core.AiPrompt WHERE tenant_id = @t", null, ct,
            r => live[r.GetString(0)] = new Current(r.GetInt32(1), r.GetString(2), r.GetString(3), r.GetDateTime(4)), ("@t", tenantId));
        return live;
    }

    /// <summary>Every catalog key has a row whose version is the history's live version (false sends LoadAsync to SyncAsync).</summary>
    private async Task<bool> ConsistentAsync(long tenantId, IReadOnlyDictionary<string, Current> live, CancellationToken ct)
    {
        if (AiPromptCatalog.All.Any(d => !live.ContainsKey(d.Key))) return false;
        var current = new Dictionary<string, int>(StringComparer.Ordinal);
        await ReadAsync("SELECT prompt_key, version_no FROM core.AiPromptHistory WHERE tenant_id = @t AND is_current = 1", null, ct,
            r => current[r.GetString(0)] = r.GetInt32(1), ("@t", tenantId));
        return AiPromptCatalog.All.All(d => current.TryGetValue(d.Key, out var v) && v == live[d.Key].Version);
    }

    /// <summary>One new version of one prompt, atomically: history row, previous version no longer current, core.AiPrompt row.</summary>
    private async Task<AiPromptItemDto> WriteAsync(long tenantId, string key, Func<IReadOnlyDictionary<int, string>, string> newText,
        string action, string? note, int? expectedVersion, string userId, CancellationToken ct)
    {
        var def = AiPromptCatalog.Get(key);
        await LoadAsync(tenantId, ct);   // syncs the tenant first if needed
        var strategy = db.Database.CreateExecutionStrategy();
        var item = await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            var dbTx = tx.GetDbTransaction();
            await LockAsync(dbTx, tenantId, ct);
            var versions = new Dictionary<int, string>();
            Current? current = null;
            await ReadAsync("""
                SELECT version_no, body, changed_by, changed_at, is_current FROM core.AiPromptHistory
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
            await UpsertPromptAsync(dbTx, tenantId, key, new Current(next, text, userId, now), ct);
            await tx.CommitAsync(ct);
            logger.LogInformation("AI prompt {Key} saved as version {Version} ({Action}) for tenant {TenantId} by {User}", key, next, action, tenantId, userId);
            return Item(def, text, original, new Current(next, text, userId, now));
        });
        cache.Remove(CacheKey(tenantId));
        return item;
    }

    /// <summary>
    /// Makes core.AiPrompt and the history complete and in agreement for every catalog key, in one transaction:
    ///  * no history yet: version 1 ('seed') is the seed text; a text the tenant already had (a core.AiPrompt row, or
    ///    else core.AiSettings.prompts_json from before core.AiPrompt) that differs from the seed becomes version 2;
    ///  * no row, or a row that is not the history's live version: the row is written from the live version.
    /// </summary>
    private async Task SyncAsync(long tenantId, CancellationToken ct)
    {
        var seed = Seed;
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            var dbTx = tx.GetDbTransaction();
            await LockAsync(dbTx, tenantId, ct);

            var rows = new Dictionary<string, Current>(StringComparer.Ordinal);
            await ReadAsync("SELECT prompt_key, version_no, body, modified_by, modified_at FROM core.AiPrompt WHERE tenant_id = @t", dbTx, ct,
                r => rows[r.GetString(0)] = new Current(r.GetInt32(1), r.GetString(2), r.GetString(3), r.GetDateTime(4)), ("@t", tenantId));
            var maxVersion = new Dictionary<string, int>(StringComparer.Ordinal);
            var live = new Dictionary<string, Current>(StringComparer.Ordinal);
            await ReadAsync("SELECT prompt_key, version_no, body, changed_by, changed_at, is_current FROM core.AiPromptHistory WHERE tenant_id = @t",
                dbTx, ct, r =>
            {
                var k = r.GetString(0);
                maxVersion[k] = Math.Max(maxVersion.GetValueOrDefault(k), r.GetInt32(1));
                if (r.GetBoolean(5)) live[k] = new Current(r.GetInt32(1), r.GetString(2), r.GetString(3), r.GetDateTime(4));
            }, ("@t", tenantId));
            IReadOnlyDictionary<string, string>? legacy = null;

            var now = DateTime.UtcNow;
            var changes = 0;
            foreach (var def in AiPromptCatalog.All)
            {
                if (!maxVersion.ContainsKey(def.Key))
                {
                    var own = rows.TryGetValue(def.Key, out var row) ? row.Body
                        : (legacy ??= await LegacyTextsAsync(dbTx, tenantId, ct)).GetValueOrDefault(def.Key);
                    var seedText = seed[def.Key];
                    var customised = own is not null && own != seedText;
                    await InsertVersionAsync(dbTx, tenantId, def.Key, 1, seedText, "seed", null, SystemUser, now, isCurrent: !customised, ct);
                    live[def.Key] = new Current(1, seedText, SystemUser, now);
                    if (customised)
                    {
                        await InsertVersionAsync(dbTx, tenantId, def.Key, 2, own!, "update", "Customised before prompt history", SystemUser, now, isCurrent: true, ct);
                        live[def.Key] = new Current(2, own!, SystemUser, now);
                    }
                    changes++;
                }
                else if (!live.ContainsKey(def.Key))
                {
                    // History without a live version (not possible through this store): the newest version becomes live.
                    var newest = maxVersion[def.Key];
                    await ExecAsync("UPDATE core.AiPromptHistory SET is_current = 1 WHERE tenant_id = @t AND prompt_key = @k AND version_no = @v",
                        dbTx, ct, ("@t", tenantId), ("@k", def.Key), ("@v", newest));
                    string body = "";
                    string by = SystemUser;
                    DateTime at = now;
                    await ReadAsync("SELECT body, changed_by, changed_at FROM core.AiPromptHistory WHERE tenant_id = @t AND prompt_key = @k AND version_no = @v",
                        dbTx, ct, r => { body = r.GetString(0); by = r.GetString(1); at = r.GetDateTime(2); }, ("@t", tenantId), ("@k", def.Key), ("@v", newest));
                    live[def.Key] = new Current(newest, body, by, at);
                    changes++;
                }

                var target = live[def.Key];
                if (!rows.TryGetValue(def.Key, out var have) || have.Version != target.Version || have.Body != target.Body)
                {
                    await UpsertPromptAsync(dbTx, tenantId, def.Key, target, ct);
                    changes++;
                }
            }
            await tx.CommitAsync(ct);
            if (changes > 0) logger.LogInformation("AI prompts synced for tenant {TenantId}: {Changes} change(s)", tenantId, changes);
        });
        cache.Remove(CacheKey(tenantId));
    }

    /// <summary>Serialises every prompt write of one tenant until the transaction ends.</summary>
    private Task LockAsync(DbTransaction tx, long tenantId, CancellationToken ct) =>
        ExecAsync("""
            DECLARE @rc int;
            EXEC @rc = sp_getapplock @Resource = @r, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;
            IF @rc < 0 THROW 50001, 'The AI prompts are busy. Try again.', 1;
            """, tx, ct, ("@r", $"core.AiPrompt:{tenantId}"));

    /// <summary>core.AiSettings.prompts_json, where prompts lived before core.AiPrompt (empty once the column is gone).</summary>
    private async Task<IReadOnlyDictionary<string, string>> LegacyTextsAsync(DbTransaction tx, long tenantId, CancellationToken ct)
    {
        var json = await ScalarAsync<string>("""
            IF COL_LENGTH('core.AiSettings', 'prompts_json') IS NOT NULL
                EXEC sp_executesql N'SELECT prompts_json FROM core.AiSettings WHERE tenant_id = @t', N'@t bigint', @t = @t;
            """, tx, ct, ("@t", tenantId));
        return AiPrompts.Parse(json);
    }

    private Task UpsertPromptAsync(DbTransaction tx, long tenantId, string key, Current c, CancellationToken ct) =>
        ExecAsync("""
            UPDATE core.AiPrompt SET body = @b, version_no = @v, modified_by = @u, modified_at = @at WHERE tenant_id = @t AND prompt_key = @k;
            IF @@ROWCOUNT = 0
                INSERT INTO core.AiPrompt (tenant_id, prompt_key, body, version_no, modified_by, modified_at) VALUES (@t, @k, @b, @v, @u, @at);
            """, tx, ct, ("@t", tenantId), ("@k", key), ("@b", c.Body), ("@v", c.Version), ("@u", Trim(c.ChangedBy, 200)), ("@at", c.ChangedAt));

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
        // The Agentic Features' prompts come with their own seed (agentic-features.seed.json).
        foreach (var p in AgenticFeatureCatalog.All.Values.SelectMany(f => f.Prompts))
            seed[p.Key] = p.Text;
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
        return v is null || v is DBNull ? default : (T)v;
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
