namespace TWise.Tenant.Application.Features.Ai;

/// <summary>The dataset kinds Ask AI works on.</summary>
public static class AiSources
{
    public const string Message = "sourceType must be view or import.";
    public static bool IsSourceType(string s) => s is "view" or "import";
}
