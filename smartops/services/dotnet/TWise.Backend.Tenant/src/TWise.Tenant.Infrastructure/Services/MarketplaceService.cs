using System.Text.Json;
using System.Text.RegularExpressions;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.DataSources.Connectors;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Installs chart visuals from a remote catalog, so a tenant gains a visual without a deployment.
///
/// Catalog URLs are registered per tenant and validated on save (HTTPS, public host); the built-in
/// catalog ships with the API. Every fetched URL is still checked with
/// <see cref="OutboundUrlGuard"/>, because a configured host can resolve to a private address.
///
/// Everything a catalog returns is untrusted input. Templates go through the same
/// <see cref="CustomVisualValidator"/> as hand-authored ones, so a catalog cannot ship a template
/// carrying executable code into a viewer's browser.
/// </summary>
public sealed class MarketplaceService(
    ICustomVisualRepository repo,
    IMarketplaceCatalogRepository catalogs,
    IMarketplacePluginRepository plugins,
    IHttpClientFactory httpClientFactory) : IMarketplaceService
{
    private static readonly Regex KeyPattern = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    /// <summary>The catalog seeded in core.MarketplacePlugins. Always listed first; cannot be edited or removed.</summary>
    private const string BuiltInCatalogKey = "twise";
    private static readonly MarketplaceCatalogDto BuiltInCatalog =
        new(BuiltInCatalogKey, "TWise Visuals", "", null, false, DateTime.UnixEpoch, IsBuiltIn: true);

    public async Task<IReadOnlyList<MarketplaceCatalogDto>> GetCatalogsAsync(long tenantId, CancellationToken ct = default)
        => [BuiltInCatalog, .. (await catalogs.GetAllAsync(tenantId, ct)).Select(ToDto)];

    public async Task<IReadOnlyList<CatalogPluginDto>> GetBuiltInCatalogAsync(CancellationToken ct = default)
        => (await plugins.GetActiveAsync(ct)).Select(ToCatalogDto).ToList();

    public async Task<CatalogPluginDto> ImportPowerBiVisualAsync(Stream package, CancellationToken ct = default)
    {
        MarketplacePlugin plugin;
        try { plugin = PowerBiVisualPackageReader.Read(package); }
        catch (InvalidDataException) { throw new InvalidOperationException("Not a valid .pbiviz package: the file is not a zip archive."); }
        return ToCatalogDto(await plugins.UpsertAsync(plugin, ct));
    }

    private static CatalogPluginDto ToCatalogDto(MarketplacePlugin p) => new(
        p.PluginId, p.Name, p.Description, p.Version, p.Publisher, p.VisualKey, p.RenderKind,
        ParseRoles(p.DataRolesJson), p.OptionsTemplateJson, p.Icon,
        p.FeaturesJson is null ? null : JsonSerializer.Deserialize<List<string>>(p.FeaturesJson, JsonOptions),
        p.ImageUrl);

    public async Task<MarketplaceCatalogDto> AddCatalogAsync(SaveCatalogRequest request, long tenantId, long userId, CancellationToken ct = default)
    {
        var (name, uri, header, value) = await ValidateAsync(request, ct);
        await EnsureUrlUniqueAsync(uri, tenantId, exceptKey: null, ct);

        // Key derived from the name, made unique per tenant so two similarly named catalogs can coexist.
        var baseKey = KeyPattern.Replace(name.ToLowerInvariant(), "-").Trim('-');
        if (baseKey.Length == 0) baseKey = "catalog";
        var key = baseKey; var n = 2;
        while (key == BuiltInCatalogKey || await catalogs.GetByKeyAsync(key, tenantId, ct) is not null) key = $"{baseKey}-{n++}";

        var row = await catalogs.AddAsync(new MarketplaceCatalog
        {
            CatalogKey = key, Name = name, Url = uri.ToString(),
            AuthHeader = header,
            AuthValueEncrypted = value is null ? null : ConnectionPasswordHelper.Encrypt(value),
            TenantId = tenantId, CreatedBy = userId,
        }, ct);
        return ToDto(row);
    }

    public async Task<MarketplaceCatalogDto?> UpdateCatalogAsync(string catalogKey, SaveCatalogRequest request, long tenantId, CancellationToken ct = default)
    {
        if (catalogKey == BuiltInCatalogKey) throw new InvalidOperationException("The built-in marketplace cannot be changed.");
        var row = await catalogs.GetByKeyAsync(catalogKey, tenantId, ct);
        if (row is null) return null;

        // A blank auth value with the same header keeps the stored secret, so editing the URL
        // does not force the user to re-enter a key they cannot see.
        var keepSecret = string.IsNullOrWhiteSpace(request.AuthValue)
            && row.AuthValueEncrypted is not null
            && string.Equals(request.AuthHeader?.Trim(), row.AuthHeader, StringComparison.OrdinalIgnoreCase);
        var (name, uri, header, value) = await ValidateAsync(
            keepSecret ? request with { AuthValue = "unchanged" } : request, ct);
        await EnsureUrlUniqueAsync(uri, tenantId, exceptKey: row.CatalogKey, ct);

        row.Name = name;
        row.Url = uri.ToString();
        row.AuthHeader = header;
        if (!keepSecret) row.AuthValueEncrypted = value is null ? null : ConnectionPasswordHelper.Encrypt(value);
        row.ModifiedAt = DateTime.UtcNow;
        await catalogs.UpdateAsync(row, ct);
        return ToDto(row);
    }

    public Task<bool> RemoveCatalogAsync(string catalogKey, long tenantId, CancellationToken ct = default)
        => catalogKey == BuiltInCatalogKey
            ? throw new InvalidOperationException("The built-in marketplace cannot be removed.")
            : catalogs.SoftDeleteAsync(catalogKey, tenantId, ct);

    /// <summary>The same catalog registered twice would just list the same visuals twice.</summary>
    private async Task EnsureUrlUniqueAsync(Uri uri, long tenantId, string? exceptKey, CancellationToken ct)
    {
        var url = uri.ToString();
        var duplicate = (await catalogs.GetAllAsync(tenantId, ct))
            .FirstOrDefault(c => c.CatalogKey != exceptKey && string.Equals(c.Url, url, StringComparison.OrdinalIgnoreCase));
        if (duplicate is not null)
            throw new InvalidOperationException($"This URL is already registered as '{duplicate.Name}'.");
    }

    private static async Task<(string Name, Uri Uri, string? Header, string? Value)> ValidateAsync(SaveCatalogRequest request, CancellationToken ct)
    {
        var name = (request.Name ?? "").Trim();
        if (name.Length == 0) throw new InvalidOperationException("A catalog name is required.");

        // Only HTTPS, and only public hosts: the URL is user-supplied, so this is the line between a
        // marketplace and a server-side request forgery tool.
        if (!Uri.TryCreate((request.Url ?? "").Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("The catalog URL must be an absolute https:// address.");
        await OutboundUrlGuard.EnsureAllowedAsync(uri, ct);

        var header = string.IsNullOrWhiteSpace(request.AuthHeader) ? null : request.AuthHeader.Trim();
        var value = string.IsNullOrWhiteSpace(request.AuthValue) ? null : request.AuthValue.Trim();
        if ((header is null) != (value is null))
            throw new InvalidOperationException("Provide both the auth header name and value, or neither.");

        return (name, uri, header, value);
    }

    private static MarketplaceCatalogDto ToDto(MarketplaceCatalog c)
        => new(c.CatalogKey, c.Name, c.Url, c.AuthHeader, c.AuthValueEncrypted is not null, c.CreatedAt);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public async Task<IReadOnlyList<CustomVisualDto>> GetInstalledAsync(long tenantId, CancellationToken ct = default)
        => (await repo.GetAllAsync(tenantId, activeOnly: true, ct)).Select(ToDto).ToList();

    public async Task<IReadOnlyList<MarketplaceListingDto>> BrowseAsync(string catalogId, long tenantId, CancellationToken ct = default)
    {
        var plugins = await FetchCatalogAsync(catalogId, tenantId, ct);
        var installed = (await repo.GetAllAsync(tenantId, activeOnly: false, ct))
            .Where(v => v.CatalogId == catalogId && v.CatalogPluginId is not null)
            .ToDictionary(v => v.CatalogPluginId!, StringComparer.OrdinalIgnoreCase);

        return plugins.Select(p =>
        {
            installed.TryGetValue(p.Id, out var row);
            return new MarketplaceListingDto(
                p,
                IsInstalled: row is not null,
                InstalledVersion: row?.InstalledVersion,
                UpdateAvailable: row is not null && !string.Equals(row.InstalledVersion, p.Version, StringComparison.OrdinalIgnoreCase));
        }).ToList();
    }

    public async Task<CustomVisualDto> InstallAsync(InstallPluginRequest request, long tenantId, long userId, CancellationToken ct = default)
    {
        var plugin = (await FetchCatalogAsync(request.CatalogId, tenantId, ct))
            .FirstOrDefault(p => string.Equals(p.Id, request.PluginId, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"Plugin '{request.PluginId}' is not in catalog '{request.CatalogId}'.");

        if (plugin.RenderKind == CustomVisualRenderKinds.PowerBiVisual)
            throw new InvalidOperationException("Power BI visuals run only inside an embedded Power BI report and cannot be installed as chart renderers.");

        var roles = plugin.DataRoles ?? [];
        var result = CustomVisualValidator.Validate(plugin.VisualKey, plugin.OptionsTemplateJson, roles, plugin.RenderKind);
        if (!result.IsValid)
            throw new InvalidOperationException($"This plugin was rejected: {string.Join(" ", result.Errors)}");

        var key = CustomVisualKeys.Normalise(plugin.VisualKey);
        var existing = await repo.GetByCatalogPluginAsync(request.CatalogId, plugin.Id, tenantId, ct);

        // A different visual already owning the key means two plugins collide; installing would
        // make widget rendering ambiguous, so refuse rather than silently overwrite.
        if (existing is null && await repo.KeyExistsAsync(key, tenantId, null, ct))
            throw new InvalidOperationException($"A visual with the key '{key}' already exists in this tenant.");

        if (existing is not null)
        {
            existing.DisplayName = plugin.Name;
            existing.Description = plugin.Description;
            existing.Icon = plugin.Icon;
            existing.DataRolesJson = JsonSerializer.Serialize(roles, JsonOptions);
            existing.OptionsTemplateJson = plugin.OptionsTemplateJson;
            existing.InstalledVersion = plugin.Version;
            existing.ModifiedBy = userId;
            await repo.UpdateAsync(existing, ct);
            return ToDto(existing);
        }

        var visual = new CustomVisual
        {
            VisualKey = key,
            DisplayName = plugin.Name,
            Description = plugin.Description,
            Icon = plugin.Icon,
            RenderKind = plugin.RenderKind.Trim().ToLowerInvariant(),
            DataRolesJson = JsonSerializer.Serialize(roles, JsonOptions),
            OptionsTemplateJson = plugin.OptionsTemplateJson,
            CatalogId = request.CatalogId,
            CatalogPluginId = plugin.Id,
            InstalledVersion = plugin.Version,
            TenantId = tenantId,
            CreatedBy = userId,
        };

        return ToDto(await repo.AddAsync(visual, ct));
    }

    public async Task<bool> UninstallAsync(string catalogId, string pluginId, long tenantId, CancellationToken ct = default)
    {
        var existing = await repo.GetByCatalogPluginAsync(catalogId, pluginId, tenantId, ct);
        return existing is not null && await repo.SoftDeleteAsync(existing.Id, tenantId, ct);
    }

    /// <summary>
    /// Reads the built-in catalog from the database, or a registered catalog over HTTPS. The URL is resolved
    /// by key, so a caller can only reach catalogs the tenant has registered.
    /// </summary>
    private async Task<IReadOnlyList<CatalogPluginDto>> FetchCatalogAsync(string catalogId, long tenantId, CancellationToken ct)
    {
        if (catalogId == BuiltInCatalogKey) return await GetBuiltInCatalogAsync(ct);

        var registered = await catalogs.GetByKeyAsync(catalogId, tenantId, ct)
            ?? throw new InvalidOperationException($"Catalog '{catalogId}' is not registered.");
        var url = registered.Url;
        var authHeader = registered.AuthHeader;
        var authValue = registered.AuthValueEncrypted is null ? null : ConnectionPasswordHelper.Decrypt(registered.AuthValueEncrypted);

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException($"Catalog '{catalogId}' has an invalid URL.");

        await OutboundUrlGuard.EnsureAllowedAsync(uri, ct);

        var client = httpClientFactory.CreateClient(nameof(MarketplaceService));
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);

        // One header covers both shapes a catalog usually wants: an API key
        // (AuthHeader: "X-Api-Key") or a token (AuthHeader: "Authorization",
        // AuthValue: "Bearer …"). The secret is stored encrypted and is never logged or
        // returned to the client.
        if (!string.IsNullOrWhiteSpace(authHeader) && !string.IsNullOrWhiteSpace(authValue))
            request.Headers.TryAddWithoutValidation(authHeader, authValue);

        using var response = await client.SendAsync(request, ct);
        if (response.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
            throw new InvalidOperationException($"Catalog '{catalogId}' rejected the configured credentials.");

        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Catalog '{catalogId}' returned {(int)response.StatusCode}.");

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        try
        {
            return await JsonSerializer.DeserializeAsync<List<CatalogPluginDto>>(stream, JsonOptions, ct) ?? [];
        }
        catch (JsonException)
        {
            // Typically a web page (HTML) was registered instead of a catalog JSON file.
            throw new InvalidOperationException(
                $"Catalog '{catalogId}' is not a marketplace catalog. The URL must return a JSON array of plugins.");
        }
    }

    private static CustomVisualDto ToDto(CustomVisual v) => new(
        v.Id, v.VisualKey, v.DisplayName, v.Description, v.Icon, v.RenderKind,
        ParseRoles(v.DataRolesJson), v.OptionsTemplateJson, v.IsActive, v.CreatedAt, v.ModifiedAt);

    private static IReadOnlyList<CustomVisualDataRole> ParseRoles(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<CustomVisualDataRole>>(json, JsonOptions) ?? []; }
        catch (JsonException) { return []; }
    }
}
