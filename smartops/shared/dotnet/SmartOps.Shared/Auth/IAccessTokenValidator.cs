using System.Security.Claims;

namespace SmartOps.Shared.Auth;

public interface IAccessTokenValidator
{
    Task<bool> ValidateAsync(ClaimsPrincipal principal, CancellationToken ct);
}