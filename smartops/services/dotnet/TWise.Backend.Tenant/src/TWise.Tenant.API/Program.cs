using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using TWise.Tenant.Application;
using TWise.Tenant.API.Auth;
using TWise.Tenant.API.Middleware;
using TWise.Tenant.Infrastructure;
using TWise.Tenant.Infrastructure.Services;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// View/report payloads can reach hundreds of MB and take minutes to stream.
// The default 240 bytes/s minimum rate and 30s grace abort those responses mid-flight.
builder.WebHost.ConfigureKestrel(o =>
{
    o.Limits.MinResponseDataRate = null;
    o.Limits.MinRequestBodyDataRate = null;
    o.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
    o.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(2);
    o.Limits.MaxRequestBodySize = 200L * 1024 * 1024;
});

builder.Host.UseSerilog((ctx, services, lc) =>
{
    lc.MinimumLevel.Information()
      .Enrich.WithProperty("service", "tenant")
      .Enrich.FromLogContext()
      .WriteTo.Console(outputTemplate:
          "[{Timestamp:HH:mm:ss} {Level:u3}] {service} {Message:lj} {Properties:j}{NewLine}{Exception}")
      .WriteTo.File("logs/tenant-.log",
          rollingInterval: RollingInterval.Day,
          retainedFileCountLimit: 30,
          outputTemplate:
          "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff} {Level:u3}] {service} {Message:lj} {Properties:j}{NewLine}{Exception}");
});

// ─── Swagger ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers();

// Per-address request rate limit; the AI daily quota and the login limiter on the ControlPlane
// cover the expensive and unauthenticated paths, this only stops runaway clients.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.GlobalLimiter = System.Threading.RateLimiting.PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Example: 'Bearer {token}'",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        }
    });

    // Dev headers for testing admin-only endpoints without a real JWT
    if (builder.Environment.IsDevelopment())
    {
        c.AddSecurityDefinition("DevHeaders", new OpenApiSecurityScheme
        {
            Description = "Dev-only: simulates user identity. Use X-User-Id and X-User-Role headers.",
            Name = "X-User-Role",
            In = ParameterLocation.Header,
            Type = SecuritySchemeType.ApiKey
        });
        c.AddSecurityRequirement(new OpenApiSecurityRequirement
        {
            {
                new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "DevHeaders" }
                },
                Array.Empty<string>()
            }
        });
    }
});

// ─── JWT Authentication — same secret/issuer/audience as ControlPlane ─────────
var jwtSecret = RequireSecret(builder.Configuration, "JwtSettings:SecretKey");
var jwtIssuer = builder.Configuration["JwtSettings:Issuer"] ?? "smartops.auth";
var jwtAudience = builder.Configuration["JwtSettings:Audience"] ?? "smartops.api";

builder.Services.AddHttpClient("SessionValidation", client =>
{
    var baseUrl = builder.Configuration["ControlPlane:BaseUrl"]
        ?? throw new InvalidOperationException("ControlPlane:BaseUrl is not configured.");
    client.BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(10);
});

builder.Services.AddAuthentication(options =>
    {
        if (builder.Environment.IsDevelopment())
        {
            // In dev: default to DevHeaders; forward to JWT if a real Bearer token is present
            options.DefaultAuthenticateScheme = DevHeaderAuthHandler.SchemeName;
            options.DefaultChallengeScheme = DevHeaderAuthHandler.SchemeName;
        }
        else
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        }
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret))
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = async context =>
            {
                if (context.Principal?.FindFirst("token_type")?.Value != "access"
                    || string.IsNullOrEmpty(context.Principal.FindFirst("security_stamp")?.Value))
                {
                    context.Fail("An active access token is required.");
                    return;
                }

                var client = context.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>()
                    .CreateClient("SessionValidation");
                using var request = new HttpRequestMessage(HttpMethod.Get, "auth/session");
                request.Headers.Authorization = AuthenticationHeaderValue.Parse(context.Request.Headers.Authorization.ToString());
                using var response = await client.SendAsync(request, context.HttpContext.RequestAborted);
                if (response.StatusCode == HttpStatusCode.Unauthorized)
                    context.Fail("Your session has ended. Please sign in again.");
                else
                    response.EnsureSuccessStatusCode();
            }
        };
    })
    .AddScheme<AuthenticationSchemeOptions, DevHeaderAuthHandler>(DevHeaderAuthHandler.SchemeName, _ => { });

builder.Services.AddAuthorization();

// ─── Application & Infrastructure (DI extension methods) ──────────────────────
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHostedService<TWise.Tenant.Infrastructure.Delivery.ScheduleWorker>();

// ─── Cross-Cutting ────────────────────────────────────────────────────────────
builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();

// CORS — allow Angular dev server and configured front-end origins
var corsOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? [];

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        if (corsOrigins.Length == 0)
            policy.SetIsOriginAllowed(_ => false);
        else
            policy.WithOrigins(corsOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod();
    });
});

// ─── Encryption ───────────────────────────────────────────────────────────────
var encryptionKey = RequireSecret(builder.Configuration, "DatabaseConnections:EncryptionKey");
ConnectionPasswordHelper.Initialize(encryptionKey);

// ─── Build ────────────────────────────────────────────────────────────────────
var app = builder.Build();

// ─── Middleware Pipeline (order matters) ──────────────────────────────────────
app.UseExceptionHandler(error => error.Run(async context =>
{
    var exceptionFeature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
    var exception = exceptionFeature?.Error;

    var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("GlobalExceptionHandler");
    logger.LogError(exception, "Unhandled exception on {Method} {Path}", context.Request.Method, context.Request.Path);

    context.Response.StatusCode = 500;
    context.Response.ContentType = "application/json";

    var message = app.Environment.IsDevelopment() && exception is not null
        ? exception.Message
        : "An unexpected error occurred. Please try again later.";

    await context.Response.WriteAsJsonAsync(
        TWise.Tenant.Domain.ApiEnvelope<object>.Fail(message, 500));
}));

if (app.Environment.IsDevelopment())
{
    // Behind the frontend's nginx proxy, Tenant is only reachable under
    // /api/tenant/*, but Swashbuckle generates routes as plain /api/* since
    // it has no idea it's proxied — Swagger UI's "Try it out" then calls
    // https://<host>/api/... directly, which nginx doesn't recognize and
    // falls through to the Angular SPA. Add an OpenAPI "servers" entry from
    // X-Forwarded-Prefix (set by nginx only on the proxied path) so
    // "Try it out" prefixes requests correctly; absent locally, so direct
    // http://localhost:5069 access is unaffected.
    app.UseSwagger(o => o.PreSerializeFilters.Add((doc, req) =>
    {
        var prefix = req.Headers["X-Forwarded-Prefix"].FirstOrDefault();
        if (!string.IsNullOrEmpty(prefix))
            doc.Servers = [new() { Url = prefix }];
    }));
    app.UseSwaggerUI();
}

// Browser hardening headers on every response (same set as SmartOps.Shared's SecurityHeadersMiddleware).
app.Use(async (context, next) =>
{
    var h = context.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "SAMEORIGIN";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
    h["X-XSS-Protection"] = "0";
    await next();
});
if (!app.Environment.IsDevelopment()) app.UseHsts();
// CORS first so a 429 still carries CORS headers (otherwise the browser reports a CORS error).
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<ValidationExceptionMiddleware>();
app.MapControllers();

app.MapGet("/health", (IConfiguration cfg) => new
{
    status  = "ok",
    service = cfg["Service:Name"] ?? "tenant",
    time    = DateTime.UtcNow
}).AllowAnonymous();

app.Run();

// A secret that must be set. Every TWise API on the same database must use the same value (the appsettings.json
// one unless overridden), or encrypted settings saved by one become unreadable for the others.
static string RequireSecret(IConfiguration config, string key)
{
    var value = config[key];
    if (string.IsNullOrWhiteSpace(value))
        throw new InvalidOperationException($"{key} is not configured.");
    return value;
}
