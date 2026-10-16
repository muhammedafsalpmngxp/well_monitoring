using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using SmartOps.Shared.Middleware;

namespace SmartOps.Wells.API.Extensions
{
    /// <summary>
    /// Extension methods for registering presentation-layer services and middleware.
    /// </summary>
    public static class PresentationExtensions
    {
        /// <summary>
        /// Registers controllers, Swagger, and other presentation services.
        /// </summary>
        public static IServiceCollection AddPresentation(this IServiceCollection services)
        {
            services.AddControllers()
                .AddJsonOptions(opts =>
                {
                    opts.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
                });
            // Register Swagger or other presentation services here if needed
            // services.AddSwaggerGen();
            return services;
        }

        /// <summary>
        /// Registers global exception handling middleware.
        /// </summary>
        public static IApplicationBuilder UseGlobalExceptionHandling(this IApplicationBuilder app)
        {
            app.UseMiddleware<ExceptionMiddleware>();
            return app;
        }
    }
}
