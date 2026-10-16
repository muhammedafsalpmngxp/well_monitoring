using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Features.Categories;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

[Route("api/[controller]")]
// [Authorize]
public class CategoryController(IMediator mediator) : BaseApiController
{
    /// <summary>
    /// Get all active categories.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetCategories([FromQuery] string? controlType, CancellationToken ct)
    {
        var result = await mediator.Send(new GetCategoriesQuery(controlType), ct);
        return ToActionResult(result);
    }

    [HttpGet("manage")]
    [TypeFilter(typeof(CategoryPermissionFilter))]
    public async Task<IActionResult> GetManagedCategories([FromQuery] string controlType, CancellationToken ct)
    {
        var result = await mediator.Send(new GetCategoriesQuery(controlType), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Create a new category.
    /// </summary>
    [HttpPost]
    [TypeFilter(typeof(CategoryPermissionFilter))]
    public async Task<IActionResult> CreateCategory([FromBody] SaveCategoryRequest request, CancellationToken ct)
    {
        var result = await mediator.Send(new CreateCategoryCommand(request), ct);
        return ToActionResult(result, StatusCodes.Status201Created);
    }

    /// <summary>
    /// Update an existing category.
    /// </summary>
    [HttpPut("{categoryId}")]
    [TypeFilter(typeof(CategoryPermissionFilter))]
    public async Task<IActionResult> UpdateCategory(int categoryId, [FromBody] SaveCategoryRequest request, CancellationToken ct)
    {
        var result = await mediator.Send(new UpdateCategoryCommand(categoryId, request), ct);
        return ToActionResult(result);
    }

    /// <summary>
    /// Soft delete a category.
    /// </summary>
    [HttpDelete("{categoryId}")]
    [TypeFilter(typeof(CategoryPermissionFilter))]
    public async Task<IActionResult> DeleteCategory(int categoryId, CancellationToken ct)
    {
        var result = await mediator.Send(new DeleteCategoryCommand(categoryId), ct);
        return ToVoidActionResult(result);
    }
}
