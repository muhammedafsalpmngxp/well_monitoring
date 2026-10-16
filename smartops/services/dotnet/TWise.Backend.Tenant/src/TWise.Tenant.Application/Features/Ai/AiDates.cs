namespace TWise.Tenant.Application.Features.Ai;

/// <summary>
/// AI tables store UTC, but values read back carry no kind and were sent without "Z", so browsers
/// showed them as local time (5.5 hours off in IST). Marking them UTC makes them serialize with "Z".
/// </summary>
public static class AiDates
{
    public static DateTime Utc(DateTime d) => DateTime.SpecifyKind(d, DateTimeKind.Utc);

    public static DateTime? Utc(DateTime? d) => d is { } v ? Utc(v) : null;
}
