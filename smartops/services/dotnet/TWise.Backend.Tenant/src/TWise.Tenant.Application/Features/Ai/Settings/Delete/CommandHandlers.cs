using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Settings;

public sealed class DeleteAiProviderHandler(IAiProviderRepository providers) : IRequestHandler<DeleteAiProviderCommand, bool>
{
    public async Task<bool> Handle(DeleteAiProviderCommand c, CancellationToken ct)
    {
        var p = await providers.GetAsync(c.Id, c.TenantId, ct);
        if (p is null) return false;
        if (p.IsActive) throw new InvalidOperationException("Make another provider active before deleting this one.");
        p.IsDeleted = true;
        p.DeletedBy = c.UserId;
        p.ModifiedAt = DateTime.UtcNow;
        await providers.SaveAsync(ct);
        return true;
    }
}
