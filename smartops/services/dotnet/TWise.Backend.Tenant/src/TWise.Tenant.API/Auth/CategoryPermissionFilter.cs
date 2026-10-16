using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Auth;

public sealed class CategoryPermissionFilter(ICategoryRepository categories) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        if (http.User.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        context.ActionArguments.TryGetValue("request", out var request);
        context.ActionArguments.TryGetValue("controlType", out var queryType);
        var controlType = (request as SaveCategoryRequest)?.ControlType ?? queryType as string;
        if (context.ActionArguments.TryGetValue("categoryId", out var categoryId))
        {
            var category = await categories.GetByIdAsync(Convert.ToInt32(categoryId), http.RequestAborted);
            if (category is null)
            {
                context.Result = new NotFoundResult();
                return;
            }
            controlType = category.ControlType;
        }

        var module = controlType?.ToLowerInvariant() switch
        {
            "dashboard" => "dashboard.categories",
            "chart" or "tile" => "charts.categories",
            "report" => "reports.categories",
            _ => null
        };
        if (module is null)
        {
            context.Result = new BadRequestObjectResult(new { message = "A valid category control type is required." });
            return;
        }

        var action = HttpMethods.IsGet(http.Request.Method) ? ModulePermission.View
            : HttpMethods.IsPost(http.Request.Method) ? ModulePermission.Create : ModulePermission.Modify;
        if (!ModulePermission.Has(http.User, module, ModulePermission.View)
            || !ModulePermission.Has(http.User, module, action))
        {
            context.Result = new ObjectResult(new { message = "You do not have permission to manage these categories." })
                { StatusCode = StatusCodes.Status403Forbidden };
            return;
        }

        await next();
    }
}