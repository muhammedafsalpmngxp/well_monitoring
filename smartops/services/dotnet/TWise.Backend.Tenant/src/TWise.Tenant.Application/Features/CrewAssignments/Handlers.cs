using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Features.CrewAssignments;

public sealed class CreateCrewAssignmentHandler(
    ICrewAssignmentRepository repo,
    ICurrentUserService currentUser,
    ILogger<CreateCrewAssignmentHandler> logger)
    : IRequestHandler<CreateCrewAssignmentCommand, Result<CrewAssignmentResponse>>
{
    public async Task<Result<CrewAssignmentResponse>> Handle(CreateCrewAssignmentCommand cmd, CancellationToken ct)
    {
        var r = cmd.Request;
        logger.LogInformation("Creating crew assignment. Crew={CrewUid} Activity={ActivityCode} Well={WellId}",
            r.CrewUid, r.ActivityCode, r.WellId);

        var exists = await repo.ExistsAsync(r.CrewUid.Trim(), r.ActivityCode.Trim(), r.WellId?.Trim(),
            r.PlannedStart, r.PlannedEnd, ct);
        if (exists)
            return Result<CrewAssignmentResponse>.Conflict(
                $"Activity '{r.ActivityCode}' is already assigned to crew '{r.CrewUid}' for an overlapping date range.");

        var userId = currentUser.UserId ?? "system";
        var entity = new CrewActivityAssignment
        {
            CrewGroupCode = r.CrewGroupCode.Trim(),
            CrewUid = r.CrewUid.Trim(),
            CrewTypeCode = r.CrewTypeCode?.Trim(),
            ActivityCode = r.ActivityCode.Trim(),
            ActivityName = r.ActivityName.Trim(),
            WellId = r.WellId?.Trim(),
            ProjectId = r.ProjectId?.Trim(),
            PlannedStart = r.PlannedStart?.Date,
            PlannedEnd = r.PlannedEnd?.Date,
            Progress = 0,
            Status = "assigned",
            CreatedBy = userId,
            ModifiedBy = userId
        };

        var created = await repo.CreateAsync(entity, ct);
        if (created is null)
            return Result<CrewAssignmentResponse>.Conflict(
                $"Activity '{r.ActivityCode}' is already assigned to crew '{r.CrewUid}' for an overlapping date range.");
        logger.LogInformation("Crew assignment created. Id={Id}", entity.Id);

        return Result<CrewAssignmentResponse>.Success(new CrewAssignmentResponse(
            Id: entity.Id,
            CrewGroupCode: entity.CrewGroupCode,
            CrewUid: entity.CrewUid,
            CrewTypeCode: entity.CrewTypeCode,
            ActivityCode: entity.ActivityCode,
            ActivityName: entity.ActivityName,
            WellId: entity.WellId,
            ProjectId: entity.ProjectId,
            PlannedStart: entity.PlannedStart,
            PlannedEnd: entity.PlannedEnd,
            Progress: entity.Progress,
            Status: entity.Status,
            Message: $"Activity '{entity.ActivityCode}' assigned to crew '{entity.CrewUid}'."));
    }
}

public sealed class DeleteCrewAssignmentHandler(
    ICrewAssignmentRepository repo,
    ICurrentUserService currentUser,
    ILogger<DeleteCrewAssignmentHandler> logger)
    : IRequestHandler<DeleteCrewAssignmentCommand, Result>
{
    public async Task<Result> Handle(DeleteCrewAssignmentCommand cmd, CancellationToken ct)
    {
        logger.LogInformation("Deleting crew assignment. Id={Id}", cmd.Id);

        var entity = await repo.GetByIdAsync(cmd.Id, ct);
        if (entity is null)
            return Result.NotFound($"Crew assignment with ID {cmd.Id} not found.");

        entity.IsDeleted = true;
        entity.DeletedBy = currentUser.UserId ?? "system";
        entity.ModifiedAt = DateTime.UtcNow;

        await repo.SoftDeleteAsync(entity, ct);
        logger.LogInformation("Crew assignment deleted. Id={Id}", cmd.Id);

        return Result.Success();
    }
}
