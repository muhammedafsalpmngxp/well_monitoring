using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Features.CrewAssignments;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

[Route("api/crew-assignments")]
[Authorize]
public class CrewAssignmentController(IMediator mediator) : BaseApiController
{
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCrewAssignmentRequest request, CancellationToken ct)
    {
        var result = await mediator.Send(new CreateCrewAssignmentCommand(request), ct);
        return ToActionResult(result, StatusCodes.Status201Created);
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var result = await mediator.Send(new DeleteCrewAssignmentCommand(id), ct);
        return ToVoidActionResult(result);
    }
}
