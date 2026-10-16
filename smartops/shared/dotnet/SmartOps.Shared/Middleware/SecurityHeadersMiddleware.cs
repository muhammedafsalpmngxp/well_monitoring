using Microsoft.AspNetCore.Http;

namespace SmartOps.Shared.Middleware;

/// <summary>
/// Adds the standard browser hardening headers to every response. These are cheap, framework
/// independent and safe for a JSON API: they stop MIME sniffing, clickjacking of any HTML the
/// API might serve, referrer leakage, and opt the app out of powerful browser features it never
/// uses. HSTS is left to the host (UseHsts) because it depends on the deployment being HTTPS.
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        var h = context.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["X-Frame-Options"] = "SAMEORIGIN";
        h["Referrer-Policy"] = "strict-origin-when-cross-origin";
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
        h["X-XSS-Protection"] = "0";
        return next(context);
    }
}
