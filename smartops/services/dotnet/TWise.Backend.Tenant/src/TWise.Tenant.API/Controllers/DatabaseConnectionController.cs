using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.DatabaseConnections;
using TWise.Tenant.Domain.DTOs;

using TWise.Tenant.API.Auth;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Manages external database connections for a tenant.
/// Credentials are stored with hashed passwords (PBKDF2-SHA256).
/// </summary>
[ApiController]
// [Authorize]
[Route("api/database-connections")]
public sealed class DatabaseConnectionController(ISender sender) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>List all database connections for the current tenant.</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListDatabaseConnectionsQuery(tenantId), cancellationToken));
    }

    /// <summary>Get a single database connection by ID.</summary>
    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetById(long id, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var result = await sender.Send(new GetDatabaseConnectionQuery(id, tenantId), cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Create a new database connection. Password will be hashed before storage.</summary>
    [HttpPost]
    [RequireModulePermission("settings.data-sources", 'c')]
    public async Task<IActionResult> Create([FromBody] CreateDatabaseConnectionRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var created = await sender.Send(new CreateDatabaseConnectionCommand(request, userId, tenantId), cancellationToken);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    /// <summary>Update a database connection. Password is optional — only re-hashed if provided.</summary>
    [HttpPut("{id:long}")]
    [RequireModulePermission("settings.data-sources", 'm')]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateDatabaseConnectionRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new UpdateDatabaseConnectionCommand(id, request, userId, tenantId), cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Soft-delete a database connection.</summary>
    [HttpDelete("{id:long}")]
    [RequireModulePermission("settings.data-sources", 'm')]
    public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return await sender.Send(new DeleteDatabaseConnectionCommand(id, tenantId), cancellationToken) ? NoContent() : NotFound();
    }

    /// <summary>
    /// Get the persisted schema (tables, columns, data types, PKs, FKs) of a saved database connection.
    /// Returns cached data — call POST sync to refresh.
    /// </summary>
    [HttpGet("{id:long}/schema")]
    public async Task<IActionResult> GetSchema(long id, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var result = await sender.Send(new GetDatabaseSchemaQuery(id, tenantId), cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>
    /// Sync (re-discover) the remote database schema and persist tables/columns locally.
    /// Call this after creating a connection or when the remote schema changes.
    /// </summary>
    [HttpPost("{id:long}/schema/sync")]
    [RequireModulePermission("settings.data-sources", 'm')]
    public async Task<IActionResult> SyncSchema(long id, CancellationToken cancellationToken)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var result = await sender.Send(new SyncDatabaseSchemaCommand(id, tenantId), cancellationToken);
        return result is null ? NotFound() : Ok(result);
    }

    private bool TryGetUserId(out long userId)
    {
        userId = 0;
        var sub = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value
               ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        return sub is not null && long.TryParse(sub, out userId);
    }

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
