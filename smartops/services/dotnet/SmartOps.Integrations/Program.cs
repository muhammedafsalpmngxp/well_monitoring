using Microsoft.EntityFrameworkCore;
using SmartOps.Integrations.Connectors;
using SmartOps.Integrations.Infrastructure;
using SmartOps.Shared;
using SmartOps.Shared.Db;
using SmartOps.Shared.Telemetry;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("integrations");

builder.Services.AddSmartOpsDefaults(builder.Configuration, "SmartOps.Integrations");
builder.Services.AddSingleton<SapConnector>();
builder.Services.AddSingleton<SalesforceConnector>();
builder.Services.AddSingleton<ServiceNowConnector>();
builder.Services.AddSingleton<AuditSaveChangesInterceptor>();
builder.Services.AddDbContext<IntegrationsDbContext>((sp, opt) =>
{
    var cs = builder.Configuration.GetConnectionString("Default")
             ?? "Server=localhost,1433;Database=smartops_integrations;User=sa;Password=CHANGE_ME;TrustServerCertificate=True;";
    opt.UseSqlServer(cs);
    opt.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());
});

var app = builder.Build();
app.UseSmartOpsDefaults();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<IntegrationsDbContext>();
    await IntegrationsSeeder.SeedAsync(db);
}

app.Run();
