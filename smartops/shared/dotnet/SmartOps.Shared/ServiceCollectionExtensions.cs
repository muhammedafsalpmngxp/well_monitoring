using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SmartOps.Shared.Auth;
using SmartOps.Shared.Middleware;

namespace SmartOps.Shared;

public static class ServiceCollectionExtensions
{
    /// <summary>One-line setup for every SmartOps .NET microservice.</summary>
    public static IServiceCollection AddSmartOpsDefaults(this IServiceCollection services,
                                                         IConfiguration config,
                                                         string serviceName)
    {
        services.AddSmartOpsAuth(config);
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(o => o.SwaggerDoc("v1",
            new() { Title = serviceName, Version = "v1" }));
        services.AddCors(o => o.AddDefaultPolicy(p =>
        {
            var origins = (config["Cors:AllowedOrigins"] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
        }));
        services.AddProblemDetails();
        services.AddControllers();
        return services;
    }

    public static WebApplication UseSmartOpsDefaults(this WebApplication app)
    {
        app.UseSmartOpsSecurityHeaders();
        app.UseSmartOpsExceptionHandling();
        app.UseSwagger();
        app.UseSwaggerUI();
        app.UseCors();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        app.MapGet("/health", (IConfiguration cfg) => new
        {
            status = "ok",
            service = cfg["Service:Name"] ?? "smartops",
            time = DateTime.UtcNow
        }).AllowAnonymous();
        return app;
    }
}
