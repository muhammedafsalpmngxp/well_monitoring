using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using TWise.Tenant.API.Controllers;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Auth;

public sealed class BiWritePermissionFilter(
    IDashboardRepository dashboards, IWidgetService widgets, IReportService reports) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        if (HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method)
            || HttpMethods.IsOptions(http.Request.Method))
        {
            await next();
            return;
        }

        var user = http.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        if (user.IsInRole("admin"))
        {
            await next();
            return;
        }

        var copying = http.Request.Path.Value?.EndsWith("/copy-to-draft", StringComparison.OrdinalIgnoreCase) == true;
        var hasId = context.ActionArguments.TryGetValue("dashboardId", out var id)
            || context.ActionArguments.TryGetValue("id", out id);
        var action = copying || !hasId ? ModulePermission.Create : ModulePermission.Modify;
        var userIdClaim = user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("sub")?.Value;
        if (!long.TryParse(userIdClaim, out var userId))
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        string module;
        string? destinationModule = null;
        context.ActionArguments.TryGetValue("request", out var request);
        var cancellation = http.RequestAborted;
        switch (context.Controller)
        {
            case DashboardController:
                var dashboard = hasId ? await dashboards.GetDashboardByIdAsync(Convert.ToInt32(id), cancellation) : null;
                var config = dashboard?.ConfigJson
                    ?? (request as SaveDashboardRequest)?.ConfigJson;
                module = DashboardKind.Of(config) == DashboardKind.Canvas ? ModulePermission.Canvas
                    : !copying && dashboard?.Status is "Published" or "Inactive"
                        ? "dashboard.standard-boards" : "dashboard.wip-boards";
                break;
            case WidgetController:
                var widget = hasId ? await widgets.GetByIdAsync(Convert.ToInt64(id), userId, cancellation) : null;
                var type = request is CreateWidgetRequest create ? create.Type
                    : request is UpdateWidgetRequest update ? update.Type : widget?.Type;
                module = WidgetModule(widget?.Type ?? type, !copying && widget?.Status == "published");
                if (widget is not null && type is not null && type != widget.Type)
                    destinationModule = WidgetModule(type, false);
                break;
            case ReportsController:
                var report = hasId ? await reports.GetByIdAsync(Convert.ToInt64(id), userId, cancellation) : null;
                module = !copying && report?.Status == "published" ? "reports.standard-reports" : "reports.my-reports";
                break;
            default:
                context.Result = new ForbidResult();
                return;
        }

        bool Allowed(string code) => ModulePermission.Has(user, code, ModulePermission.View)
            && ModulePermission.Has(user, code, action);
        if (!Allowed(module) || (destinationModule is not null && !Allowed(destinationModule)))
        {
            context.Result = new ObjectResult(new { message = "You do not have permission to change this item." })
                { StatusCode = StatusCodes.Status403Forbidden };
            return;
        }
        await next();
    }

    private static string WidgetModule(string? type, bool published) => type?.ToLowerInvariant() switch
    {
        "chart" => published ? "charts.standard-charts" : "charts.wip-charts",
        "tile" => published ? "charts.standard-tiles" : "charts.wip-tiles",
        _ => "invalid-widget-type"
    };
}