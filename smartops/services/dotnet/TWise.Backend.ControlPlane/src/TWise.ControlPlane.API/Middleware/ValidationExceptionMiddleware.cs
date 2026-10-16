using System.Net;
using System.Text.Json;
using FluentValidation;

namespace TWise.Backend.ControlPlane.API.Middleware;

/// <summary>
/// Catches FluentValidation exceptions thrown by the MediatR ValidationBehavior
/// and maps them to a structured 400 response before they reach the shared ExceptionMiddleware.
/// </summary>
public sealed class ValidationExceptionMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        try
        {
            await next(ctx);
        }
        catch (ValidationException ex)
        {
            ctx.Response.StatusCode = (int)HttpStatusCode.BadRequest;
            ctx.Response.ContentType = "application/json";

            var errors = ex.Errors
                .GroupBy(e => e.PropertyName)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(e => e.ErrorMessage).ToArray());

            var body = new
            {
                error = new
                {
                    code = "VALIDATION_FAILED",
                    message = "One or more validation errors occurred.",
                    details = errors,
                    traceId = ctx.TraceIdentifier
                }
            };

            await ctx.Response.WriteAsync(JsonSerializer.Serialize(body,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        }
    }
}
