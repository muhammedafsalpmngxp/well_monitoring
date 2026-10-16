using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

// The delivery schema is created by infra/sql/model/012-scheduled-deliveries.sql, not by EF.

public sealed class ScheduleConfiguration : IEntityTypeConfiguration<Schedule>
{
    public void Configure(EntityTypeBuilder<Schedule> builder)
    {
        builder.ToTable("Schedule", "delivery");
        builder.HasKey(e => e.Id);
        builder.HasQueryFilter(e => !e.IsDeleted);
        builder.HasMany(e => e.Recipients).WithOne().HasForeignKey(r => r.ScheduleId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class ScheduleRecipientConfiguration : IEntityTypeConfiguration<ScheduleRecipient>
{
    public void Configure(EntityTypeBuilder<ScheduleRecipient> builder)
    {
        builder.ToTable("ScheduleRecipient", "delivery");
        builder.HasKey(e => e.Id);
    }
}

public sealed class MailGroupConfiguration : IEntityTypeConfiguration<MailGroup>
{
    public void Configure(EntityTypeBuilder<MailGroup> builder)
    {
        builder.ToTable("MailGroup", "delivery");
        builder.HasKey(e => e.Id);
        builder.HasQueryFilter(e => !e.IsDeleted);
        builder.HasMany(e => e.Members).WithOne().HasForeignKey(m => m.MailGroupId).OnDelete(DeleteBehavior.Cascade);
    }
}

public sealed class MailGroupMemberConfiguration : IEntityTypeConfiguration<MailGroupMember>
{
    public void Configure(EntityTypeBuilder<MailGroupMember> builder)
    {
        builder.ToTable("MailGroupMember", "delivery");
        builder.HasKey(e => e.Id);
    }
}

public sealed class ScheduleRunConfiguration : IEntityTypeConfiguration<ScheduleRun>
{
    public void Configure(EntityTypeBuilder<ScheduleRun> builder)
    {
        builder.ToTable("ScheduleRun", "delivery");
        builder.HasKey(e => e.Id);
    }
}
