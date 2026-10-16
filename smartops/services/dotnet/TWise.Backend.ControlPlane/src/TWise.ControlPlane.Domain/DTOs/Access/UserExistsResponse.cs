namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record UserExistsResponse(bool Exists, long? UserId, long? TenantId, string? Email);
