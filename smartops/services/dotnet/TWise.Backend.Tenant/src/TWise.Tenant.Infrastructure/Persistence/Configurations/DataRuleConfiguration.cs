using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class DataRuleConfiguration : IEntityTypeConfiguration<DataRule>
{
    public void Configure(EntityTypeBuilder<DataRule> builder)
    {
        builder.ToTable("DataRules", "core");
        builder.HasKey(rule => rule.RuleId);
        builder.Property(rule => rule.RuleId).HasColumnName("rule_id");
        builder.Property(rule => rule.Category).HasColumnName("category");
        builder.Property(rule => rule.RuleName).HasColumnName("rule_name");
        builder.Property(rule => rule.TableName).HasColumnName("table_name");
        builder.Property(rule => rule.Fields).HasColumnName("fields");
        builder.Property(rule => rule.SourceType).HasColumnName("source_type");
        builder.Property(rule => rule.ViewId).HasColumnName("view_id");
        builder.Property(rule => rule.ReliabilityScore).HasColumnName("reliability_score").HasPrecision(5, 2);
        builder.Property(rule => rule.TriggeredOn).HasColumnName("triggered_on");
        builder.HasMany(rule => rule.ErrorLogs)
            .WithOne(error => error.Rule)
            .HasForeignKey(error => error.RuleId)
            .HasPrincipalKey(rule => rule.RuleId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}