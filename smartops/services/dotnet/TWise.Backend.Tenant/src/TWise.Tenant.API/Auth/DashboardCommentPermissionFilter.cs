using MediatR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Auth;

public sealed class DashboardCommentPermissionFilter(IMediator mediator) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        context.ActionArguments.TryGetValue("targetType", out var targetType);
        context.ActionArguments.TryGetValue("request", out var request);
        var create = request as CreateCommentRequest;
        context.ActionArguments.TryGetValue("targetId", out var queryTargetId);
        long? commentId = context.ActionArguments.TryGetValue("commentId", out var existingCommentId)
            ? Convert.ToInt64(existingCommentId) : null;
        var method = context.HttpContext.Request.Method;
        var action = HttpMethods.IsGet(method) ? ModulePermission.View
            : HttpMethods.IsPost(method) ? ModulePermission.Create : ModulePermission.Modify;
        var result = await mediator.Send(new CheckDashboardCommentAccessQuery(user, action,
            targetType as string, create?.TargetId ?? Convert.ToInt32(queryTargetId), commentId, create),
            context.HttpContext.RequestAborted);
        if (!result.IsSuccess)
        {
            context.Result = result.IsValidationError
                ? new BadRequestObjectResult(new { message = result.ErrorMessage })
                : new ObjectResult(new { message = result.ErrorMessage }) { StatusCode = StatusCodes.Status403Forbidden };
            return;
        }
        await next();
    }
}