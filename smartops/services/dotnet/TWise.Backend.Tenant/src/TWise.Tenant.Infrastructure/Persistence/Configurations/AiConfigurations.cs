using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

/// <summary>Maps to [core].[AiSettings] (see infra/sql/add-ai-settings.sql). Schema is SQL-managed.</summary>
public sealed class AiSettingsConfiguration : IEntityTypeConfiguration<AiSettings>
{
    public void Configure(EntityTypeBuilder<AiSettings> b)
    {
        b.ToTable("AiSettings", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.IsEnabled).HasColumnName("is_enabled");
        b.Property(e => e.PromptsJson).HasColumnName("prompts_json");
        b.Property(e => e.AskDataAllowedSchemas).HasColumnName("askdata_allowed_schemas");
        b.Property(e => e.AskDataExcludedTables).HasColumnName("askdata_excluded_tables");
        b.Property(e => e.AskDataExcludedColumns).HasColumnName("askdata_excluded_columns");
        b.Property(e => e.AskDataMaxRows).HasColumnName("askdata_max_rows");
        b.Property(e => e.AskDataQueryTimeout).HasColumnName("askdata_query_timeout");
        b.Property(e => e.AskDataMaxQueries).HasColumnName("askdata_max_queries");
        b.Property(e => e.AskDataSqlRetries).HasColumnName("askdata_sql_retries");
        b.Property(e => e.AskDataVerifyRetries).HasColumnName("askdata_verify_retries");
        b.Property(e => e.AskDataHistoryTurns).HasColumnName("askdata_history_turns");
        b.Property(e => e.AskDataOrgName).HasColumnName("askdata_org_name").HasMaxLength(200);
        b.Property(e => e.AskDataExportPrefix).HasColumnName("askdata_export_prefix").HasMaxLength(40);
        b.Property(e => e.AskDataChatMode).HasColumnName("askdata_chat_mode").HasMaxLength(10);
        b.Property(e => e.SlippageSettingsJson).HasColumnName("slippage_settings_json");
        b.Property(e => e.DailyReportSettingsJson).HasColumnName("dailyreport_settings_json");
        b.Property(e => e.AnomalySettingsJson).HasColumnName("anomaly_settings_json");
        b.Property(e => e.CreatedBy).HasColumnName("created_by");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        b.Property(e => e.IsDeleted).HasColumnName("is_deleted");
        b.Ignore(e => e.DeletedBy);
        b.HasQueryFilter(e => !e.IsDeleted);
    }
}

/// <summary>Maps to [core].[AiFeatureRoles].</summary>
public sealed class AiFeatureRoleConfiguration : IEntityTypeConfiguration<AiFeatureRole>
{
    public void Configure(EntityTypeBuilder<AiFeatureRole> b)
    {
        b.ToTable("AiFeatureRoles", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.FeatureKey).HasColumnName("feature_key").HasMaxLength(40).IsRequired();
        b.Property(e => e.RoleCode).HasColumnName("role_code").HasMaxLength(100).IsRequired();
    }
}

/// <summary>Maps to [core].[AiProviders].</summary>
public sealed class AiProviderConfiguration : IEntityTypeConfiguration<AiProvider>
{
    public void Configure(EntityTypeBuilder<AiProvider> b)
    {
        b.ToTable("AiProviders", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
        b.Property(e => e.Provider).HasColumnName("provider").HasMaxLength(20).IsRequired();
        b.Property(e => e.BaseUrl).HasColumnName("base_url").HasMaxLength(500).IsRequired();
        b.Property(e => e.Model).HasColumnName("model").HasMaxLength(100).IsRequired();
        b.Property(e => e.FastModel).HasColumnName("fast_model").HasMaxLength(100);
        b.Property(e => e.ApiKeyEncrypted).HasColumnName("api_key_encrypted").HasMaxLength(1000);
        b.Property(e => e.DailyQuota).HasColumnName("daily_quota");
        b.Property(e => e.IsActive).HasColumnName("is_active");
        b.Property(e => e.CreatedBy).HasColumnName("created_by");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        b.Property(e => e.DeletedBy).HasColumnName("deleted_by");
        b.Property(e => e.IsDeleted).HasColumnName("is_deleted");
        b.HasQueryFilter(e => !e.IsDeleted);
    }
}

/// <summary>Maps to [core].[AiUsageLog]. Append-only.</summary>
public sealed class AiUsageLogConfiguration : IEntityTypeConfiguration<AiUsageLog>
{
    public void Configure(EntityTypeBuilder<AiUsageLog> b)
    {
        b.ToTable("AiUsageLog", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.UserId).HasColumnName("user_id").HasMaxLength(100);
        b.Property(e => e.Purpose).HasColumnName("purpose").HasMaxLength(40).IsRequired();
        b.Property(e => e.Model).HasColumnName("model").HasMaxLength(100).IsRequired();
        b.Property(e => e.PromptTokens).HasColumnName("prompt_tokens");
        b.Property(e => e.CompletionTokens).HasColumnName("completion_tokens");
        b.Property(e => e.LatencyMs).HasColumnName("latency_ms");
        b.Property(e => e.Succeeded).HasColumnName("succeeded");
        b.Property(e => e.Error).HasColumnName("error").HasMaxLength(1000);
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
    }
}
