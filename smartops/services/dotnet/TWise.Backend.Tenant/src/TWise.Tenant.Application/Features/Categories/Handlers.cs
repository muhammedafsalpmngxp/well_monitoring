using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.Categories;

// ─── Get Categories ──────────────────────────────────────────────────────────

public sealed class GetCategoriesHandler(
    ICategoryRepository repo,
    ICurrentUserService currentUser,
    ILogger<GetCategoriesHandler> logger) : IRequestHandler<GetCategoriesQuery, Result<IReadOnlyList<CategoryDropdownResponse>>>
{
    public async Task<Result<IReadOnlyList<CategoryDropdownResponse>>> Handle(GetCategoriesQuery request, CancellationToken ct)
    {
        logger.LogInformation("Fetching categories. ControlType={ControlType}", request.ControlType);
        var categories = await repo.GetAllAsync(request.ControlType, currentUser.UserId, ct);

        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        var countsByControlType = new Dictionary<string, IReadOnlyDictionary<int, int>>(StringComparer.OrdinalIgnoreCase);
        foreach (var controlType in categories.Select(c => c.ControlType).Distinct(StringComparer.OrdinalIgnoreCase))
            countsByControlType[controlType] = await repo.GetItemCountsByCategoryAsync(controlType, currentUser.UserId, isAdmin, ct);

        var result = categories.Select(c => new CategoryDropdownResponse
        {
            CategoryId = c.CategoryId,
            CategoryName = c.CategoryName,
            Description = c.Description,
            ControlType = c.ControlType,
            ItemCount = countsByControlType[c.ControlType].GetValueOrDefault(c.CategoryId)
        }).ToList();
        return Result<IReadOnlyList<CategoryDropdownResponse>>.Success(result);
    }
}

// ─── Create Category ─────────────────────────────────────────────────────────

public sealed class CreateCategoryHandler(
    ICategoryRepository repo,
    ICurrentUserService currentUser,
    ILogger<CreateCategoryHandler> logger) : IRequestHandler<CreateCategoryCommand, Result<CategoryResponse>>
{
    public async Task<Result<CategoryResponse>> Handle(CreateCategoryCommand cmd, CancellationToken ct)
    {
        var request = cmd.Request;
        logger.LogInformation("Creating category. Name={Name}", request.CategoryName);

        var exists = await repo.ExistsByNameAsync(request.CategoryName.Trim(), request.ControlType, ct, createdBy: currentUser.UserId);
        if (exists)
            return Result<CategoryResponse>.Conflict($"Category '{request.CategoryName.Trim()}' already exists.");

        var userId = currentUser.UserId ?? "system";
        var category = new Category
        {
            CategoryName = request.CategoryName.Trim(),
            Description = request.Description?.Trim(),
            ControlType = request.ControlType,
            CreatedBy = userId,
            ModifiedBy = userId
        };

        await repo.CreateAsync(category, ct);
        logger.LogInformation("Category created. CategoryId={CategoryId}", category.CategoryId);

        return Result<CategoryResponse>.Success(new CategoryResponse
        {
            CategoryId = category.CategoryId,
            CategoryName = category.CategoryName,
            Description = category.Description,
            ControlType = category.ControlType,
            Message = $"Category '{category.CategoryName}' has been created successfully."
        });
    }
}

// ─── Update Category ─────────────────────────────────────────────────────────

public sealed class UpdateCategoryHandler(
    ICategoryRepository repo,
    ICurrentUserService currentUser,
    ILogger<UpdateCategoryHandler> logger) : IRequestHandler<UpdateCategoryCommand, Result<CategoryResponse>>
{
    public async Task<Result<CategoryResponse>> Handle(UpdateCategoryCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Updating category. CategoryId={CategoryId}", cmd.CategoryId);

        var category = await repo.GetByIdAsync(cmd.CategoryId, ct);
        if (category is null)
            return Result<CategoryResponse>.NotFound($"Category with ID {cmd.CategoryId} not found.");

        var request = cmd.Request;

        if (request.CategoryName.Trim() != category.CategoryName)
        {
            var exists = await repo.ExistsByNameAsync(request.CategoryName.Trim(), category.ControlType, ct, cmd.CategoryId, currentUser.UserId);
            if (exists)
                return Result<CategoryResponse>.Conflict($"Category '{request.CategoryName.Trim()}' already exists.");
        }

        var userId = currentUser.UserId ?? "system";
        category.CategoryName = request.CategoryName.Trim();
        category.Description = request.Description?.Trim();
        category.ModifiedBy = userId;
        category.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateAsync(category, ct);
        logger.LogInformation("Category updated. CategoryId={CategoryId}", cmd.CategoryId);

        return Result<CategoryResponse>.Success(new CategoryResponse
        {
            CategoryId = category.CategoryId,
            CategoryName = category.CategoryName,
            Description = category.Description,
            ControlType = category.ControlType,
            Message = $"Category '{category.CategoryName}' has been updated successfully."
        });
    }
}

// ─── Delete Category (soft) ──────────────────────────────────────────────────

public sealed class DeleteCategoryHandler(
    ICategoryRepository repo,
    IWidgetRepository widgetRepo,
    ICurrentUserService currentUser,
    ILogger<DeleteCategoryHandler> logger) : IRequestHandler<DeleteCategoryCommand, Result>
{
    public async Task<Result> Handle(DeleteCategoryCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Deleting category. CategoryId={CategoryId}", cmd.CategoryId);

        var category = await repo.GetByIdWithDashboardsAsync(cmd.CategoryId, ct);
        if (category is null)
            return Result.NotFound($"Category with ID {cmd.CategoryId} not found.");

        if (category.CategoryId == 1)
            return Result.ValidationError("The default category 'Others' cannot be deleted.");

        // Must use the exact same "active" definition as the Manage Categories list (own,
        // non-deleted, Draft/Completed dashboards) — counting every non-deleted dashboard
        // here regardless of owner/status blocked deletion even when the list showed 0.
        var userId = currentUser.UserId ?? "system";
        var isAdmin = currentUser.Roles.Any(r => r.Equals("admin", StringComparison.OrdinalIgnoreCase));
        var dashboardCounts = await repo.GetItemCountsByCategoryAsync("dashboard", userId, isAdmin, ct);
        var activeDashboards = dashboardCounts.GetValueOrDefault(category.CategoryId);
        if (activeDashboards > 0)
            return Result.ValidationError($"Cannot delete category '{category.CategoryName}'. It has {activeDashboards} active dashboard(s). Move or delete them first.");

        var activeWidgets = await widgetRepo.CountActiveByCategoryAsync(category.CategoryId, ct);
        if (activeWidgets > 0)
        {
            var noun = category.ControlType == "tile" ? "tile" : category.ControlType == "chart" ? "chart" : "chart/tile";
            return Result.ValidationError($"Cannot delete category '{category.CategoryName}'. It has {activeWidgets} active {noun}(s). Move or delete them first.");
        }

        category.IsDeleted = true;
        category.DeletedBy = userId;
        category.ModifiedBy = userId;
        category.ModifiedAt = DateTime.UtcNow;

        await repo.UpdateAsync(category, ct);
        logger.LogInformation("Category deleted. CategoryId={CategoryId}", cmd.CategoryId);

        return Result.Success();
    }
}
