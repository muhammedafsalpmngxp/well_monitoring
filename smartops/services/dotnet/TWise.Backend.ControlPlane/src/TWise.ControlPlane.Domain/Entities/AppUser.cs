namespace TWise.Backend.ControlPlane.Domain.Entities;

public class AppUser : IControlAudited, ISoftDeletable
{
    public long UserId { get; set; }
    public string Email { get; set; } = default!;
    public string? DisplayName { get; set; }
    public string? EmployeeId { get; set; }
    public bool IsSso { get; set; }
    public string? Status { get; set; }
    public bool IsActive { get; set; } = true;
    public string? PasswordHash { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
