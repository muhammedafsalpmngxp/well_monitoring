using FluentValidation;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Common;

public sealed class GetFilteredChartDataValidator : AbstractValidator<GetFilteredChartDataQuery>
{
    public GetFilteredChartDataValidator()
    {
        RuleFor(x => x.Request).NotNull();
        RuleFor(x => x.Request.ChartSource).NotEmpty().MaximumLength(128);
        RuleFor(x => x.Request.ChartSourceType).NotEmpty().MaximumLength(20);
        RuleFor(x => x.Request.Filters).NotNull();
        RuleForEach(x => x.Request.Filters).ChildRules(f =>
        {
            f.RuleFor(p => p.SourceTable).NotEmpty().MaximumLength(128);
            f.RuleFor(p => p.SourceColumn).NotEmpty().MaximumLength(128);
            f.RuleFor(p => p.ControlType).NotEmpty().MaximumLength(20);
            f.RuleFor(p => p.Value).MaximumLength(500);
            f.RuleFor(p => p.Values).Must(values => values == null || values.Count <= 100)
                .WithMessage("A filter supports at most 100 selected values.");
            f.RuleForEach(p => p.Values).NotEmpty().MaximumLength(500);
        });
        // Table-sourced filters are interpolated into dynamic SQL identifiers and must stay strictly
        // validated; view-sourced filters are only regex-matched against @placeholder names (safely
        // escaped), so real-world column/table names containing spaces etc. are allowed there.
        RuleForEach(x => x.Request.Filters).ChildRules(f =>
        {
            f.RuleFor(p => p.SourceTable)
                .Matches(@"^[a-zA-Z_]\w*$").WithMessage("SourceTable contains invalid characters.");
            f.RuleFor(p => p.SourceColumn)
                .Matches(@"^[a-zA-Z_]\w*$").WithMessage("SourceColumn contains invalid characters.");
        }).When(x => !x.Request.ViewId.HasValue);
        RuleFor(x => x.Request.FromDate).MaximumLength(10)
            .Matches(@"^\d{4}-\d{2}-\d{2}$").When(x => x.Request.FromDate != null)
            .WithMessage("FromDate must be in yyyy-MM-dd format.");
        RuleFor(x => x.Request.ToDate).MaximumLength(10)
            .Matches(@"^\d{4}-\d{2}-\d{2}$").When(x => x.Request.ToDate != null)
            .WithMessage("ToDate must be in yyyy-MM-dd format.");
    }
}
