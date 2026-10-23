using System.ComponentModel.DataAnnotations;

namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record AppUserDto(long UserId, string Email, string? EmployeeId, string? DisplayName, bool IsSso, string? Status, bool IsActive);
public record UserRoleDto(int RoleId, string RoleCode, string? RoleName);
public record TenantUserDto(long UserId, string Email, string? DisplayName, string? EmployeeId, string? Status, bool IsActive, string RoleCode, string? RoleName, List<int> PlantCodes, DateTime? LastLoginAt, List<int>? RoleIds = null, List<UserRoleDto>? Roles = null);
public record AppUserCreateRequest(string Email, string? DisplayName, bool IsSso, string? Status, bool IsActive = true, string? Password = null);
public record AppUserUpdateRequest(string Email, string? DisplayName, string? Status, bool IsActive = true);
public record UpdateUserWithAccessRequest(string Email, string? DisplayName, string? EmployeeId, string? Status, bool IsActive, List<int> PlantCodes, List<int>? RoleIds = null);
public record UpdateUserPlantAccessRequest(List<int> PlantCodes);
public record UserDuplicateCheckResponse(bool EmailExists, bool EmployeeIdExists);
public record CreateUserWithAccessRequest(
    string Email,
    string? DisplayName,
    string? EmployeeId,
    string? Password,
    string? Status,
    bool IsActive,
    long TenantId,
    int RoleId,
    List<int> PlantCodes,
    List<int>? RoleIds = null);
public record CreateUserWithAccessResponse(long UserId, string Email, string? DisplayName, string? EmployeeId, string Role, List<int> PlantCodes);
public record ResetPasswordResponse(long UserId, string Email, string TemporaryPassword);
public record LoginRequest(string Email, string Password);
public record RefreshRequest(string RefreshToken);
/// <summary>Revokes the login session identified by a signed refresh token.</summary>
public sealed record LogoutRequest([Required, MaxLength(4096)] string RefreshToken);
/// <summary>Returns session tokens and the user profile, including the nullable employee ID, for login and refresh.</summary>
public sealed record LoginResponse(string Token, string RefreshToken, long UserId, string Email, string? DisplayName, string Role, long TenantId, string? EmployeeId = null);
