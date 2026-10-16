using FluentValidation;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Domain;

namespace TWise.Tenant.API.Middleware;

public class ValidationExceptionMiddleware(RequestDelegate next, ILogger<ValidationExceptionMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (ValidationException ex)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            context.Response.ContentType = "application/json";

            var errorMessage = string.Join(" ", ex.Errors.Select(e => e.ErrorMessage));
            var envelope = ApiEnvelope<object>.Fail(errorMessage, 400);

            await context.Response.WriteAsJsonAsync(envelope);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            logger.LogError(ex, "Concurrency conflict on {Method} {Path}", context.Request.Method, context.Request.Path);

            context.Response.StatusCode = StatusCodes.Status409Conflict;
            context.Response.ContentType = "application/json";

            var envelope = ApiEnvelope<object>.Fail(
                "The record was modified by another request. Please reload and try again.", 409);
            await context.Response.WriteAsJsonAsync(envelope);
        }
        catch (DbUpdateException ex)
        {
            logger.LogError(ex, "Database save error on {Method} {Path}", context.Request.Method, context.Request.Path);

            var (statusCode, message) = ClassifyDbUpdateException(ex);
            context.Response.StatusCode = statusCode;
            context.Response.ContentType = "application/json";

            var envelope = ApiEnvelope<object>.Fail(message, statusCode);
            await context.Response.WriteAsJsonAsync(envelope);
        }
        catch (InvalidOperationException ex)
        {
            context.Response.StatusCode = StatusCodes.Status409Conflict;
            context.Response.ContentType = "application/json";

            var envelope = ApiEnvelope<object>.Fail(ex.Message, 409);
            await context.Response.WriteAsJsonAsync(envelope);
        }
        catch (UnauthorizedAccessException ex)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";

            var envelope = ApiEnvelope<object>.Fail(ex.Message, 403);
            await context.Response.WriteAsJsonAsync(envelope);
        }
        catch (SqlException ex)
        {
            logger.LogError(ex, "Database error on {Method} {Path}", context.Request.Method, context.Request.Path);

            context.Response.StatusCode = StatusCodes.Status502BadGateway;
            context.Response.ContentType = "application/json";

            var envelope = ApiEnvelope<object>.Fail(
                "Something went wrong while processing your request. Please try again.", 502);
            await context.Response.WriteAsJsonAsync(envelope);
        }
        catch (NotSupportedException ex)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            context.Response.ContentType = "application/json";

            var envelope = ApiEnvelope<object>.Fail(ex.Message, 400);
            await context.Response.WriteAsJsonAsync(envelope);
        }
    }

    private static (int StatusCode, string Message) ClassifyDbUpdateException(DbUpdateException ex)
    {
        if (ex.InnerException is SqlException sqlEx)
        {
            return sqlEx.Number switch
            {
                2601 or 2627 => (StatusCodes.Status409Conflict,
                    "A record with the same unique value already exists."),
                547 => (StatusCodes.Status400BadRequest,
                    "The operation failed because it references a record that does not exist, or another record depends on it."),
                8152 => (StatusCodes.Status400BadRequest,
                    "One or more values exceed the allowed length."),
                515 => (StatusCodes.Status400BadRequest,
                    "A required field was not provided."),
                _ => (StatusCodes.Status422UnprocessableEntity,
                    "The data could not be saved due to a constraint violation."),
            };
        }

        return (StatusCodes.Status422UnprocessableEntity,
            "The data could not be saved. Please verify your input and try again.");
    }
}
