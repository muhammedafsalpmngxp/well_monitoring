using System.Security.Claims;

namespace TWise.Tenant.Application.Common;

/// <summary>
/// Reads the module permissions the control plane puts in the access token: one "perm" claim per
/// module, written "code:flags", where flags holds any of v (view), c (create), m (modify), a (admin).
/// Every role, admin included, passes a check only through its ticked module permissions.
/// </summary>
public static class ModulePermission
{
    public const char View = 'v';
    public const char Create = 'c';
    public const char Modify = 'm';

    public const string ModelStudio = "model.studio";
    public const string Canvas = "dashboard.canvas";
    public const string StandardDatasets = "model.standard-datasets";
    public const string StandardCanvases = "dashboard.standard-canvases";
    public const string Schedules = "smart-alerts.schedules";
    public const string DashboardComments = "dashboard.comments";
    public const string DashboardVersions = "dashboard.versions";

    /// <summary>
    /// Reading datasets and running POST /api/query. Model Studio users build and preview datasets;
    /// canvas users show dataset results on a canvas. Viewers of the Standard Datasets and Standard Canvases
    /// lists read published datasets the same way. Changing a dataset still needs model.studio.
    /// </summary>
    public static bool CanReadModel(ClaimsPrincipal user) =>
        new[] { ModelStudio, Canvas, StandardDatasets, StandardCanvases }.Any(code => Has(user, code, View));

    public static bool Has(ClaimsPrincipal user, string moduleCode, char action)
    {
        return user.FindAll("perm").Any(c =>
        {
            var colon = c.Value.IndexOf(':');
            return colon > 0
                && string.Equals(c.Value[..colon], moduleCode, StringComparison.Ordinal)
                && c.Value[(colon + 1)..].Contains(action);
        });
    }
}
