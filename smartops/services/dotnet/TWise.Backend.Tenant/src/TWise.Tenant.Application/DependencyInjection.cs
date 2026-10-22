using FluentValidation;
using MediatR;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Application.Features.Model;

namespace TWise.Tenant.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = typeof(DependencyInjection).Assembly;

        services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(assembly));

        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));

        // Dataset query cache (design decision D-4). ModelCache:Minutes is how long a snapshot or a
        // result is kept; ModelCache:SizeLimit caps what is held, counted in rows.
        services.AddSingleton(sp =>
        {
            var configuration = sp.GetRequiredService<IConfiguration>();
            return new ModelCache(
                TimeSpan.FromMinutes(int.TryParse(configuration["ModelCache:Minutes"], out var minutes) ? minutes : 10),
                long.TryParse(configuration["ModelCache:SizeLimit"], out var sizeLimit) ? sizeLimit : 200_000);
        });

        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(DatasetChangeBehavior<,>));

        // Explain and AI deck limits: the AiExplain section of appsettings.json (no defaults in code).
        services.AddSingleton(sp => Features.Ai.AiExplainOptions.From(sp.GetRequiredService<IConfiguration>()));
        services.AddSingleton(sp => Features.Ai.AiAlertOptions.From(sp.GetRequiredService<IConfiguration>()));
        services.AddSingleton(sp => Features.Ai.AiSqlReviewOptions.From(sp.GetRequiredService<IConfiguration>()));
        services.AddSingleton(sp => Features.Ai.AiAdminOptions.From(sp.GetRequiredService<IConfiguration>(), Features.Ai.Settings.AiMapping.ProviderKinds));
        services.AddValidatorsFromAssembly(assembly, includeInternalTypes: true);

        services.AddScoped<DeliveryRunner>();

        return services;
    }
}
