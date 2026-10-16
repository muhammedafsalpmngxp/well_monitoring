namespace SmartOps.Shared.Errors;

public sealed class ApiErrorResponse
{
    public required ApiError Error { get; init; }
}

public sealed class ApiError
{
    public required string Code { get; init; }
    public required string Message { get; init; }
    public object? Details { get; init; }
    public string? TraceId { get; init; }
}
