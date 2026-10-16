using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Base controller with shared Result-to-HTTP mapping helpers.
/// All successful responses are wrapped in ApiEnvelope&lt;T&gt;.
/// </summary>
[ApiController]
public abstract class BaseApiController : ControllerBase
{
    protected IActionResult ToActionResult<T>(Result<T> result, int successCode = 200)
    {
        if (result.IsSuccess)
            return StatusCode(successCode, ApiEnvelope<T>.Ok(result.Value!, statusCode: successCode));

        var (code, message) = MapError(result.Status, result.ErrorMessage);
        return StatusCode(code, ApiEnvelope<T>.Fail(message, code));
    }

    protected IActionResult ToVoidActionResult(Result result)
    {
        if (result.IsSuccess)
            return NoContent();

        var (code, message) = MapError(result.Status, result.ErrorMessage);
        return StatusCode(code, ApiEnvelope<object>.Fail(message, code));
    }

    private static (int Code, string Message) MapError(ResultStatus status, string? errorMessage) =>
        status switch
        {
            ResultStatus.NotFound => (404, errorMessage ?? "Resource not found"),
            ResultStatus.Conflict => (409, errorMessage ?? "Conflict"),
            ResultStatus.ValidationError => (400, errorMessage ?? "Validation error"),
            ResultStatus.Forbidden => (403, errorMessage ?? "Forbidden"),
            _ => (500, errorMessage ?? "Internal server error")
        };
}
