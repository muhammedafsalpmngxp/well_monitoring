namespace SmartOps.Shared.Auth;

public sealed class JwtSettings
{
    public string SecretKey { get; set; } = string.Empty;
    public string Issuer { get; set; } = "smartops.auth";
    public string Audience { get; set; } = "smartops.api";
    public int ExpiryMinutes { get; set; } = 480;
    public int RefreshExpiryMinutes { get; set; } = 10080; // 7 days
}
