using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace TWise.Tenant.Application.Features.Ai;

/// <summary>Reads a required setting from appsettings.json: a missing or invalid value stops startup with its name (no defaults in code).</summary>
internal static class RequiredSettings
{
    public static int Int(IConfiguration c, string section, string name) =>
        int.TryParse(c[$"{section}:{name}"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : throw Missing(section, name, "a positive whole number");

    public static double Number(IConfiguration c, string section, string name) =>
        double.TryParse(c[$"{section}:{name}"], NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : throw Missing(section, name, "a positive number");

    public static bool Flag(IConfiguration c, string section, string name) =>
        bool.TryParse(c[$"{section}:{name}"], out var v) ? v : throw Missing(section, name, "true or false");

    public static int[] Ints(IConfiguration c, string section, string name)
    {
        var values = c.GetSection($"{section}:{name}").GetChildren()
            .Select(x => int.TryParse(x.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) && v > 0 ? v : 0).ToArray();
        return values.Length > 0 && !values.Contains(0) ? values : throw Missing(section, name, "a list of positive whole numbers");
    }

    private static InvalidOperationException Missing(string section, string name, string what) =>
        new($"{section}:{name} must be set to {what} in appsettings.json.");
}
