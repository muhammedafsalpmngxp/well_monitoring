using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SmartOps.Shared.Errors;

namespace SmartOps.Shared.Middleware;

/// <summary>Catches all exceptions and returns the unified ApiErrorResponse envelope.</summary>
public sealed class ExceptionMiddleware(
    RequestDelegate next,
    ILogger<ExceptionMiddleware> log,
    IHostEnvironment env)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        try { await next(ctx); }
        catch (Exception ex)
        {
            log.LogError(ex, "Unhandled exception {Path}", ctx.Request.Path);

            var (status, code, message) = Classify(ex);

            ctx.Response.Clear();
            ctx.Response.StatusCode = (int)status;
            ctx.Response.ContentType = "application/json";

            var body = new ApiErrorResponse
            {
                Error = new ApiError
                {
                    Code = code,
                    Message = message,
                    Details = env.IsDevelopment() ? ex.ToString() : null,
                    TraceId = ctx.TraceIdentifier
                }
            };
            await ctx.Response.WriteAsync(JsonSerializer.Serialize(body,
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        }
    }

    private static (HttpStatusCode Status, string Code, string Message) Classify(Exception ex) => ex switch
    {
        ArgumentException arg =>
            (HttpStatusCode.BadRequest, "BAD_REQUEST", arg.Message),

        KeyNotFoundException knf =>
            (HttpStatusCode.NotFound, "NOT_FOUND", knf.Message),

        UnauthorizedAccessException =>
            (HttpStatusCode.Unauthorized, "UNAUTHORIZED", "Authentication is required."),

        DbUpdateConcurrencyException =>
            (HttpStatusCode.Conflict, "CONCURRENCY_CONFLICT",
             "The record was modified by another request. Please reload and try again."),

        DbUpdateException dbEx => ClassifyDbUpdate(dbEx),

        _ => (HttpStatusCode.InternalServerError, "INTERNAL_ERROR",
              "An unexpected error occurred. Please try again or contact support.")
    };

    private static (HttpStatusCode, string, string) ClassifyDbUpdate(DbUpdateException ex)
    {
        // Drill into SqlException for specific SQL Server error numbers
        if (ex.InnerException is SqlException sqlEx)
        {
            return sqlEx.Number switch
            {
                // Unique-key / unique-index violation
                2601 or 2627 => (HttpStatusCode.Conflict, "DUPLICATE_ENTRY",
                    "A record with the same unique value already exists."),

                // Foreign-key violation
                547 => (HttpStatusCode.BadRequest, "REFERENCE_CONSTRAINT",
                    "The operation failed because it references a record that does not exist, or another record depends on it."),

                // String/binary truncation
                8152 => (HttpStatusCode.BadRequest, "VALUE_TOO_LONG",
                    "One or more values exceed the allowed length."),

                // Cannot insert NULL
                515 => (HttpStatusCode.BadRequest, "REQUIRED_FIELD_MISSING",
                    "A required field was not provided."),

                _ => (HttpStatusCode.UnprocessableEntity, "DATA_ERROR",
                    "The data could not be saved due to a constraint violation.")
            };
        }

        return (HttpStatusCode.UnprocessableEntity, "DATA_ERROR",
            "The data could not be saved. Please verify your input and try again.");
    }
}
