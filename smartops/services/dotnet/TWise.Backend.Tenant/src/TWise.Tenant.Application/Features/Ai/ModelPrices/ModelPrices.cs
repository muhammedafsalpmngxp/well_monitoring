using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Ai.ModelPrices;

/// <summary>The price catalog and the active provider's models (no key).</summary>
public sealed record GetAiModelPricesQuery(long TenantId) : IRequest<AiModelPricesDto>;

/// <summary>Replaces the tenant's price catalog (admins).</summary>
public sealed record SaveAiModelPricesCommand(long TenantId, string? UserId, IReadOnlyList<AiModelPriceDto> Prices) : IRequest<AiModelPricesDto>;

public sealed class GetAiModelPricesHandler(IAiProviderRepository providers) : IRequestHandler<GetAiModelPricesQuery, AiModelPricesDto>
{
    public async Task<AiModelPricesDto> Handle(GetAiModelPricesQuery q, CancellationToken ct)
    {
        var active = await providers.GetActiveAsync(q.TenantId, ct);
        var prices = await providers.ListPricesAsync(q.TenantId, ct);
        return new AiModelPricesDto(active?.Model, active?.FastModel,
            prices.Select(p => new AiModelPriceDto(p.Model, p.ModelClass, p.InputPer1M, p.OutputPer1M)).ToList());
    }
}

public sealed class SaveAiModelPricesHandler(IAiProviderRepository providers, ISender sender) : IRequestHandler<SaveAiModelPricesCommand, AiModelPricesDto>
{
    public async Task<AiModelPricesDto> Handle(SaveAiModelPricesCommand c, CancellationToken ct)
    {
        await providers.ReplacePricesAsync(c.TenantId, c.Prices.Select(p => new AiModelPrice
        {
            TenantId = c.TenantId, Model = p.Model.Trim(), ModelClass = p.ModelClass, InputPer1M = p.InputPer1M, OutputPer1M = p.OutputPer1M,
            UpdatedBy = c.UserId, UpdatedAt = DateTime.UtcNow,
        }).ToList(), ct);
        return await sender.Send(new GetAiModelPricesQuery(c.TenantId), ct);
    }
}

public sealed class SaveAiModelPricesCommandValidator : AbstractValidator<SaveAiModelPricesCommand>
{
    public static readonly string[] Classes = ["frontier", "standard", "fast"];

    public SaveAiModelPricesCommandValidator()
    {
        RuleFor(x => x.Prices).Must(p => p.Count <= 100).WithMessage("Up to 100 models.")
            .Must(p => p.Select(x => x.Model.Trim().ToLowerInvariant()).Distinct().Count() == p.Count).WithMessage("Each model once.");
        RuleForEach(x => x.Prices).ChildRules(p =>
        {
            p.RuleFor(x => x.Model).NotEmpty().WithMessage("Name the model.").MaximumLength(100);
            p.RuleFor(x => x.ModelClass).Must(c => Classes.Contains(c)).WithMessage("Class is frontier, standard or fast.");
            p.RuleFor(x => x.InputPer1M).InclusiveBetween(0, 10000).WithMessage("Input price per 1M tokens is 0 to 10,000.");
            p.RuleFor(x => x.OutputPer1M).InclusiveBetween(0, 10000).WithMessage("Output price per 1M tokens is 0 to 10,000.");
        });
    }
}
