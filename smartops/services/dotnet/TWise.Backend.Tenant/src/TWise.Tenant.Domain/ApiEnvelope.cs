namespace TWise.Tenant.Domain;

/// <summary>
/// Standard API response envelope matching the frontend ApiResponse&lt;T&gt; interface.
/// </summary>
public sealed class ApiEnvelope<T>
{
    public T? Data { get; init; }
    public string Message { get; init; } = string.Empty;
    public bool Success { get; init; }
    public int StatusCode { get; init; }

    public static ApiEnvelope<T> Ok(T data, string message = "OK", int statusCode = 200) => new()
    {
        Data = data,
        Message = message,
        Success = true,
        StatusCode = statusCode
    };

    public static ApiEnvelope<T> Fail(string message, int statusCode) => new()
    {
        Data = default,
        Message = message,
        Success = false,
        StatusCode = statusCode
    };
}
