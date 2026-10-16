using SmartOps.Shared;
using SmartOps.Shared.Telemetry;
using SmartOps.Wells.API.Extensions;
using SmartOps.Wells.Application;
using SmartOps.Wells.Infrastructure;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("wells");

// ── Layer registrations ───────────────────────────────────────────────────────
builder.Services.AddMemoryCache();
builder.Services.AddSmartOpsDefaults(builder.Configuration, "SmartOps.Wells");
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddPresentation();

var app = builder.Build();

// ── Middleware pipeline ───────────────────────────────────────────────────────
// GlobalExceptionMiddleware must be first to catch all downstream exceptions.
app.UseGlobalExceptionHandling();
app.UseSmartOpsDefaults();

// Health check endpoint (infrastructure health checks registered in AddInfrastructure)
app.MapHealthChecks("/health/ready").AllowAnonymous();

// Seeding is disabled — WellsDbContext points to the remote AppMasterDB.
// Uncomment the block below for local development with a fresh SQL Server instance:
// using (var scope = app.Services.CreateScope())
// {
//     var db = scope.ServiceProvider.GetRequiredService<WellsDbContext>();
//     await SmartOps.Wells.Infrastructure.Persistence.WellsSeeder.SeedAsync(db);
// }

app.Run();

// Required for WebApplicationFactory<Program> in integration tests
public partial class Program { }
