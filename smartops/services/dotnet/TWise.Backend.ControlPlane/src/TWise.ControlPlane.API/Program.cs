using System.Reflection;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.OpenApi.Models;
using Serilog;
using TWise.Backend.ControlPlane.API.Auth;
using TWise.Backend.ControlPlane.API.Extensions;
using TWise.Backend.ControlPlane.Application;
using TWise.Backend.ControlPlane.Infrastructure;
using SmartOps.Shared;
using SmartOps.Shared.Telemetry;
using Swashbuckle.AspNetCore.SwaggerGen;

var builder = WebApplication.CreateBuilder(args);

// Serilog: reads from appsettings.json "Serilog" section for levels, sinks, and enrichers.
builder.Host.UseSerilog((ctx, services, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .ReadFrom.Services(services));

// ── Layer registrations ───────────────────────────────────────────────────────
builder.Services.AddSmartOpsDefaults(builder.Configuration, "TWise.Backend.ControlPlane");
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddPresentation();

// Request rate limits, partitioned by client address. "auth" is tight because login is the one
// endpoint an attacker can hammer without a token; the global limit only stops runaway clients.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = (ctx, _) => { ctx.HttpContext.Response.Headers.RetryAfter = "60"; return ValueTask.CompletedTask; };
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 600, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

//output caching for GET endpoints that return lists 
builder.Services.AddOutputCache(o =>
{
    o.AddBasePolicy(p => p.NoCache());
    o.AddPolicy("ControlPlaneList", p => p.Expire(TimeSpan.FromMinutes(5)).Tag("controlplane"));
});

// ── Dev mode: disable auth — all endpoints are anonymous ──────────────────────
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAssertion(_ => true)
        .Build());

// ── Internal API-key authentication for service-to-service calls ──────────────
// Needed for InternalUsersController + InternalNotificationsController (Tenant -> ControlPlane
// notification ingest) to actually authenticate — the dev fallback policy above only covers
// endpoints with NO explicit [Authorize(Policy=...)]; a named policy that isn't registered here
// throws at request time instead of being bypassed.
builder.Services.AddAuthentication()
    .AddScheme<AuthenticationSchemeOptions, InternalApiKeyHandler>(
        InternalApiKeyHandler.SchemeName, _ => { });
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(InternalApiKeyHandler.PolicyName, p => p
        .AddAuthenticationSchemes(InternalApiKeyHandler.SchemeName)
        .RequireRole("internal"));

// Override the default Swagger doc registered by AddSmartOpsDefaults and add security + descriptions
builder.Services.Configure<SwaggerGenOptions>(o =>
{
    o.SwaggerGeneratorOptions.SwaggerDocs["v1"] = new OpenApiInfo
    {
        Title = "SmartOps Control Plane API",
        Version = "v1",
        Description = """
## Overview
The Control Plane manages multi-tenant configuration, access control, data-source integration, and schema governance for the SmartOps platform.

---

## API Setup Flow (Step-by-Step)

Follow this sequence when onboarding a new tenant from scratch:

| Step | API | Purpose |
|------|-----|---------|
| **1** | `POST /regions` | Create deployment region (e.g. ME-East, EU-West) |
| **2** | `POST /tenants` | Register a new tenant and assign it to a region |
| **3** | `POST /schema-versions` | Define the data-model version the tenant will use |
| **4** | `POST /roles` | Create platform roles (Admin, Manager, Viewer) |
| **5** | `POST /features` | Register available feature flags |
| **6** | `POST /users` | Create application users |
| **7** | `POST /user-tenant-roles` | Assign users → tenant with a role |
| **8** | `POST /tenant-features` | Enable specific features for the tenant |
| **9** | `POST /source-systems` | Register external data sources (SAP, SCADA, etc.) |
| **10** | `POST /tenant-sources` | Link a source-system to the tenant |
| **11** | `POST /canonical-entities` | Define canonical data entities (Well, Crew, Task…) |
| **12** | `POST /canonical-fields` | Define fields on each canonical entity |
| **13** | `POST /field-mappings` | Map source-system fields → canonical fields |
| **14** | `POST /capability-profiles` | Define ingestion/transform capabilities per tenant-source |
| **15** | `POST /ingestion-runs` | Trigger or record a data-ingestion execution |
| **16** | `GET /audit-events` | Review the audit trail for all operations |

---

## Dependency Graph (Minimal)

```
Regions ─► Tenants ─► SchemaVersions
                  ├─► TenantFeatures (requires Features)
                  ├─► UserTenantRoles (requires Users + Roles)
                  └─► TenantSources (requires SourceSystems)
                          ├─► CapabilityProfiles
                          └─► FieldMappings (requires CanonicalEntities + CanonicalFields)
                                    └─► IngestionRuns
```

---

## Notes
- All endpoints require **Admin** policy (JWT with admin role).
- Every resource supports full CRUD: `GET /`, `GET /{id}`, `POST`, `PUT /{id}`, `DELETE /{id}`.
- `PUT` returns `204 No Content` on success, `404` if not found.
- `DELETE` returns `204 No Content` on success, `404` if not found.
- `POST` returns `201 Created` with the created resource in the body.
"""
    };

    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "JWT bearer token. Paste the raw token only — Swagger adds the 'Bearer ' prefix."
    });
    o.AddSecurityDefinition("ApiKey", new OpenApiSecurityScheme
    {
        Name = "X-Api-Key",
        Type = SecuritySchemeType.ApiKey,
        In = ParameterLocation.Header,
        Description = "Internal service-to-service API key."
    });
    o.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            },
            Array.Empty<string>()
        },
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "ApiKey" }
            },
            Array.Empty<string>()
        }
    });

    // Include XML documentation comments as endpoint descriptions
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath))
        o.IncludeXmlComments(xmlPath, includeControllerXmlComments: true);
});

// Development-only: relax the Admin policy so Swagger "Try it out" works without a token.
if (builder.Environment.IsDevelopment())
{
    builder.Services.AddAuthorization(o =>
        o.AddPolicy("Admin", p => p.RequireAssertion(_ => true)));
}

var app = builder.Build();

// ── Middleware pipeline ───────────────────────────────────────────────────────
app.UseSerilogRequestLogging(opts =>
{
    opts.EnrichDiagnosticContext = (dc, ctx) =>
    {
        dc.Set("RequestHost", ctx.Request.Host.Value);
        dc.Set("UserAgent", ctx.Request.Headers.UserAgent.ToString());
    };
});
if (!app.Environment.IsDevelopment()) app.UseHsts();
// After CORS (inside UseSmartOpsDefaults) so a 429 still carries CORS headers; endpoints run last, so limits still apply.
app.UseSmartOpsDefaults();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    if (context.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        && context.User.Identity?.IsAuthenticated != true
        && context.GetEndpoint()?.Metadata.GetMetadata<Microsoft.AspNetCore.Authorization.IAllowAnonymous>() is null)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }
    await next(context);
});
app.UseOutputCache();

// ValidationExceptionMiddleware must run after UseSmartOpsDefaults so it
// intercepts FluentValidation exceptions before the shared ExceptionMiddleware.
app.UseMiddleware<TWise.Backend.ControlPlane.API.Middleware.ValidationExceptionMiddleware>();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    ResponseWriter = async (ctx, report) =>
    {
        ctx.Response.ContentType = "application/json";
        var result = new
        {
            status = report.Status.ToString(),
            duration = report.TotalDuration.TotalMilliseconds + "ms",
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                description = e.Value.Description,
                duration = e.Value.Duration.TotalMilliseconds + "ms",
                data = e.Value.Data,
                exception = e.Value.Exception?.Message
            })
        };
        await ctx.Response.WriteAsJsonAsync(result);
    },
    ResultStatusCodes =
    {
        [HealthStatus.Healthy] = StatusCodes.Status200OK,
        [HealthStatus.Degraded] = StatusCodes.Status200OK,
        [HealthStatus.Unhealthy] = StatusCodes.Status503ServiceUnavailable
    }
}).AllowAnonymous();

await app.RunAsync();
