using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

/// <summary>Create (Id null) or update. The first provider a tenant adds becomes active automatically.</summary>
public sealed class SaveAiProviderHandler(IAiProviderRepository providers, IAiKeyProtector keys) : IRequestHandler<SaveAiProviderCommand, AiProviderDto?>
{
    public async Task<AiProviderDto?> Handle(SaveAiProviderCommand c, CancellationToken ct)
    {
        var r = c.Request;
        var name = (r.Name ?? "").Trim();
        if (name.Length is 0 or > 100) throw new InvalidOperationException("A name is required (max 100 characters).");
        var kind = (r.Provider ?? "").Trim().ToLowerInvariant();
        if (!AiMapping.ProviderKinds.Contains(kind))
            throw new InvalidOperationException("Provider must be one of: " + string.Join(", ", AiMapping.ProviderKinds) + ".");
        if (!Uri.TryCreate((r.BaseUrl ?? "").Trim(), UriKind.Absolute, out var baseUri) || (baseUri.Scheme != "https" && !baseUri.IsLoopback))
            throw new InvalidOperationException("Base URL must be an absolute https URL (http is allowed for localhost only).");
        var model = (r.Model ?? "").Trim();
        if (model.Length is 0 or > 100) throw new InvalidOperationException("Model name is required (max 100 characters).");
        var fastModel = string.IsNullOrWhiteSpace(r.FastModel) ? null : r.FastModel.Trim();
        if (fastModel is { Length: > 100 }) throw new InvalidOperationException("Fast model name is max 100 characters.");
        if (r.DailyQuota < 0) throw new InvalidOperationException("Daily quota cannot be negative.");

        AiProvider p;
        if (c.Id is { } id)
        {
            p = await providers.GetAsync(id, c.TenantId, ct) ?? throw new KeyNotFoundException();
        }
        else
        {
            var existing = await providers.ListAsync(c.TenantId, ct);
            p = new AiProvider { TenantId = c.TenantId, CreatedBy = c.UserId, IsActive = existing.Count == 0 };
        }
        p.Name = name;
        p.Provider = kind;
        p.BaseUrl = baseUri.ToString().TrimEnd('/');
        p.Model = model;
        p.FastModel = fastModel;
        if (r.DailyQuota is { } quota) p.DailyQuota = quota;
        if (!string.IsNullOrWhiteSpace(r.ApiKey)) p.ApiKeyEncrypted = keys.Protect(r.ApiKey.Trim());
        if (kind != "ollama" && string.IsNullOrEmpty(p.ApiKeyEncrypted))
            throw new InvalidOperationException("An API key is required for this provider.");
        p.ModifiedBy = c.UserId;
        p.ModifiedAt = DateTime.UtcNow;

        if (p.Id == 0) await providers.AddAsync(p, ct);
        await providers.SaveAsync(ct);
        return AiMapping.ToDto(p);
    }
}

public sealed class ActivateAiProviderHandler(IAiProviderRepository providers) : IRequestHandler<ActivateAiProviderCommand, AiProviderDto?>
{
    public async Task<AiProviderDto?> Handle(ActivateAiProviderCommand c, CancellationToken ct)
    {
        var p = await providers.GetAsync(c.Id, c.TenantId, ct);
        if (p is null) return null;
        p.ModifiedBy = c.UserId;
        p.ModifiedAt = DateTime.UtcNow;
        await providers.SetActiveAsync(p, ct);
        return AiMapping.ToDto(p);
    }
}

/// <summary>Sends a tiny prompt to the chosen provider (not necessarily the active one).</summary>
public sealed class TestAiProviderHandler(IAiProviderRepository providers, IAiService ai) : IRequestHandler<TestAiProviderCommand, AiTestResultDto>
{
    public async Task<AiTestResultDto> Handle(TestAiProviderCommand c, CancellationToken ct)
    {
        var p = await providers.GetAsync(c.Id, c.TenantId, ct);
        if (p is null) return new AiTestResultDto(false, "Provider not found.", 0);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var r = await ai.TestProviderAsync(c.TenantId, c.UserId, p, ct);
            return new AiTestResultDto(true, "Connected. Model replied: " + r.Content.Trim(), (int)sw.ElapsedMilliseconds);
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            return new AiTestResultDto(false, ex.Message, (int)sw.ElapsedMilliseconds);
        }
    }
}
