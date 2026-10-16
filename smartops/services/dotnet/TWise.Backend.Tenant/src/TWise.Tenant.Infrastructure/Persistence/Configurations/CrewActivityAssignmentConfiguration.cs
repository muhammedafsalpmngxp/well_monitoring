using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class CrewActivityAssignmentConfiguration : IEntityTypeConfiguration<CrewActivityAssignment>
{
    public void Configure(EntityTypeBuilder<CrewActivityAssignment> b)
    {
        b.ToTable("CrewActivityAssignment", "core");
        b.HasKey(e => e.Id);

        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.CrewGroupCode).HasColumnName("crew_group_code").HasMaxLength(50).IsRequired();
        b.Property(e => e.CrewUid).HasColumnName("crew_uid").HasMaxLength(128).IsRequired();
        b.Property(e => e.CrewTypeCode).HasColumnName("crew_type_code").HasMaxLength(50);
        b.Property(e => e.ActivityCode).HasColumnName("activity_code").HasMaxLength(50).IsRequired();
        b.Property(e => e.ActivityName).HasColumnName("activity_name").HasMaxLength(500).IsRequired();
        b.Property(e => e.WellId).HasColumnName("well_id").HasMaxLength(50);
        b.Property(e => e.ProjectId).HasColumnName("project_id").HasMaxLength(64);
        b.Property(e => e.PlannedStart).HasColumnName("planned_start");
        b.Property(e => e.PlannedEnd).HasColumnName("planned_end");
        b.Property(e => e.Progress).HasColumnName("progress").HasColumnType("decimal(5,2)").HasDefaultValue(0);
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("assigned").IsRequired();

        b.Property(e => e.IsDeleted).HasColumnName("is_deleted");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        b.Property(e => e.CreatedBy).HasColumnName("created_by");
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by");
        b.Property(e => e.DeletedBy).HasColumnName("deleted_by");

        b.HasQueryFilter(e => !e.IsDeleted);

        b.HasIndex(e => new { e.CrewUid, e.ActivityCode, e.WellId })
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_CrewActivityAssignment_Crew_Activity");

        b.HasIndex(e => e.CrewGroupCode)
            .HasFilter("[is_deleted] = 0")
            .HasDatabaseName("IX_CrewActivityAssignment_Group");
    }
}
