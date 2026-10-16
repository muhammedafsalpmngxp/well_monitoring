using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class RefreshScheduleConfiguration : IEntityTypeConfiguration<RefreshSchedule>
{
    public void Configure(EntityTypeBuilder<RefreshSchedule> builder)
    {
        builder.ToTable("RefreshSchedules", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ScheduleName).HasColumnName("schedule_name").HasMaxLength(200).IsRequired();
        builder.Property(e => e.DataSourceConnectionId).HasColumnName("data_source_connection_id");
        builder.Property(e => e.ImportedDatasetId).HasColumnName("imported_dataset_id");
        builder.Property(e => e.ObjectRef).HasColumnName("object_ref").HasMaxLength(500);
        builder.Property(e => e.CronExpression).HasColumnName("cron_expression").HasMaxLength(100).IsRequired();
        builder.Property(e => e.TimeZoneId).HasColumnName("time_zone_id").HasMaxLength(100).IsRequired();
        builder.Property(e => e.FrequencyLabel).HasColumnName("frequency_label").HasMaxLength(50);
        builder.Property(e => e.RefreshMode).HasColumnName("refresh_mode").HasMaxLength(20).IsRequired();
        builder.Property(e => e.IncrementalColumn).HasColumnName("incremental_column").HasMaxLength(200);
        builder.Property(e => e.LastWatermark).HasColumnName("last_watermark").HasMaxLength(400);
        builder.Property(e => e.IsEnabled).HasColumnName("is_enabled");
        builder.Property(e => e.LastRunAt).HasColumnName("last_run_at");
        builder.Property(e => e.NextRunAt).HasColumnName("next_run_at");
        builder.Property(e => e.LastStatus).HasColumnName("last_status").HasMaxLength(20);
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasQueryFilter(e => !e.IsDeleted);

        builder.HasIndex(e => new { e.TenantId, e.ScheduleName })
            .IsUnique()
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("UX_core_RefreshSchedules_tenant_name");

        // The worker's hot query is "enabled schedules that are due", so the index leads
        // with the columns it filters on.
        builder.HasIndex(e => new { e.IsEnabled, e.NextRunAt })
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_core_RefreshSchedules_due");
    }
}

public sealed class RefreshJobConfiguration : IEntityTypeConfiguration<RefreshJob>
{
    public void Configure(EntityTypeBuilder<RefreshJob> builder)
    {
        builder.ToTable("RefreshJobs", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.JobCode).HasColumnName("job_code").HasMaxLength(30).IsRequired();
        builder.Property(e => e.ScheduleId).HasColumnName("schedule_id");
        builder.Property(e => e.DataSourceConnectionId).HasColumnName("data_source_connection_id");
        builder.Property(e => e.ImportedDatasetId).HasColumnName("imported_dataset_id");
        builder.Property(e => e.JobProcess).HasColumnName("job_process").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
        builder.Property(e => e.TriggeredBy).HasColumnName("triggered_by").HasMaxLength(20).IsRequired();
        builder.Property(e => e.RefreshMode).HasColumnName("refresh_mode").HasMaxLength(20).IsRequired();
        builder.Property(e => e.QueuedAt).HasColumnName("queued_at");
        builder.Property(e => e.StartedAt).HasColumnName("started_at");
        builder.Property(e => e.CompletedAt).HasColumnName("completed_at");
        builder.Property(e => e.DurationMs).HasColumnName("duration_ms");
        builder.Property(e => e.RowCount).HasColumnName("row_count");
        builder.Property(e => e.ErrorMessage).HasColumnName("error_message").HasMaxLength(2000);
        builder.Property(e => e.TriggeredByUserId).HasColumnName("triggered_by_user_id");
        builder.Property(e => e.TenantId).HasColumnName("tenant_id");
        builder.Property(e => e.IsDeleted).HasColumnName("is_deleted");

        builder.HasQueryFilter(e => !e.IsDeleted);

        builder.HasIndex(e => e.JobCode)
            .IsUnique()
            .HasDatabaseName("UX_core_RefreshJobs_job_code");

        // History is always read newest-first for a tenant.
        builder.HasIndex(e => new { e.TenantId, e.QueuedAt })
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_core_RefreshJobs_tenant_queued");

        builder.HasIndex(e => e.ScheduleId)
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_core_RefreshJobs_schedule");
    }
}
