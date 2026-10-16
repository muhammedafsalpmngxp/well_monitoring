namespace SmartOps.Wells.Application.Common;

/// <summary>
/// Discriminated union result that avoids exception-based flow control for
/// expected failure scenarios (not-found, validation, conflict).
/// </summary>
public sealed class Result<T>
{
    public T? Value { get; }
    public string? ErrorMessage { get; }
    public ResultStatus Status { get; }

    public bool IsSuccess => Status == ResultStatus.Success;
    public bool IsNotFound => Status == ResultStatus.NotFound;
    public bool IsConflict => Status == ResultStatus.Conflict;
    public bool IsValidationError => Status == ResultStatus.ValidationError;

    private Result(T value)
    {
        Value = value;
        Status = ResultStatus.Success;
    }

    private Result(ResultStatus status, string errorMessage)
    {
        Status = status;
        ErrorMessage = errorMessage;
    }

    public static Result<T> Success(T value) => new(value);
    public static Result<T> NotFound(string message = "Resource not found") => new(ResultStatus.NotFound, message);
    public static Result<T> Conflict(string message) => new(ResultStatus.Conflict, message);
    public static Result<T> ValidationError(string message) => new(ResultStatus.ValidationError, message);
}

/// <summary>Non-generic result for void operations (e.g. delete).</summary>
public sealed class Result
{
    public string? ErrorMessage { get; }
    public ResultStatus Status { get; }

    public bool IsSuccess => Status == ResultStatus.Success;
    public bool IsNotFound => Status == ResultStatus.NotFound;

    private Result(ResultStatus status, string? errorMessage = null)
    {
        Status = status;
        ErrorMessage = errorMessage;
    }

    public static Result Success() => new(ResultStatus.Success);
    public static Result NotFound(string message = "Resource not found") => new(ResultStatus.NotFound, message);
}

public enum ResultStatus
{
    Success,
    NotFound,
    Conflict,
    ValidationError
}
