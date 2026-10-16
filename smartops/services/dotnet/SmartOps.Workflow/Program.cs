using Microsoft.EntityFrameworkCore;
using SmartOps.Shared;
using SmartOps.Shared.Db;
using SmartOps.Shared.Telemetry;
using SmartOps.Workflow.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("workflow");

builder.Services.AddSmartOpsDefaults(builder.Configuration, "SmartOps.Workflow");
builder.Services.AddSingleton<AuditSaveChangesInterceptor>();
builder.Services.AddDbContext<WorkflowDbContext>((sp, opt) =>
{
    var cs = builder.Configuration.GetConnectionString("Default")
             ?? "Server=localhost,1433;Database=smartops_workflow;User=sa;Password=CHANGE_ME;TrustServerCertificate=True;";
    opt.UseSqlServer(cs);
    opt.AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>());
});

var app = builder.Build();
app.UseSmartOpsDefaults();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<WorkflowDbContext>();
    await WorkflowSeeder.SeedAsync(db);
}

app.Run();
