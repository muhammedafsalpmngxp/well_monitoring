using MediatR;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Categories;

// ─── Queries ─────────────────────────────────────────────────────────────────

public record GetCategoriesQuery(string? ControlType = null) : IRequest<Result<IReadOnlyList<CategoryDropdownResponse>>>;

// ─── Commands ────────────────────────────────────────────────────────────────

public record CreateCategoryCommand(SaveCategoryRequest Request) : IRequest<Result<CategoryResponse>>;

public record UpdateCategoryCommand(int CategoryId, SaveCategoryRequest Request) : IRequest<Result<CategoryResponse>>;

public record DeleteCategoryCommand(int CategoryId) : IRequest<Result>;
