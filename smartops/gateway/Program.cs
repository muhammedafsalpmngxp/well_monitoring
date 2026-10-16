using SmartOps.Shared;
using SmartOps.Shared.Auth;
using SmartOps.Shared.Middleware;
using SmartOps.Shared.Telemetry;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSmartOpsSerilog("gateway");

builder.Services.AddSmartOpsAuth(builder.Configuration);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// YARP reverse proxy — routes & clusters in appsettings.json
builder.Services
    .AddReverseProxy()
    .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    var origins = (builder.Configuration["Cors:AllowedOrigins"] ?? string.Empty)
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
}));

var app = builder.Build();
app.UseSmartOpsExceptionHandling();
app.UseSwagger();
app.UseSwaggerUI();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => new
{
    name = "SmartOps API Gateway",
    docs = "/swagger",
    services = new[] { "auth", "wells", "finance", "workflow", "reports",
                       "integrations", "jenny", "predictive", "anomaly",
                       "crew-optimizer", "vision" }
}).AllowAnonymous();

app.MapGet("/health", () => new { status = "ok", service = "gateway" }).AllowAnonymous();

// All proxied routes require a valid JWT except /api/v1/auth/login
app.MapReverseProxy();

app.Run();
