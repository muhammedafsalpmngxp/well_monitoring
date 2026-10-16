using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public sealed class IngestionRunConfiguration : IEntityTypeConfiguration<IngestionRun>
{
    public void Configure(EntityTypeBuilder<IngestionRun> e)
    {
        e.ToTable("IngestionRun", "control");
        e.HasKey(x => x.IngestionRunId);
        e.Property(x => x.IngestionRunId).HasColumnName("ingestion_run_id");
        e.Property(x => x.TenantSourceId).HasColumnName("tenant_source_id");
        e.Property(x => x.StartedAt).HasColumnName("started_at");
        e.Property(x => x.FinishedAt).HasColumnName("finished_at");
        e.Property(x => x.Status).HasColumnName("status").HasMaxLength(20);
        e.Property(x => x.RowsExtracted).HasColumnName("rows_extracted");
        e.Property(x => x.RowsLoaded).HasColumnName("rows_loaded");
        e.Property(x => x.ErrorCount).HasColumnName("error_count");
        e.Property(x => x.CreatedAt).HasColumnName("created_at");
        e.HasOne<TenantSource>().WithMany().HasForeignKey(x => x.TenantSourceId);
    }
}
