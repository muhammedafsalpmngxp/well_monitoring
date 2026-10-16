using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Runs a query against a dataset. The request names fields and measures; the server compiles
/// the SQL, applies row-level security and returns rows. Refusals come back as 422 with a
/// stable code and a plain-language message, never SQL error text. The caller needs view on
/// model.studio or on dashboard.canvas.
/// </summary>
[ApiController]
[Authorize]
[Route("api/query")]
public sealed class ModelQueryController(ISender sender) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType(typeof(QueryResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public async Task<IActionResult> Run([FromBody] QueryRequest request, CancellationToken cancellationToken)
    {
        var claim = User.FindFirst("tenantId")?.Value;
        if (!long.TryParse(claim, out var tenantId) || tenantId <= 0)
            return Unauthorized("TenantId not found in token.");

        if (!ModulePermission.CanReadModel(User))
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                code = "forbidden",
                message = "You do not have permission to see data model results. Ask an administrator for access to canvases or Model Studio.",
            });

        try
        {
            return Ok(await sender.Send(new RunModelQueryCommand(request, tenantId), cancellationToken));
        }
        catch (QueryException ex)
        {
            return UnprocessableEntity(new { code = ex.Code, message = ex.Message });
        }
    }
}
