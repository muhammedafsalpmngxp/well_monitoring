using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SmartOps.Auth.Domain.Dtos;
using SmartOps.Auth.Domain.Entities;
using SmartOps.Auth.Infrastructure;
using SmartOps.Shared.Auth;

namespace SmartOps.Auth.Services;

public interface IUserService
{
    Task<TokenResponse?> LoginAsync(LoginRequest request);
    Task<UserDto?> GetByIdAsync(int id);
    Task<List<UserDto>> ListAsync();
    Task<UserDto> CreateAsync(UserCreateRequest request);
    Task<UserDto?> UpdateAsync(int id, UserUpdateRequest request);
    Task<List<RoleDto>> ListRolesAsync();
    Task<RoleDto> UpsertRoleAsync(RoleUpsertRequest request);
}

public sealed class UserService(AuthDbContext db, IJwtTokenService jwt) : IUserService
{
    public async Task<TokenResponse?> LoginAsync(LoginRequest request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == request.Email && u.IsActive);
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return null;

        var token = jwt.Issue(user.Id.ToString(), user.Email, user.Role, user.FullName);

        user.LastLoginAt = DateTime.UtcNow;
        db.AuditLogs.Add(new AuditLog
        {
            Actor = user.Email, Action = "login", Resource = "auth"
        });
        await db.SaveChangesAsync();

        return new TokenResponse(token, "bearer", ToDto(user));
    }

    public async Task<UserDto?> GetByIdAsync(int id)
        => await db.Users.Where(u => u.Id == id)
             .Select(u => new UserDto(u.Id, u.Email, u.FullName, u.Role, u.IsActive))
             .FirstOrDefaultAsync();

    public async Task<List<UserDto>> ListAsync()
        => await db.Users
             .Select(u => new UserDto(u.Id, u.Email, u.FullName, u.Role, u.IsActive))
             .ToListAsync();

    public async Task<UserDto> CreateAsync(UserCreateRequest request)
    {
        if (await db.Users.AnyAsync(u => u.Email == request.Email))
            throw new ArgumentException("Email already registered");

        var user = new AppUser
        {
            Email = request.Email,
            FullName = request.FullName,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = request.Role,
            IsActive = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return ToDto(user);
    }

    public async Task<UserDto?> UpdateAsync(int id, UserUpdateRequest request)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return null;

        if (request.FullName is not null) user.FullName = request.FullName;
        if (request.Role is not null) user.Role = request.Role;
        if (request.IsActive is not null) user.IsActive = request.IsActive.Value;

        await db.SaveChangesAsync();
        return ToDto(user);
    }

    public async Task<List<RoleDto>> ListRolesAsync()
    {
        var rows = await db.Roles
            .Select(r => new { r.Id, r.Name, r.Description, r.Permissions })
            .ToListAsync();
        return rows
            .Select(r => new RoleDto(r.Id, r.Name, r.Description,
                JsonSerializer.Deserialize<List<string>>(r.Permissions, (JsonSerializerOptions?)null) ?? new()))
            .ToList();
    }

    public async Task<RoleDto> UpsertRoleAsync(RoleUpsertRequest request)
    {
        var role = await db.Roles.FirstOrDefaultAsync(r => r.Name == request.Name);
        var permsJson = JsonSerializer.Serialize(request.Permissions);
        if (role is null)
        {
            role = new AppRole
            {
                Name = request.Name, Description = request.Description, Permissions = permsJson
            };
            db.Roles.Add(role);
        }
        else
        {
            role.Description = request.Description;
            role.Permissions = permsJson;
        }
        await db.SaveChangesAsync();
        return new RoleDto(role.Id, role.Name, role.Description, request.Permissions);
    }

    private static UserDto ToDto(AppUser u) =>
        new(u.Id, u.Email, u.FullName, u.Role, u.IsActive);
}
