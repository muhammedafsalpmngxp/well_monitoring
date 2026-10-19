using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

public sealed class SaveAskDataSettingsHandler(IAiSettingsRepository settings, IAskDataCatalogReader catalog)
    : IRequestHandler<SaveAskDataSettingsCommand, AskDataSettingsDto>
{
    public async Task<AskDataSettingsDto> Handle(SaveAskDataSettingsCommand c, CancellationToken ct)
    {
        var known = await catalog.ReadAsync(ct);
        // A tenant without a settings row gets one with AI off: saving Ask Data settings does not switch AI on.
        var s = await settings.GetAsync(c.TenantId, ct) ?? new AiSettings { TenantId = c.TenantId, CreatedBy = c.UserId };
        AskDataSettingsRules.Apply(s, c.Request, known);
        s.ModifiedBy = c.UserId;
        s.ModifiedAt = DateTime.UtcNow;
        await settings.UpsertAsync(s, ct);
        return AskDataSettingsRules.ToDto(s);
    }
}
