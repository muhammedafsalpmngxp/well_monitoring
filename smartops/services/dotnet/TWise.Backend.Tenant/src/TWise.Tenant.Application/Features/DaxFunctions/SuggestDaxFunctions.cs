using FluentValidation;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.DaxFunctions;

public sealed record SuggestDaxFunctionsQuery(string Prefix, string? ReturnType, int Top = 10)
    : IRequest<IReadOnlyList<DaxFunctionSuggestionDto>>;

public sealed class SuggestDaxFunctionsValidator : AbstractValidator<SuggestDaxFunctionsQuery>
{
    public SuggestDaxFunctionsValidator()
    {
        RuleFor(x => x.Prefix).NotEmpty().MaximumLength(128).Matches(@"^[A-Za-z][A-Za-z0-9.]*$")
            .WithMessage("Prefix must start with a letter and contain only letters, digits and dots.");
        RuleFor(x => x.ReturnType).MaximumLength(20);
        RuleFor(x => x.Top).InclusiveBetween(1, 50);
    }
}

public sealed class SuggestDaxFunctionsHandler(IDaxFunctionRepository repo)
    : IRequestHandler<SuggestDaxFunctionsQuery, IReadOnlyList<DaxFunctionSuggestionDto>>
{
    public Task<IReadOnlyList<DaxFunctionSuggestionDto>> Handle(SuggestDaxFunctionsQuery q, CancellationToken ct)
        => repo.SuggestAsync(q.Prefix.Trim(), string.IsNullOrWhiteSpace(q.ReturnType) ? null : q.ReturnType.Trim(), q.Top, ct);
}
