using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Hosting;
using Serilog;

namespace SmartOps.Shared.Telemetry;

public static class SerilogExtensions
{
    public static IHostBuilder UseSmartOpsSerilog(this IHostBuilder host, string serviceName)
    {
        return host.UseSerilog((ctx, services, lc) =>
        {
            lc.MinimumLevel.Information()
              .Enrich.WithProperty("service", serviceName)
              .Enrich.FromLogContext()
              .WriteTo.Console(outputTemplate:
                  "[{Timestamp:HH:mm:ss} {Level:u3}] {service} {Message:lj} {Properties:j}{NewLine}{Exception}");
        });
    }
}
