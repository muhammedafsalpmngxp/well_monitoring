namespace TWise.Backend.ControlPlane.Application.Common;

public sealed class Result<T>
{
    public T? Value { get; }
    public string? ErrorMessage { get; }
    public ResultStatus Status { get; }

    public bool IsSuccess => Status == ResultStatus.Success;
    public bool IsNotFound => Status == ResultStatus.NotFound;
    public bool IsConflict => Status == ResultStatus.Conflict;
    public bool IsUnauthorized => Status == ResultStatus.Unauthorized;

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
    public static Result<T> Unauthorized(string message) => new(ResultStatus.Unauthorized, message);
}

public sealed class Result
{
    public string? ErrorMessage { get; }
    public ResultStatus Status { get; }

    public bool IsSuccess => Status == ResultStatus.Success;
    public bool IsNotFound => Status == ResultStatus.NotFound;
    public bool IsConflict => Status == ResultStatus.Conflict;
    public bool IsValidationError => Status == ResultStatus.ValidationError;
    public bool IsFailure => Status == ResultStatus.Failure;
    public bool IsUnauthorized => Status == ResultStatus.Unauthorized;

    private Result(ResultStatus status, string? errorMessage = null)
    {
        Status = status;
        ErrorMessage = errorMessage;
    }

    public static Result Success() => new(ResultStatus.Success);
    public static Result NotFound(string message = "Resource not found") => new(ResultStatus.NotFound, message);
    public static Result Conflict(string message) => new(ResultStatus.Conflict, message);
    public static Result ValidationError(string message) => new(ResultStatus.ValidationError, message);
    public static Result Failure(string message) => new(ResultStatus.Failure, message);
    public static Result Unauthorized(string message) => new(ResultStatus.Unauthorized, message);
}

public enum ResultStatus
{
    Success,
    NotFound,
    Conflict,
    ValidationError,
    Failure,
    Unauthorized
}
