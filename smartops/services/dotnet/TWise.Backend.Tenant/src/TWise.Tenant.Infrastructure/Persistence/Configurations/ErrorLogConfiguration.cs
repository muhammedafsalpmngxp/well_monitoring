using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class ErrorLogConfiguration : IEntityTypeConfiguration<ErrorLog>
{
    public void Configure(EntityTypeBuilder<ErrorLog> builder)
    {
        builder.ToTable("ErrorLog", "core");
        builder.HasKey(error => error.ErrorId);
        builder.Property(error => error.ErrorId).HasColumnName("error_id");
        builder.Property(error => error.RuleId).HasColumnName("rule_id");
        builder.Property(error => error.Status).HasColumnName("status");
        builder.Property(error => error.CreatedAt).HasColumnName("created_at");
        builder.Property(error => error.RecordsFound).HasColumnName("records_found");
        builder.Property(error => error.RecordsTotal).HasColumnName("records_total");
    }
}