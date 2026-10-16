using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.DataSources;
using TWise.Tenant.Domain.DTOs;

using TWise.Tenant.API.Auth;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Pull-based external data sources: Google Sheets, Google Drive and REST APIs.
///
/// These sources cannot answer live SQL, so they are fetched on demand and materialised into
/// an ImportedDataset via POST {id}/ingest. The resulting dataset is then usable as a chart or
/// tile source exactly like an uploaded file.
///
/// For live SQL sources (SQL Server, PostgreSQL, MySQL) use /api/database-connections instead.
/// </summary>
[ApiController]
[Authorize]
[Route("api/data-sources")]
public sealed class DataSourceController(ISender sender) : ControllerBase
{
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>Connector kinds, auth types and per-kind config fields for the "add data source" form.</summary>
    [HttpGet("options")]
    [ProducesResponseType(typeof(DataSourceOptionsResponse), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOptions(CancellationToken ct)
        => Ok(await sender.Send(new GetDataSourceOptionsQuery(), ct));

    /// <summary>List all data sources for the current tenant.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<DataSourceConnectionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListDataSourcesQuery(tenantId), ct));
    }

    /// <summary>Get a single data source. Credentials are never returned.</summary>
    [HttpGet("{id:long}")]
    [ProducesResponseType(typeof(DataSourceConnectionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetById(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new GetDataSourceQuery(id, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Create a data source. Any values in Credentials are encrypted before storage.</summary>
    [HttpPost]
    [RequireModulePermission("settings.data-sources", 'c')]
    [ProducesResponseType(typeof(DataSourceConnectionDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Create([FromBody] CreateDataSourceConnectionRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var created = await sender.Send(new CreateDataSourceCommand(request, userId, tenantId), ct);
            return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (NotSupportedException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Update a data source. Omit Credentials to keep the stored secrets unchanged.</summary>
    [HttpPut("{id:long}")]
    [RequireModulePermission("settings.data-sources", 'm')]
    [ProducesResponseType(typeof(DataSourceConnectionDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateDataSourceConnectionRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var result = await sender.Send(new UpdateDataSourceCommand(id, request, userId, tenantId), ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (NotSupportedException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Soft-delete a data source. Datasets already ingested from it are kept.</summary>
    [HttpDelete("{id:long}")]
    [RequireModulePermission("settings.data-sources", 'm')]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return await sender.Send(new DeleteDataSourceCommand(id, tenantId), ct) ? NoContent() : NotFound();
    }

    /// <summary>
    /// Verify credentials and reachability without ingesting. The outcome is recorded on the
    /// connection, so a failure returns 200 with Success=false rather than an error status.
    /// </summary>
    [HttpPost("{id:long}/test")]
    [RequireModulePermission("settings.data-sources", 'm')]
    [ProducesResponseType(typeof(DataSourceTestResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Test(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        var result = await sender.Send(new TestDataSourceCommand(id, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>List fetchable objects — spreadsheet tabs, Drive files, or the REST endpoint.</summary>
    [HttpGet("{id:long}/objects")]
    [ProducesResponseType(typeof(IReadOnlyList<DataSourceObjectDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ListObjects(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var result = await sender.Send(new ListDataSourceObjectsQuery(id, tenantId), ct);
            return result is null ? NotFound() : Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Fetch an object and store it as an ImportedDataset, returning the dataset. Use the
    /// dataset's id as a chart or tile source (SourceType = "Import").
    /// </summary>
    [HttpPost("{id:long}/ingest")]
    [RequireModulePermission("settings.data-sources", 'c')]
    [ProducesResponseType(typeof(ImportedDatasetDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Ingest(long id, [FromBody] IngestDataSourceRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        try
        {
            var result = await sender.Send(new IngestDataSourceCommand(id, request, userId, tenantId), ct);
            return result is null ? NotFound() : StatusCode(StatusCodes.Status201Created, result);
        }
        catch (InvalidOperationException ex)
        {
            // Row-limit breaches, bad config and unreachable endpoints are all user-fixable.
            return BadRequest(new { error = ex.Message });
        }
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
