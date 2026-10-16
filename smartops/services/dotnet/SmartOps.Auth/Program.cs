using Microsoft.EntityFrameworkCore;
using SmartOps.Auth.Infrastructure;
using SmartOps.Auth.Services;
using SmartOps.Shared;
using SmartOps.Shared.Db;
using SmartOps.Shared.Telemetry;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("auth");

builder.Services.AddSmartOpsDefaults(builder.Configuration, "SmartOps.Auth");
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddSingleton<AuditSaveChangesInterceptor>();
builder.Services.AddDbContext<AuthDbContext>((sp, opt) =>
{
    var cs = builder.Configuration.GetConnectionString("Default")
             ?? "Server=.;Database=smartops_auth;Integrated Security=True;TrustServerCertificate=True;";
    opt.UseSqlServer(cs);
    opt.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());
});

var app = builder.Build();
app.UseSmartOpsDefaults();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AuthDbContext>();
    await AuthSeeder.SeedAsync(db);
}

app.Run();
