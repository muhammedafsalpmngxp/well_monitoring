using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.API.Auth;

[AttributeUsage(AttributeTargets.Method)]
public sealed class RequireModulePermissionAttribute(string moduleCode, params char[] actions) : Attribute, IAuthorizationFilter
{
    public string ModuleCode { get; } = moduleCode;
    public IReadOnlyList<char> Actions { get; } = actions;

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var user = context.HttpContext.User;
        if (user.Identity?.IsAuthenticated != true)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        if (!ModulePermission.Has(user, ModuleCode, ModulePermission.View)
            || !Actions.Any(action => ModulePermission.Has(user, ModuleCode, action)))
            context.Result = new ForbidResult();
    }
}