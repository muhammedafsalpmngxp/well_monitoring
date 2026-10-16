using MediatR;
using Microsoft.Extensions.Logging;
using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;

namespace TWise.Backend.ControlPlane.Application.Common.Behaviors;

public sealed class LoggingBehavior<TRequest, TResponse>(ILogger<LoggingBehavior<TRequest, TResponse>> logger)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    [SuppressMessage("Design", "S2139:Exceptions should be either logged or rethrown but not both",
        Justification = "This is a cross-cutting logging pipeline; logging + rethrowing is intentional.")]
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        var requestName = typeof(TRequest).Name;
        var requestType = requestName.Contains("Command") ? "Command" : "Query";

        logger.LogInformation(
            "[ControlPlane] {RequestType} Start: {RequestName}",
            requestType, requestName);

        var sw = Stopwatch.StartNew();

        try
        {
            var response = await next();
            sw.Stop();

            if (sw.ElapsedMilliseconds > 500)
                logger.LogWarning(
                    "[ControlPlane] {RequestType} Slow: {RequestName} completed in {ElapsedMs}ms",
                    requestType, requestName, sw.ElapsedMilliseconds);
            else
                logger.LogInformation(
                    "[ControlPlane] {RequestType} Done: {RequestName} in {ElapsedMs}ms",
                    requestType, requestName, sw.ElapsedMilliseconds);

            return response;
        }
        catch (Exception ex)
        {
            sw.Stop();
            logger.LogError(ex,
                "[ControlPlane] {RequestType} Failed: {RequestName} after {ElapsedMs}ms",
                requestType, requestName, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
