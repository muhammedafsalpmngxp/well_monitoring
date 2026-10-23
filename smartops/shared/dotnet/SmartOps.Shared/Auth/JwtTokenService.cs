using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace SmartOps.Shared.Auth;

public sealed record JwtAccessTokenRequest
{
    public required string Subject { get; init; }
    public required string Email { get; init; }
    public required string Role { get; init; }
    public required string FullName { get; init; }
    public long TenantId { get; init; }
    public IEnumerable<string> Permissions { get; init; } = [];
    public IEnumerable<int>? PlantCodes { get; init; }
    public string? SecurityStamp { get; init; }
    public string? SessionId { get; init; }
}

public interface IJwtTokenService
{
    string Issue(string subject, string email, string role, string fullName, long tenantId = 0);
    string Issue(string subject, string email, string role, string fullName, long tenantId, IEnumerable<string> permissions, IEnumerable<int>? plantCodes = null, string? securityStamp = null);
    string Issue(JwtAccessTokenRequest request);
    string IssueRefreshToken(string subject, string? securityStamp = null);
    string IssueRefreshToken(string subject, string? securityStamp, string? sessionId);
    string? ValidateRefreshToken(string refreshToken, string? securityStamp = null);
    string CreateSecurityStamp(string subject, string passwordHash);
}

public sealed class JwtTokenService(IOptions<JwtSettings> options) : IJwtTokenService
{
    private readonly JwtSettings _s = options.Value;

    public string Issue(string subject, string email, string role, string fullName, long tenantId = 0)
        => Issue(subject, email, role, fullName, tenantId, []);

    public string Issue(string subject, string email, string role, string fullName, long tenantId, IEnumerable<string> permissions, IEnumerable<int>? plantCodes = null, string? securityStamp = null)
        => Issue(new JwtAccessTokenRequest
        {
            Subject = subject,
            Email = email,
            Role = role,
            FullName = fullName,
            TenantId = tenantId,
            Permissions = permissions,
            PlantCodes = plantCodes,
            SecurityStamp = securityStamp
        });

    public string Issue(JwtAccessTokenRequest request)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_s.SecretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var now = DateTime.UtcNow;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, request.Subject),
            new("token_type", "access"),
            new(JwtRegisteredClaimNames.Email, request.Email),
            new("name", request.FullName),
            new(ClaimTypes.Role, request.Role),
            new("tenantId", request.TenantId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(JwtRegisteredClaimNames.Iat, EpochTime.GetIntDate(now).ToString(), ClaimValueTypes.Integer64)
        };

        if (request.SecurityStamp is not null)
            claims.Add(new Claim("security_stamp", request.SecurityStamp));

        if (request.SessionId is not null)
            claims.Add(new Claim("sid", request.SessionId));

        foreach (var perm in request.Permissions)
            claims.Add(new Claim("perm", perm));

        if (request.PlantCodes is not null)
            foreach (var plantCode in request.PlantCodes)
                claims.Add(new Claim("plant", plantCode.ToString()));

        var token = new JwtSecurityToken(
            issuer: _s.Issuer,
            audience: _s.Audience,
            claims: claims,
            notBefore: now,
            expires: now.AddMinutes(_s.ExpiryMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateSecurityStamp(string subject, string passwordHash)
        => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(_s.SecretKey),
            Encoding.UTF8.GetBytes($"{subject}:{passwordHash}")));

    public string IssueRefreshToken(string subject, string? securityStamp = null)
        => IssueRefreshToken(subject, securityStamp, null);

    public string IssueRefreshToken(string subject, string? securityStamp, string? sessionId)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_s.SecretKey));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var now = DateTime.UtcNow;

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, subject),
            new("token_type", "refresh"),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(JwtRegisteredClaimNames.Iat, EpochTime.GetIntDate(now).ToString(), ClaimValueTypes.Integer64)
        };

        if (securityStamp is not null)
            claims.Add(new Claim("security_stamp", securityStamp));

        if (sessionId is not null)
            claims.Add(new Claim("sid", sessionId));

        var token = new JwtSecurityToken(
            issuer: _s.Issuer,
            audience: _s.Audience,
            claims: claims,
            notBefore: now,
            expires: now.AddMinutes(_s.RefreshExpiryMinutes),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>Validates a refresh token and returns its subject (user id), or null if invalid.</summary>
    public string? ValidateRefreshToken(string refreshToken, string? securityStamp = null)
    {
        if (string.IsNullOrWhiteSpace(refreshToken)) return null;

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_s.SecretKey));
        var parameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = _s.Issuer,
            ValidAudience = _s.Audience,
            IssuerSigningKey = key,
            ClockSkew = TimeSpan.FromSeconds(30)
        };

        try
        {
            var principal = new JwtSecurityTokenHandler()
                .ValidateToken(refreshToken, parameters, out _);
            if (principal.FindFirst("token_type")?.Value != "refresh") return null;
            if (securityStamp is not null && principal.FindFirst("security_stamp")?.Value != securityStamp)
                return null;
            return principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
                ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        }
        catch
        {
            return null;
        }
    }
}
