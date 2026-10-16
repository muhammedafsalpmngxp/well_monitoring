using System.ComponentModel.DataAnnotations;

namespace SmartOps.Auth.Domain.Dtos;

public record LoginRequest([Required, EmailAddress] string Email,
                           [Required, MinLength(6)] string Password);

public record TokenResponse(string AccessToken, string TokenType, UserDto User);

public record UserDto(int Id, string Email, string FullName, string Role, bool IsActive);

public record UserCreateRequest(
    [Required, EmailAddress] string Email,
    [Required, MinLength(6)] string Password,
    [Required] string FullName,
    string Role = "viewer");

public record UserUpdateRequest(string? FullName, string? Role, bool? IsActive);

public record RoleDto(int Id, string Name, string? Description, IReadOnlyList<string> Permissions);

public record RoleUpsertRequest(
    [Required] string Name,
    string? Description,
    IReadOnlyList<string> Permissions);
