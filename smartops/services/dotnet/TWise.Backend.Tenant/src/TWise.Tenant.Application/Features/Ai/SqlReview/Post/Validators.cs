using FluentValidation;

namespace TWise.Tenant.Application.Features.Ai.SqlReview;

public sealed class ReviewSqlCommandValidator : AbstractValidator<ReviewSqlCommand>
{
    public ReviewSqlCommandValidator()
    {
        RuleFor(x => x.Request.ConnectionId).GreaterThan(0);
        RuleFor(x => x.Request).Must(r => r.ViewId is not null || !string.IsNullOrWhiteSpace(r.Sql)).WithMessage("Send the SQL or a viewId.");
        RuleFor(x => x.Request.Sql).MaximumLength(ReviewSqlHandler.MaxSqlLength).WithMessage($"The SQL is too long to review (max {ReviewSqlHandler.MaxSqlLength} characters).");
    }
}
