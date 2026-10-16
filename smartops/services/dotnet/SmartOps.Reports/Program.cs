using Microsoft.EntityFrameworkCore;
using SmartOps.Reports.Hubs;
using SmartOps.Reports.Infrastructure;
using SmartOps.Reports.Services;
using SmartOps.Shared;
using SmartOps.Shared.Db;
using SmartOps.Shared.Telemetry;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("reports");

builder.Services.AddSmartOpsDefaults(builder.Configuration, "SmartOps.Reports");
builder.Services.AddScoped<IReportRenderer, ReportRenderer>();
builder.Services.AddSingleton<IAlertsBroadcaster, AlertsBroadcaster>();
builder.Services.AddSingleton<AuditSaveChangesInterceptor>();
builder.Services.AddDbContext<ReportsDbContext>((sp, opt) =>
{
    var cs = builder.Configuration.GetConnectionString("Default")
             ?? "Server=.;Database=smartops_reports;Integrated Security=True;TrustServerCertificate=True;";
    opt.UseSqlServer(cs);
    opt.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());
});

// SignalR with Redis backplane (so multiple Reports pods in AKS stay in sync)
var redis = builder.Configuration["Redis:ConnectionString"];
var signalR = builder.Services.AddSignalR();
if (!string.IsNullOrWhiteSpace(redis))
    signalR.AddStackExchangeRedis(redis, o => o.Configuration.ChannelPrefix =
        StackExchange.Redis.RedisChannel.Literal("smartops"));

var app = builder.Build();
app.UseSmartOpsDefaults();
app.MapHub<AlertsHub>("/hubs/alerts");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ReportsDbContext>();
    await ReportsSeeder.SeedAsync(db);
}

app.Run();
