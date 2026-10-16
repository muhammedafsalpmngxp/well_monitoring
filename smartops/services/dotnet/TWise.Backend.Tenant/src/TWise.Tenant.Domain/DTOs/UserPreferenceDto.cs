namespace TWise.Tenant.Domain.DTOs;

public record UserPreferenceDto(
    long     PreferenceId,
    long     UserId,
    int      ControlTypeId,
    long     ControlId,
    bool     IsFavourite,
    DateTime? LastViewedOn
);

public record ToggleFavouriteRequest(int ControlTypeId, long ControlId);
public record TrackViewRequest      (int ControlTypeId, long ControlId);
