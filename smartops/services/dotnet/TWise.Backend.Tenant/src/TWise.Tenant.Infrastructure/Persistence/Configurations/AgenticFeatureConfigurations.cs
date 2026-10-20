using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

// Agentic Features tables (see infra/sql/add-agentic-features.sql). Schema is SQL-managed.

public sealed class AiFeatureQueryConfiguration : IEntityTypeConfiguration<AiFeatureQuery>
{
    public void Configure(EntityTypeBuilder<AiFeatureQuery> b)
    {
        b.ToTable("AiFeatureQuery", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.Feature).HasColumnName("feature").HasMaxLength(40);
        b.Property(e => e.QueryKey).HasColumnName("query_key").HasMaxLength(80);
        b.Property(e => e.Label).HasColumnName("label").HasMaxLength(200);
        b.Property(e => e.Description).HasColumnName("description").HasMaxLength(1000);
        b.Property(e => e.SqlText).HasColumnName("sql_text");
        b.Property(e => e.ParamsJson).HasColumnName("params_json").HasMaxLength(1000);
        b.Property(e => e.ColumnsJson).HasColumnName("columns_json");
        b.Property(e => e.SeedHash).HasColumnName("seed_hash").HasMaxLength(64).IsFixedLength();
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(200);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        b.HasIndex(e => new { e.TenantId, e.Feature, e.QueryKey }).IsUnique();
    }
}

public sealed class AiFeatureJobConfiguration : IEntityTypeConfiguration<AiFeatureJob>
{
    public void Configure(EntityTypeBuilder<AiFeatureJob> b)
    {
        b.ToTable("AiFeatureJob", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.Feature).HasColumnName("feature").HasMaxLength(40);
        b.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(40);
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        b.Property(e => e.RequestJson).HasColumnName("request_json");
        b.Property(e => e.ProgressJson).HasColumnName("progress_json");
        b.Property(e => e.ResultJson).HasColumnName("result_json");
        b.Property(e => e.Error).HasColumnName("error").HasMaxLength(4000);
        b.Property(e => e.RequestedBy).HasColumnName("requested_by").HasMaxLength(200);
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.StartedAt).HasColumnName("started_at");
        b.Property(e => e.FinishedAt).HasColumnName("finished_at");
        b.Property(e => e.HeartbeatAt).HasColumnName("heartbeat_at");
    }
}

public sealed class AnomalyRuleConfiguration : IEntityTypeConfiguration<AnomalyRule>
{
    public void Configure(EntityTypeBuilder<AnomalyRule> b)
    {
        b.ToTable("AnomalyRule", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.RuleId).HasColumnName("rule_id").HasMaxLength(80);
        b.Property(e => e.Title).HasColumnName("title").HasMaxLength(400);
        b.Property(e => e.Category).HasColumnName("category").HasMaxLength(100);
        b.Property(e => e.Severity).HasColumnName("severity").HasMaxLength(20);
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        b.Property(e => e.Source).HasColumnName("source").HasMaxLength(20);
        b.Property(e => e.DefinitionJson).HasColumnName("definition_json");
        b.Property(e => e.SeedHash).HasColumnName("seed_hash").HasMaxLength(64).IsFixedLength();
        b.Property(e => e.CreatedBy).HasColumnName("created_by").HasMaxLength(200);
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(200);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        b.HasIndex(e => new { e.TenantId, e.RuleId }).IsUnique();
    }
}

public sealed class AnomalyProbeConfiguration : IEntityTypeConfiguration<AnomalyProbe>
{
    public void Configure(EntityTypeBuilder<AnomalyProbe> b)
    {
        b.ToTable("AnomalyProbe", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.ProbeId).HasColumnName("probe_id").HasMaxLength(200);
        b.Property(e => e.RuleId).HasColumnName("rule_id").HasMaxLength(80);
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        b.Property(e => e.ProbeJson).HasColumnName("probe_json");
        b.Property(e => e.CompiledAt).HasColumnName("compiled_at");
        b.HasIndex(e => new { e.TenantId, e.ProbeId }).IsUnique();
    }
}

public sealed class AnomalyRunConfiguration : IEntityTypeConfiguration<AnomalyRun>
{
    public void Configure(EntityTypeBuilder<AnomalyRun> b)
    {
        b.ToTable("AnomalyRun", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.RunId).HasColumnName("run_id").HasMaxLength(40);
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        b.Property(e => e.DatabaseName).HasColumnName("database_name").HasMaxLength(200);
        b.Property(e => e.StartedAt).HasColumnName("started_at");
        b.Property(e => e.FinishedAt).HasColumnName("finished_at");
        b.Property(e => e.Score).HasColumnName("score").HasPrecision(6, 2);
        b.Property(e => e.ProbesRun).HasColumnName("probes_run");
        b.Property(e => e.RecordsExamined).HasColumnName("records_examined");
        b.Property(e => e.RecordsFlagged).HasColumnName("records_flagged");
        b.Property(e => e.RuleSetFingerprint).HasColumnName("rule_set_fingerprint").HasMaxLength(40);
        b.Property(e => e.ResultJson).HasColumnName("result_json");
        b.Property(e => e.Error).HasColumnName("error").HasMaxLength(4000);
        b.Property(e => e.StartedBy).HasColumnName("started_by").HasMaxLength(200);
        b.HasIndex(e => new { e.TenantId, e.RunId }).IsUnique();
    }
}

public sealed class AnomalyRunReportConfiguration : IEntityTypeConfiguration<AnomalyRunReport>
{
    public void Configure(EntityTypeBuilder<AnomalyRunReport> b)
    {
        b.ToTable("AnomalyRunReport", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.RunId).HasColumnName("run_id").HasMaxLength(40);
        b.Property(e => e.Format).HasColumnName("format").HasMaxLength(10);
        b.Property(e => e.FileName).HasColumnName("file_name").HasMaxLength(200);
        b.Property(e => e.Content).HasColumnName("content");
        b.Property(e => e.SizeBytes).HasColumnName("size_bytes");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.HasIndex(e => new { e.TenantId, e.RunId, e.Format }).IsUnique();
    }
}

public sealed class AnomalyProposalConfiguration : IEntityTypeConfiguration<AnomalyProposal>
{
    public void Configure(EntityTypeBuilder<AnomalyProposal> b)
    {
        b.ToTable("AnomalyProposal", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.ProposalHash).HasColumnName("proposal_hash").HasMaxLength(64);
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        b.Property(e => e.Title).HasColumnName("title").HasMaxLength(400);
        b.Property(e => e.ProposalJson).HasColumnName("proposal_json");
        b.Property(e => e.RuleId).HasColumnName("rule_id").HasMaxLength(80);
        b.Property(e => e.Reason).HasColumnName("reason").HasMaxLength(1000);
        b.Property(e => e.DecidedBy).HasColumnName("decided_by").HasMaxLength(200);
        b.Property(e => e.DecidedAt).HasColumnName("decided_at");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.HasIndex(e => new { e.TenantId, e.ProposalHash }).IsUnique();
    }
}
