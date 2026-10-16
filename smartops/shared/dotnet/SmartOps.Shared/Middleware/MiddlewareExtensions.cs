using Microsoft.AspNetCore.Builder;

namespace SmartOps.Shared.Middleware;

public static class MiddlewareExtensions
{
    public static IApplicationBuilder UseSmartOpsExceptionHandling(this IApplicationBuilder app)
        => app.UseMiddleware<ExceptionMiddleware>();

    /// <summary>Browser hardening headers on every response; see SecurityHeadersMiddleware.</summary>
    public static IApplicationBuilder UseSmartOpsSecurityHeaders(this IApplicationBuilder app)
        => app.UseMiddleware<SecurityHeadersMiddleware>();
}
