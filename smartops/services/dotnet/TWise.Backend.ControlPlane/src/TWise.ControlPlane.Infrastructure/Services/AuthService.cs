using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Domain.Entities;
using SmartOps.Shared.Auth;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class AuthService(ControlPlaneDbContext db, IJwtTokenService jwt, IAccessService accessService,
    ILoginProtectionService protection, IGenericRepository<AuditEvent> audit, IHttpContextAccessor http) : IAuthService
{
    private const string AdminRole = "admin";
    private const string ViewerRole = "viewer";
    private const string OperatorRole = "operator";

    public async Task<Result<LoginResponse>> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        // 0 — Locked accounts are refused before any password work, so a lock also caps the CPU cost of an attack.
        if (protection.LockedMinutesRemaining(request.Email) is { } minutes)
        {
            await AuditAsync("auth.login.locked", null, request.Email, ct);
            throw new AccountLockedException(minutes);
        }

        // 1 — Find user by email
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.Email == request.Email, ct);

        // 2 — Verify password. Unknown users take the same failure path so the response does not reveal which emails exist.
        if (user is null || string.IsNullOrWhiteSpace(user.PasswordHash) || !PasswordHelper.Verify(request.Password, user.PasswordHash))
        {
            var locked = protection.RecordFailure(request.Email);
            await AuditAsync(locked ? "auth.login.locked" : "auth.login.failed", user?.UserId, request.Email, ct);
            return Result<LoginResponse>.Unauthorized("Invalid email or password.");
        }

        // Correct password on a switched-off account: say so, as before; recorded in the audit log.
        if (!user.IsActive)
        {
            await AuditAsync("auth.login.inactive", user.UserId, request.Email, ct);
            return Result<LoginResponse>.Unauthorized("User is not active. Please contact Administration");
        }

        // 3 — Success: clear the failure count, upgrade an old hash while we still hold the clear-text password, record the login.
        protection.Reset(request.Email);
        if (PasswordHelper.NeedsRehash(user.PasswordHash)) user.PasswordHash = PasswordHelper.Hash(request.Password);
        user.LastLoginAt = DateTime.UtcNow;
        var session = new Domain.Entities.UserSession
        {
            SessionId = Guid.NewGuid(),
            UserId = user.UserId,
            CreatedAt = DateTime.UtcNow
        };
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(ct);
        await AuditAsync("auth.login.success", user.UserId, request.Email, ct);

        return Result<LoginResponse>.Success(await BuildLoginResponseAsync(user, session.SessionId, ct));
    }

    /// <summary>Login outcomes go to the same audit table as access changes, with the caller's address.</summary>
    private Task AuditAsync(string action, long? userId, string email, CancellationToken ct)
    {
        var ip = http.HttpContext?.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return audit.AddAsync(new AuditEvent
        {
            UserId = userId, Action = action, Entity = "AppUser", Detail = $"{email} from {ip}", OccurredAt = DateTime.UtcNow,
        }, ct);
    }

    public async Task<LoginResponse?> RefreshAsync(string refreshToken, CancellationToken ct = default)
    {
        var session = await FindRefreshSessionAsync(refreshToken, ct);
        if (session is null || session.RevokedAt is not null) return null;

        return await BuildLoginResponseAsync(session.User, session.SessionId, ct);
    }

    public async Task<bool> LogoutAsync(string refreshToken, CancellationToken ct = default)
    {
        var session = await FindRefreshSessionAsync(refreshToken, ct);
        if (session is null) return false;

        session.RevokedAt ??= DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<Domain.Entities.UserSession?> FindRefreshSessionAsync(string refreshToken, CancellationToken ct)
    {
        var subject = jwt.ValidateRefreshToken(refreshToken);
        if (subject is null || !long.TryParse(subject, out var userId)) return null;

        var sessionClaim = new JwtSecurityTokenHandler().ReadJwtToken(refreshToken).Claims
            .FirstOrDefault(claim => claim.Type == "sid")?.Value;
        if (!Guid.TryParse(sessionClaim, out var sessionId)) return null;

        var session = await db.UserSessions.Include(candidate => candidate.User)
            .FirstOrDefaultAsync(candidate => candidate.SessionId == sessionId && candidate.UserId == userId, ct);
        if (session is null || !session.User.IsActive) return null;

        var user = session.User;
        if (string.IsNullOrEmpty(user.PasswordHash)
            || jwt.ValidateRefreshToken(refreshToken, jwt.CreateSecurityStamp(user.UserId.ToString(), user.PasswordHash)) is null)
            return null;

        return session;
    }

    private async Task<LoginResponse> BuildLoginResponseAsync(Domain.Entities.AppUser user, Guid sessionId, CancellationToken ct)
    {
        // Every query here is a round trip to the database, which in some environments costs
        // ~200ms each, so the login path is kept to as few queries as possible.

        // 1 — First active UserTenantRole for this user, with its role code in the same query
        var assignments = await db.UserTenantRoles.AsNoTracking()
            .Where(r => r.UserId == user.UserId && r.IsActive)
            .OrderBy(r => r.UserTenantRoleId)
            .Select(r => new
            {
                r.TenantId,
                r.RoleId,
                Role = db.Roles.FirstOrDefault(role => role.RoleId == r.RoleId && role.IsActive
                    && (role.TenantId == null || role.TenantId == r.TenantId))
            })
            .ToListAsync(ct);

        var tenantId = assignments.FirstOrDefault()?.TenantId ?? 0;
        var roles = assignments.Where(assignment => assignment.TenantId == tenantId)
            .Select(assignment => assignment.Role).OfType<Domain.Entities.Role>()
            .Where(role => role.IsActive && !role.IsDeleted).DistinctBy(role => role.RoleId).ToList();

        // 2 — Resolve role code → JWT role string
        var roleCodes = roles.Select(role => role.RoleCode switch
        {
            "platform_admin" or "PlatformAdmin" or "tenant_admin" or "TenantAdmin" or "admin" => AdminRole,
            "operator" => OperatorRole,
            var other => other
        }).ToList();
        var roleCode = roleCodes.Contains(AdminRole) ? AdminRole : roleCodes.FirstOrDefault() ?? ViewerRole;

        // 3 — Resolve effective permissions (role ∩ tenant features)
        var effectivePerms = new List<EffectivePermission>();
        foreach (var role in roles)
            effectivePerms.AddRange(await accessService.GetEffectivePermissionsAsync(role.RoleId, tenantId, ct));
        var permClaims = effectivePerms.GroupBy(permission => permission.ModuleCode)
            .Select(module => new EffectivePermission(module.Key,
                module.Any(permission => permission.CanView), module.Any(permission => permission.CanCreate),
                module.Any(permission => permission.CanModify), module.Any(permission => permission.CanAdmin)))
            .Select(p =>
            {
                var flags = (p.CanView ? "v" : "") + (p.CanCreate ? "c" : "")
                          + (p.CanModify ? "m" : "") + (p.CanAdmin ? "a" : "");
                return $"{p.ModuleCode}:{flags}";
            })
            .ToList();

        // 3b — Assigned plants (Plant Access) so the frontend can scope the plant/cluster
        // filter. The tenant came from the user's own role row, so no membership check is needed.
        var plantCodes = roles.Count == 0 ? null : await db.UserPlantAccesses.AsNoTracking()
            .Where(p => p.UserId == user.UserId && p.IsActive)
            .Select(p => p.PlantCode)
            .ToListAsync(ct);

        // 4 — Issue access + refresh tokens
        var securityStamp = jwt.CreateSecurityStamp(user.UserId.ToString(), user.PasswordHash!);
        var token = jwt.Issue(new JwtAccessTokenRequest
        {
            Subject = user.UserId.ToString(),
            Email = user.Email,
            Role = roleCode,
            FullName = user.DisplayName ?? user.Email,
            TenantId = tenantId,
            Permissions = permClaims,
            PlantCodes = plantCodes,
            SecurityStamp = securityStamp,
            SessionId = sessionId.ToString()
        });

        var refresh = jwt.IssueRefreshToken(user.UserId.ToString(), securityStamp, sessionId.ToString());

        return new LoginResponse(token, refresh, user.UserId, user.Email, user.DisplayName, roleCode, tenantId);
    }
}
