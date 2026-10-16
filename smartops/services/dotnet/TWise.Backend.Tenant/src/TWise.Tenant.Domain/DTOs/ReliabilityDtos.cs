using System.Text.Json.Serialization;

namespace TWise.Tenant.Domain.DTOs;

public record TableReliabilityDto(
    [property: JsonPropertyName("reliability")] decimal? Reliability,
    [property: JsonPropertyName("reliability_breakdown")] string ReliabilityBreakdown);