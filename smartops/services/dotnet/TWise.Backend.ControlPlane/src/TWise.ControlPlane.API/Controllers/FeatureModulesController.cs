using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OutputCaching;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>Step 8 — Feature Module tree for RBAC</summary>
[ApiController]
[Authorize(Policy = "Admin")]
[Route("feature-modules")]
[Tags("08. Feature Modules")]
public sealed class FeatureModulesController(ISender sender) : ControllerBase
{
    /// <summary>List all modules as a nested tree</summary>
    [HttpGet]
    [OutputCache(PolicyName = "ControlPlaneList")]
    [ProducesResponseType(typeof(List<ModuleTreeNode>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ListTree(CancellationToken ct)
    {
        var result = await sender.Send(new ListModuleTreeQuery(), ct);
        return result.IsSuccess ? Ok(result.Value) : StatusCode(500);
    }

    /// <summary>Get a module by ID</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ModuleDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await sender.Send(new GetModuleQuery(id), ct);
        return result.IsSuccess ? Ok(result.Value) : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Register a new module node</summary>
    [HttpPost]
    [ProducesResponseType(typeof(ModuleDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> Create([FromBody] ModuleCreateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new CreateModuleCommand(request), ct);
        return result.IsSuccess ? Created(string.Empty, result.Value) : StatusCode(500);
    }

    /// <summary>Update a module node</summary>
    [HttpPut("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Update(int id, [FromBody] ModuleUpdateRequest request, CancellationToken ct)
    {
        var result = await sender.Send(new UpdateModuleCommand(id, request), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }

    /// <summary>Delete a module node</summary>
    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var result = await sender.Send(new DeleteModuleCommand(id), ct);
        return result.IsSuccess ? NoContent() : NotFound(new { message = result.ErrorMessage });
    }
}
