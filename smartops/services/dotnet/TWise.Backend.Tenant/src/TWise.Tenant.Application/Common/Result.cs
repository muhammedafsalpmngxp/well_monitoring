namespace TWise.Tenant.Application.Common;

public sealed class Result<T>
{
    public T? Value { get; }
    public string? ErrorMessage { get; }
    public ResultStatus Status { get; }

    public bool IsSuccess => Status == ResultStatus.Success;
    public bool IsNotFound => Status == ResultStatus.NotFound;
    public bool IsConflict => Status == ResultStatus.Conflict;
    public bool IsValidationError => Status == ResultStatus.ValidationError;
    public bool IsForbidden => Status == ResultStatus.Forbidden;

    private Result(T value) { Value = value; Status = ResultStatus.Success; }
    private Result(ResultStatus status, string errorMessage) { Status = status; ErrorMessage = errorMessage; }

    public static Result<T> Success(T value) => new(value);
    public static Result<T> NotFound(string message = "Resource not found") => new(ResultStatus.NotFound, message);
    public static Result<T> Conflict(string message) => new(ResultStatus.Conflict, message);
    public static Result<T> ValidationError(string message) => new(ResultStatus.ValidationError, message);
    public static Result<T> Forbidden(string message) => new(ResultStatus.Forbidden, message);
}

public sealed class Result
{
    public string? ErrorMessage { get; }
    public ResultStatus Status { get; }

    public bool IsSuccess => Status == ResultStatus.Success;
    public bool IsNotFound => Status == ResultStatus.NotFound;
    public bool IsConflict => Status == ResultStatus.Conflict;
    public bool IsValidationError => Status == ResultStatus.ValidationError;
    public bool IsForbidden => Status == ResultStatus.Forbidden;

    private Result(ResultStatus status, string? errorMessage = null) { Status = status; ErrorMessage = errorMessage; }

    public static Result Success() => new(ResultStatus.Success);
    public static Result NotFound(string message = "Resource not found") => new(ResultStatus.NotFound, message);
    public static Result Conflict(string message) => new(ResultStatus.Conflict, message);
    public static Result ValidationError(string message) => new(ResultStatus.ValidationError, message);
    public static Result Forbidden(string message) => new(ResultStatus.Forbidden, message);
    public static Result Failure(string message) => new(ResultStatus.Failure, message);
}

public enum ResultStatus
{
    Success,
    NotFound,
    Conflict,
    ValidationError,
    Forbidden,
    Failure
}
