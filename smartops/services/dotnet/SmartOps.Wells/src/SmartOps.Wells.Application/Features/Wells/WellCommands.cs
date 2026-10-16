using FluentValidation;
using MediatR;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Application.Common;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.Application.Features.Wells;

// ─── Well Commands ────────────────────────────────────────────────────────────

public record CreateWellCommand(WellCreateRequest Request) : IRequest<Result<WellDto>>;

public sealed class CreateWellCommandValidator : AbstractValidator<CreateWellCommand>
{
    public CreateWellCommandValidator()
    {
        RuleFor(x => x.Request.WellId)
            .NotEmpty().WithMessage("WellId is required.")
            .MaximumLength(64).WithMessage("WellId must not exceed 64 characters.");
        RuleFor(x => x.Request.Cluster)
            .NotEmpty().WithMessage("Cluster is required.")
            .MaximumLength(64).WithMessage("Cluster must not exceed 64 characters.");
    }
}

public sealed class CreateWellCommandHandler(IWellsRepository repo)
    : IRequestHandler<CreateWellCommand, Result<WellDto>>
{
    public async Task<Result<WellDto>> Handle(CreateWellCommand cmd, CancellationToken ct)
    {
        try
        {
            var well = await repo.CreateWellAsync(cmd.Request, ct);
            return Result<WellDto>.Success(well);
        }
        catch (ArgumentException ex)
        {
            return Result<WellDto>.Conflict(ex.Message);
        }
    }
}

public record UpdateWellCommand(string WellId, WellUpdateRequest Request) : IRequest<Result<WellDto>>;

public sealed class UpdateWellCommandHandler(IWellsRepository repo)
    : IRequestHandler<UpdateWellCommand, Result<WellDto>>
{
    public async Task<Result<WellDto>> Handle(UpdateWellCommand cmd, CancellationToken ct)
    {
        var well = await repo.UpdateWellAsync(cmd.WellId, cmd.Request, ct);
        return well is null
            ? Result<WellDto>.NotFound($"Well '{cmd.WellId}' not found.")
            : Result<WellDto>.Success(well);
    }
}

public record DeleteWellCommand(string WellId) : IRequest<Result>;

public sealed class DeleteWellCommandHandler(IWellsRepository repo)
    : IRequestHandler<DeleteWellCommand, Result>
{
    public async Task<Result> Handle(DeleteWellCommand cmd, CancellationToken ct)
    {
        var deleted = await repo.DeleteWellAsync(cmd.WellId, ct);
        return deleted ? Result.Success() : Result.NotFound($"Well '{cmd.WellId}' not found.");
    }
}

// ─── Watchlist Commands ───────────────────────────────────────────────────────

public record AddWatchlistCommand(int UserId, WatchlistAddRequest Request)
    : IRequest<Result<WatchlistEntryDto>>;

public sealed class AddWatchlistCommandValidator : AbstractValidator<AddWatchlistCommand>
{
    public AddWatchlistCommandValidator()
    {
        RuleFor(x => x.Request.WellId).NotEmpty().WithMessage("WellId is required.");
        RuleFor(x => x.UserId).GreaterThan(0).WithMessage("UserId must be a valid user identifier.");
    }
}

public sealed class AddWatchlistCommandHandler(IWellsRepository repo)
    : IRequestHandler<AddWatchlistCommand, Result<WatchlistEntryDto>>
{
    public async Task<Result<WatchlistEntryDto>> Handle(AddWatchlistCommand cmd, CancellationToken ct)
    {
        try
        {
            var entry = await repo.AddWatchlistAsync(cmd.UserId, cmd.Request, ct);
            return Result<WatchlistEntryDto>.Success(entry);
        }
        catch (ArgumentException ex)
        {
            return Result<WatchlistEntryDto>.Conflict(ex.Message);
        }
    }
}

public record RemoveWatchlistCommand(int UserId, string WellId) : IRequest<Result>;

public sealed class RemoveWatchlistCommandHandler(IWellsRepository repo)
    : IRequestHandler<RemoveWatchlistCommand, Result>
{
    public async Task<Result> Handle(RemoveWatchlistCommand cmd, CancellationToken ct)
    {
        var removed = await repo.RemoveWatchlistAsync(cmd.UserId, cmd.WellId, ct);
        return removed ? Result.Success() : Result.NotFound();
    }
}

// ─── Critical Date Commands ───────────────────────────────────────────────────

public record CreateCriticalDateCommand(CriticalDateCreateRequest Request)
    : IRequest<Result<CriticalDateDto>>;

public sealed class CreateCriticalDateCommandValidator : AbstractValidator<CreateCriticalDateCommand>
{
    public CreateCriticalDateCommandValidator()
    {
        RuleFor(x => x.Request.WellId).NotEmpty().WithMessage("WellId is required.");
        RuleFor(x => x.Request.Label).NotEmpty().WithMessage("Label is required.")
            .MaximumLength(128).WithMessage("Label must not exceed 128 characters.");
    }
}

public sealed class CreateCriticalDateCommandHandler(IWellsRepository repo)
    : IRequestHandler<CreateCriticalDateCommand, Result<CriticalDateDto>>
{
    public async Task<Result<CriticalDateDto>> Handle(CreateCriticalDateCommand cmd, CancellationToken ct)
    {
        var date = await repo.CreateCriticalDateAsync(cmd.Request, ct);
        return Result<CriticalDateDto>.Success(date);
    }
}
