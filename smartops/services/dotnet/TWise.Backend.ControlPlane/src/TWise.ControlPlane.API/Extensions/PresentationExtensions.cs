using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using TWise.Backend.ControlPlane.API.Middleware;
using SmartOps.Shared.Middleware;

namespace TWise.Backend.ControlPlane.API.Extensions;

public static class PresentationExtensions
{
    public static IServiceCollection AddPresentation(this IServiceCollection services)
    {
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build());
        services.AddControllers()
            .AddJsonOptions(opts =>
            {
                opts.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
            });
        return services;
    }

    public static IApplicationBuilder UseGlobalExceptionHandling(this IApplicationBuilder app)
    {
        // ExceptionMiddleware (outer) — catches unhandled exceptions → 500
        // ValidationExceptionMiddleware (inner, closer to controllers) — catches FluentValidation → 400
        // Order matters: inner middleware catches first, outer is the fallback
        app.UseMiddleware<ExceptionMiddleware>();
        app.UseMiddleware<ValidationExceptionMiddleware>();
        return app;
    }
}
