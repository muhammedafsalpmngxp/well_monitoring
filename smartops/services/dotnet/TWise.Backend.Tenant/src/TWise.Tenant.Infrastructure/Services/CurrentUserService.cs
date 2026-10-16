using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Delivery;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Extracts the current user's identity from the HTTP context JWT claims.
/// In Development, falls back to X-User-Id / X-User-Role headers for Swagger testing.
/// Inside a RunAsScope (a scheduled delivery) the run-as user is returned instead.
/// </summary>
public class CurrentUserService(IHttpContextAccessor httpContextAccessor) : ICurrentUserService
{
    private static readonly bool IsDevelopment =
        string.Equals(Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"), "Development", StringComparison.OrdinalIgnoreCase);

    public string? UserId
    {
        get
        {
            if (RunAsScope.User is { } runAs) return runAs.UserId.ToString();
            var context = httpContextAccessor.HttpContext;
            var user = context?.User;

            if (user?.Identity?.IsAuthenticated == true)
            {
                return user.FindFirst(ClaimTypes.NameIdentifier)?.Value
                    ?? user.FindFirst("sub")?.Value
                    ?? user.FindFirst("uid")?.Value
                    ?? user.FindFirst(ClaimTypes.Email)?.Value;
            }

            // Dev-only fallback: read from custom headers for Swagger testing
            if (IsDevelopment && context is not null)
                return context.Request.Headers["X-User-Id"].FirstOrDefault();

            return null;
        }
    }

    public string? Role
    {
        get
        {
            if (RunAsScope.User is { } runAs) return RunAsScope.Roles(runAs).Contains("admin") ? "admin" : runAs.RoleCodes.FirstOrDefault();
            var context = httpContextAccessor.HttpContext;
            var user = context?.User;

            if (user?.Identity?.IsAuthenticated == true)
            {
                return user.FindFirst(ClaimTypes.Role)?.Value
                    ?? user.FindFirst("role")?.Value;
            }

            // Dev-only fallback: read from custom headers for Swagger testing
            if (IsDevelopment && context is not null)
                return context.Request.Headers["X-User-Role"].FirstOrDefault();

            return null;
        }
    }

    public IReadOnlyList<string> Roles
    {
        get
        {
            if (RunAsScope.User is { } runAs) return RunAsScope.Roles(runAs);
            var context = httpContextAccessor.HttpContext;
            var user = context?.User;

            if (user?.Identity?.IsAuthenticated == true)
            {
                var roles = user.FindAll(ClaimTypes.Role)
                    .Concat(user.FindAll("role"))
                    .Select(c => c.Value)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                if (roles.Count > 0) return roles;
            }

            // Dev-only fallback
            if (IsDevelopment && context is not null)
            {
                var header = context.Request.Headers["X-User-Role"].FirstOrDefault();
                if (!string.IsNullOrEmpty(header))
                    return header.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            }

            return [];
        }
    }

    public IReadOnlyList<int> PlantCodes
    {
        get
        {
            if (RunAsScope.User is { } runAs) return runAs.PlantCodes;
            var user = httpContextAccessor.HttpContext?.User;
            if (user?.Identity?.IsAuthenticated != true) return [];

            return user.FindAll("plant")
                .Select(c => int.TryParse(c.Value, out var code) ? code : (int?)null)
                .Where(code => code.HasValue)
                .Select(code => code!.Value)
                .ToList();
        }
    }
}
