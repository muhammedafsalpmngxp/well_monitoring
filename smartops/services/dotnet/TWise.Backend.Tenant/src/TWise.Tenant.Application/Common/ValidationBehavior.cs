using FluentValidation;
using MediatR;

namespace TWise.Tenant.Application.Common;

/// <summary>
/// MediatR pipeline behavior that automatically runs FluentValidation validators
/// before the handler executes. Returns ValidationError result if validation fails.
/// </summary>
public sealed class ValidationBehavior<TRequest, TResponse>(IEnumerable<IValidator<TRequest>> validators)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        if (!validators.Any())
            return await next();

        var context = new ValidationContext<TRequest>(request);

        var validationResults = await Task.WhenAll(
            validators.Select(v => v.ValidateAsync(context, cancellationToken)));

        var failures = validationResults
            .SelectMany(r => r.Errors)
            .Where(f => f is not null)
            .ToList();

        if (failures.Count == 0)
            return await next();

        // Build error message
        var errorMessage = string.Join(" ", failures.Select(f => f.ErrorMessage));

        // Try to return Result<T>.ValidationError if response is a Result type
        var responseType = typeof(TResponse);

        if (responseType.IsGenericType && responseType.GetGenericTypeDefinition() == typeof(Result<>))
        {
            var method = responseType.GetMethod("ValidationError", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (method is not null)
                return (TResponse)method.Invoke(null, [errorMessage])!;
        }

        if (responseType == typeof(Result))
        {
            return (TResponse)(object)Result.ValidationError(errorMessage);
        }

        // Fallback: throw exception
        throw new FluentValidation.ValidationException(failures);
    }
}
