using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Auth;

public sealed class DashboardVersionPermissionFilter(IMediator mediator) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }
        var dashboardId = Convert.ToInt32(context.ActionArguments["dashboardId"]);
        var isHistoryRequest = context.HttpContext.Request.Path.Value?.EndsWith("/versions", StringComparison.OrdinalIgnoreCase) == true;
        var result = await mediator.Send(new ResolveDashboardVersionAccessQuery(user, dashboardId, isHistoryRequest),
            context.HttpContext.RequestAborted);
        if (!result.IsSuccess)
        {
            var status = result.IsNotFound ? StatusCodes.Status404NotFound : StatusCodes.Status403Forbidden;
            var response = ApiEnvelope<object>.Fail(result.ErrorMessage!, status);
            context.Result = result.IsNotFound
                ? new NotFoundObjectResult(response)
                : new ObjectResult(response) { StatusCode = status };
            return;
        }
        if (result.Value!.Versions is { } versions)
        {
            context.Result = new OkObjectResult(ApiEnvelope<IReadOnlyList<DashboardVersionSummaryResponse>>.Ok(versions));
            return;
        }

        context.ActionArguments["dashboardId"] = result.Value.DashboardId;
        await next();
    }
}