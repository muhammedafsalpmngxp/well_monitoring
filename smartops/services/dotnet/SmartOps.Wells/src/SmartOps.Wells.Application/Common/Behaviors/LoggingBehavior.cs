using System.Diagnostics;
using MediatR;
using Microsoft.Extensions.Logging;

namespace SmartOps.Wells.Application.Common.Behaviors;

/// <summary>
/// MediatR pipeline behavior that logs the start, completion, and elapsed time
/// of every request/response pair. Requests exceeding the slow-request threshold
/// are logged at Warning level to surface performance bottlenecks.
/// </summary>
public sealed class LoggingBehavior<TRequest, TResponse>(
    ILogger<LoggingBehavior<TRequest, TResponse>> logger)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private static readonly TimeSpan SlowRequestThreshold = TimeSpan.FromMilliseconds(500);

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        var requestName = typeof(TRequest).Name;
        var sw = Stopwatch.StartNew();

        logger.LogInformation("Handling {RequestName}", requestName);

        TResponse response;
        try
        {
            response = await next();
        }
        catch (Exception ex)
        {
            sw.Stop();
            logger.LogError(ex,
                "Request {RequestName} failed after {ElapsedMs}ms",
                requestName, sw.ElapsedMilliseconds);
            throw;
        }

        sw.Stop();

        if (sw.Elapsed > SlowRequestThreshold)
        {
            logger.LogWarning(
                "Slow request detected — {RequestName} completed in {ElapsedMs}ms",
                requestName, sw.ElapsedMilliseconds);
        }
        else
        {
            logger.LogInformation(
                "Handled {RequestName} in {ElapsedMs}ms",
                requestName, sw.ElapsedMilliseconds);
        }

        return response;
    }
}
