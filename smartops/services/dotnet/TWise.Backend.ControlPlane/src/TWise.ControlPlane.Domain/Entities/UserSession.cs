namespace TWise.Backend.ControlPlane.Domain.Entities;

public sealed class UserSession
{
    public Guid SessionId { get; set; }
    public long UserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public AppUser User { get; set; } = null!;
}