using FluentValidation;
using MediatR;
using Microsoft.Extensions.DependencyInjection;
using SmartOps.Wells.Application.Common.Behaviors;

namespace SmartOps.Wells.Application;

public static class DependencyInjection
{
    /// <summary>
    /// Registers Application layer services: MediatR, pipeline behaviors, and FluentValidation validators.
    /// Call from Program.cs: <c>builder.Services.AddApplication();</c>
    /// </summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = typeof(DependencyInjection).Assembly;

        services.AddMediatR(cfg =>
        {
            cfg.RegisterServicesFromAssembly(assembly);
        });

        // Pipeline: Logging → Validation → Handler
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(LoggingBehavior<,>));
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));

        // Register all FluentValidation validators in the Application assembly
        services.AddValidatorsFromAssembly(assembly, includeInternalTypes: true);

        return services;
    }
}
