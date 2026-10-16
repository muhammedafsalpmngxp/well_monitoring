using Microsoft.EntityFrameworkCore;
using SmartOps.Finance.Infrastructure;
using SmartOps.Finance.Services;
using SmartOps.Shared;
using SmartOps.Shared.Db;
using SmartOps.Shared.Telemetry;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("finance");

builder.Services.AddSmartOpsDefaults(builder.Configuration, "SmartOps.Finance");
builder.Services.AddScoped<IFinanceService, FinanceService>();
builder.Services.AddSingleton<AuditSaveChangesInterceptor>();
builder.Services.AddDbContext<FinanceDbContext>((sp, opt) =>
{
    var cs = builder.Configuration.GetConnectionString("Default")
             ?? "Server=localhost,1433;Database=smartops_finance;User=sa;Password=CHANGE_ME;TrustServerCertificate=True;";
    opt.UseSqlServer(cs);
    opt.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());
});

var app = builder.Build();
app.UseSmartOpsDefaults();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<FinanceDbContext>();
    await FinanceSeeder.SeedAsync(db);
}

app.Run();
