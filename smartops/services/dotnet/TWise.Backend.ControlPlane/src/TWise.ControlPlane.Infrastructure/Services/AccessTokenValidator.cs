using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SmartOps.Shared.Auth;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class AccessTokenValidator(ControlPlaneDbContext db, IJwtTokenService jwt) : IAccessTokenValidator
{
    public async Task<bool> ValidateAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var subject = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? principal.FindFirst("sub")?.Value;
        var stamp = principal.FindFirst("security_stamp")?.Value;
        var sessionClaim = principal.FindFirst("sid")?.Value ?? principal.FindFirst(ClaimTypes.Sid)?.Value;
        if (!long.TryParse(subject, out var userId) || string.IsNullOrEmpty(stamp)
            || !Guid.TryParse(sessionClaim, out var sessionId)) return false;

        var passwordHash = await db.UserSessions.AsNoTracking()
            .Where(session => session.SessionId == sessionId && session.UserId == userId
                && session.RevokedAt == null && session.User.IsActive)
            .Select(session => session.User.PasswordHash)
            .FirstOrDefaultAsync(ct);
        return passwordHash is not null && stamp == jwt.CreateSecurityStamp(userId.ToString(), passwordHash);
    }
}