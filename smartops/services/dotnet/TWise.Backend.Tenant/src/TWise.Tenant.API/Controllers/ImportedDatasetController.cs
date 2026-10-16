using System.IdentityModel.Tokens.Jwt;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.ImportedDatasets;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Imports CSV/XLSX/XLS/JSON files as chart data sources (max 8MB, 10,000 rows per file).
/// Parsed data is stored in core.ImportedDatasets/ImportedDataRows for later use as a
/// Widget source, alongside the existing Table/View sources.
/// </summary>
[ApiController]
// [Authorize]
[Route("api/imports")]
public sealed class ImportedDatasetController(ISender sender) : ControllerBase
{
    private const long MaxFileSizeBytes = 8 * 1024 * 1024; // 8 MB
    private const string TenantIdMissing = "TenantId not found in token.";

    /// <summary>List all imported datasets for the current user.</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return Ok(await sender.Send(new ListImportedDatasetsQuery(tenantId, userId), ct));
    }

    /// <summary>Get metadata (columns, row count, status) for a single imported dataset.</summary>
    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetById(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var result = await sender.Send(new GetImportedDatasetByIdQuery(id, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Get the parsed data rows for a dataset (used to render chart preview/data).</summary>
    [HttpGet("{id:long}/data")]
    public async Task<IActionResult> GetData(long id, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        var result = await sender.Send(new GetImportedDatasetDataQuery(id, tenantId), ct);
        return result is null ? NotFound() : Ok(result);
    }

    /// <summary>Upload and parse a CSV/XLSX/XLS/JSON file into a reusable chart data source.</summary>
    [HttpPost]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxFileSizeBytes)]
    public async Task<IActionResult> Import([FromForm] IFormFile file, [FromForm] string? datasetName, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);

        if (file is null || file.Length == 0) return BadRequest(new { error = "No file uploaded." });
        if (file.Length > MaxFileSizeBytes) return BadRequest(new { error = $"File exceeds the {MaxFileSizeBytes / (1024 * 1024)}MB limit." });

        try
        {
            await using var stream = file.OpenReadStream();
            var created = await sender.Send(new ImportDatasetCommand(stream, file.FileName, datasetName, userId, tenantId), ct);
            return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (NotSupportedException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Soft-delete an imported dataset.</summary>
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized(TenantIdMissing);
        return await sender.Send(new DeleteImportedDatasetCommand(id, userId, tenantId), ct) ? NoContent() : NotFound();
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
