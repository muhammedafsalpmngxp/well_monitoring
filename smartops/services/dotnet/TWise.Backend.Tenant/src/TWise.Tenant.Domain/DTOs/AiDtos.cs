namespace TWise.Tenant.Domain.DTOs;

/// <summary>Tenant-wide switches. ActiveProviderId is null until a provider is chosen. DailyQuota is the active provider's
/// (500 while there is none).</summary>
public record AiSettingsDto(int DailyQuota, bool IsEnabled, long? ActiveProviderId, DateTime? ModifiedAt);

/// <summary>An editable AI instruction: Text is the one in use; DefaultText the original (or, per dataset, the tenant's).</summary>
public record AiPromptDto(string Key, string Name, string Description, string DefaultText, string Text, bool IsCustom);

/// <summary>Empty text restores the original.</summary>
public record SaveAiPromptRequest(string? Text);

/// <summary>
/// One AI prompt on AI Settings → AI Prompts: the text in use and its version, the original (version 1), who changed it
/// last, and what a save must keep (Placeholders the code fills, ReplyKeys of the JSON reply the code reads).
/// </summary>
public record AiPromptItemDto(string Key, string Group, string Name, string Description, string Text, string OriginalText,
    int Version, string ChangedBy, DateTime ChangedAt, IReadOnlyList<string> Placeholders, IReadOnlyList<string> ReplyKeys, bool AllowEmpty);

/// <summary>One saved version of a prompt. Action: seed (the original), update or restore.</summary>
public record AiPromptVersionDto(int Version, string Action, string? Note, string ChangedBy, DateTime ChangedAt, bool IsCurrent, string Text);

/// <summary>ExpectedVersion is the version the admin edited: the save is refused when someone saved in between.</summary>
public record SaveAiPromptVersionRequest(string? Text, string? Note, int? ExpectedVersion);

public record RestoreAiPromptRequest(int Version, int? ExpectedVersion, string? Note);

/// <summary>DailyQuota is saved on the active provider (Settings → AI Providers → Limits).</summary>
public record SaveAiSettingsRequest(int DailyQuota, bool IsEnabled);

/// <summary>A grantable AI feature (catalog entry).</summary>
public record AiFeatureDto(string Key, string Name, string Description);

/// <summary>Admin view: the catalog plus, per feature key, the role codes granted in this tenant.</summary>
public record AiFeatureAccessDto(IReadOnlyList<AiFeatureDto> Features, IReadOnlyDictionary<string, IReadOnlyList<string>> Access);

/// <summary>Feature keys the signed-in user may use right now (master flag, active provider and role grants folded in).</summary>
public record AiFeaturesDto(IReadOnlyList<string> Enabled);

/// <summary>A registered provider as shown to an admin. The key itself is never returned, only whether one is set.
/// DailyQuota: max AI calls per tenant per UTC day while this provider is active; 0 = unlimited.</summary>
public record AiProviderDto(long Id, string Name, string Provider, string BaseUrl, string Model, bool HasApiKey, bool IsActive, DateTime ModifiedAt,
    string? FastModel, int DailyQuota);

/// <summary>ApiKey null or empty keeps the stored key on update; a value replaces it. DailyQuota null keeps the stored
/// quota on update (500 for a new provider).</summary>
public record SaveAiProviderRequest(string Name, string Provider, string BaseUrl, string Model, string? ApiKey, string? FastModel = null,
    int? DailyQuota = null);

public record AiTestResultDto(bool Success, string Message, int LatencyMs);

public record AiUsageDayDto(DateTime Day, int Calls, int Failed, long PromptTokens, long CompletionTokens);

/// <summary>One answered question, for the admin's AI activity page.</summary>
public record AiActivityItemDto(long MessageId, long ConversationId, string UserId, string? UserName, string SourceType, long SourceId, string SourceName,
    string Question, string Answer, bool HasQuery, bool HasTrace, int? TotalMs, DateTime CreatedAt);
public record AiActivityPageDto(int Total, IReadOnlyList<AiActivityItemDto> Items);
/// <summary>A failed AI call from the usage log.</summary>
/// <summary>One AI call (any feature): who, what for, tokens, time, and the error when it failed.</summary>
public record AiCallDto(long Id, string? UserId, string? UserName, string Purpose, string Model, int PromptTokens, int CompletionTokens, int LatencyMs,
    bool Succeeded, string? Error, DateTime CreatedAt);
public record AiActivityUserDto(string UserId, string? Name);
/// <summary>A page of AI calls plus the users and purposes seen in the period (for the filters).</summary>
public record AiCallsPageDto(int Total, IReadOnlyList<AiCallDto> Items, IReadOnlyList<AiActivityUserDto> Users, IReadOnlyList<string> Purposes);
public record AiProviderDefaultDto(string Kind, string Label, string BaseUrl, string Model, bool NeedsKey);
/// <summary>What the AI admin screens offer (AiAdmin settings): provider defaults, the starting quota, the warning level, periods and page size.</summary>
public record AiAdminOptionsDto(IReadOnlyList<AiProviderDefaultDto> Providers, int DefaultDailyQuota, int QuotaWarnPercent, int UsageDays,
    int ActivityDays, int MaxDays, IReadOnlyList<int> DayOptions, int PageSize, int TraceRetentionDays);

/// <summary>DailyQuota is the active provider's (0 = unlimited or no active provider).</summary>
public record AiUsageSummaryDto(int CallsToday, int DailyQuota, IReadOnlyList<AiUsageDayDto> Days, int QuotaWarnPercent);

/// <summary>A chat message in the OpenAI shape (role: system | user | assistant).</summary>
public record AiMessage(string Role, string Content);

public record AiCompletion(string Content, int PromptTokens, int CompletionTokens);

/// <summary>
/// Ask Data's settings (AI Settings → Ask Data & Features): what it may read and its limits. Configured is false until an admin
/// has chosen at least one schema; Ask Data refuses to run until then. ChatMode (deep | normal) is how the Ask your data
/// chatbot answers; agents choose their own mode per step.
/// </summary>
public record AskDataSettingsDto(
    bool Configured,
    IReadOnlyList<string> AllowedSchemas,
    IReadOnlyList<string> ExcludedTables,
    IReadOnlyList<string> ExcludedColumns,
    int MaxRows,
    int QueryTimeout,
    int MaxQueries,
    int SqlRetries,
    int VerifyRetries,
    int HistoryTurns,
    string? OrgName,
    string? ExportPrefix,
    string ChatMode,
    string? ModifiedBy,
    DateTime? ModifiedAt);

public record SaveAskDataSettingsRequest(
    IReadOnlyList<string>? AllowedSchemas,
    IReadOnlyList<string>? ExcludedTables,
    IReadOnlyList<string>? ExcludedColumns,
    int MaxRows,
    int QueryTimeout,
    int MaxQueries,
    int SqlRetries,
    int VerifyRetries,
    int HistoryTurns,
    string? OrgName,
    string? ExportPrefix,
    string? ChatMode = null);

/// <summary>The Ask Data database's schemas, tables and columns, for choosing what Ask Data may read.</summary>
public record AskDataCatalogDto(string Database, IReadOnlyList<AskDataCatalogSchemaDto> Schemas);

public record AskDataCatalogSchemaDto(string Name, IReadOnlyList<AskDataCatalogTableDto> Tables);

public record AskDataCatalogTableDto(string Name, IReadOnlyList<string> Columns);
