using System.ComponentModel.DataAnnotations;

namespace SmartOps.Integrations.Domain.Dtos;

public record EndpointDto(int Id, string Key, string System, string Name, string BaseUrl,
                          string AuthType, object Config, string Status);

public record EndpointUpsertRequest(
    [Required] string Key, [Required] string System, [Required] string Name,
    [Required] string BaseUrl, string AuthType, object Config, string Status = "active");

public record SyncJobDto(int Id, string EndpointKey, string Direction,
                         DateTime StartedAt, DateTime? FinishedAt,
                         int RecordsSent, int RecordsReceived, int Errors,
                         string Status, string? Note);

public record SyncTriggerRequest([Required] string EndpointKey, string Direction = "outbound");
