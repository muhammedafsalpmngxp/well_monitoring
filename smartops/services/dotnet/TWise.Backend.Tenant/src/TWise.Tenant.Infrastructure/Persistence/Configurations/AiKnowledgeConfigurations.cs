using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

/// <summary>Maps to [core].[AiDatasetNotes] (see infra/sql/add-ai-knowledge.sql).</summary>
public sealed class AiDatasetRelationConfiguration : IEntityTypeConfiguration<AiDatasetRelation>
{
    public void Configure(EntityTypeBuilder<AiDatasetRelation> b)
    {
        b.ToTable("AiDatasetRelations", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.FromType).HasColumnName("from_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.FromId).HasColumnName("from_id");
        b.Property(e => e.FromName).HasColumnName("from_name").HasMaxLength(200).IsRequired();
        b.Property(e => e.FromColumn).HasColumnName("from_column").HasMaxLength(200).IsRequired();
        b.Property(e => e.ToType).HasColumnName("to_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.ToId).HasColumnName("to_id");
        b.Property(e => e.ToName).HasColumnName("to_name").HasMaxLength(200).IsRequired();
        b.Property(e => e.ToColumn).HasColumnName("to_column").HasMaxLength(200).IsRequired();
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(10).IsRequired();
        b.Property(e => e.Overlap).HasColumnName("overlap");
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(100);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
    }
}

public sealed class AiDatasetPromptConfiguration : IEntityTypeConfiguration<AiDatasetPrompt>
{
    public void Configure(EntityTypeBuilder<AiDatasetPrompt> b)
    {
        b.ToTable("AiDatasetPrompts", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.Key).HasColumnName("prompt_key").HasMaxLength(40).IsRequired();
        b.Property(e => e.Text).HasColumnName("prompt_text").HasMaxLength(4000).IsRequired();
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(100);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
    }
}

public sealed class AiDatasetNoteConfiguration : IEntityTypeConfiguration<AiDatasetNote>
{
    public void Configure(EntityTypeBuilder<AiDatasetNote> b)
    {
        b.ToTable("AiDatasetNotes", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.ColumnName).HasColumnName("column_name").HasMaxLength(200);
        b.Property(e => e.Note).HasColumnName("note").HasMaxLength(1000).IsRequired();
        b.Property(e => e.DisplayName).HasColumnName("display_name").HasMaxLength(200);
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(100);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
    }
}

/// <summary>Maps to [core].[AiMetrics].</summary>
public sealed class AiMetricConfiguration : IEntityTypeConfiguration<AiMetric>
{
    public void Configure(EntityTypeBuilder<AiMetric> b)
    {
        b.ToTable("AiMetrics", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
        b.Property(e => e.Agg).HasColumnName("agg").HasMaxLength(20).IsRequired();
        b.Property(e => e.ColumnName).HasColumnName("column_name").HasMaxLength(200);
        b.Property(e => e.Description).HasColumnName("description").HasMaxLength(500);
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(100);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
    }
}

/// <summary>Maps to [core].[AiTerms].</summary>
public sealed class AiTermConfiguration : IEntityTypeConfiguration<AiTerm>
{
    public void Configure(EntityTypeBuilder<AiTerm> b)
    {
        b.ToTable("AiTerms", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.Term).HasColumnName("term").HasMaxLength(100).IsRequired();
        b.Property(e => e.Synonyms).HasColumnName("synonyms").HasMaxLength(500);
        b.Property(e => e.ColumnName).HasColumnName("column_name").HasMaxLength(200);
        b.Property(e => e.Value).HasColumnName("value").HasMaxLength(400);
        b.Property(e => e.Meaning).HasColumnName("meaning").HasMaxLength(500);
        b.Property(e => e.ModifiedBy).HasColumnName("modified_by").HasMaxLength(100);
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
    }
}

/// <summary>Maps to [core].[AiNoteProposals].</summary>
public sealed class AiNoteProposalConfiguration : IEntityTypeConfiguration<AiNoteProposal>
{
    public void Configure(EntityTypeBuilder<AiNoteProposal> b)
    {
        b.ToTable("AiNoteProposals", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.ColumnName).HasColumnName("column_name").HasMaxLength(200);
        b.Property(e => e.Note).HasColumnName("note").HasMaxLength(1000).IsRequired();
        b.Property(e => e.Confidence).HasColumnName("confidence").HasMaxLength(10).IsRequired();
        b.Property(e => e.Question).HasColumnName("question").HasMaxLength(2000).IsRequired();
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(10).IsRequired();
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.ReviewedBy).HasColumnName("reviewed_by").HasMaxLength(100);
        b.Property(e => e.ReviewedAt).HasColumnName("reviewed_at");
    }
}

/// <summary>Maps to [core].[AiExamples].</summary>
public sealed class AiExampleConfiguration : IEntityTypeConfiguration<AiExample>
{
    public void Configure(EntityTypeBuilder<AiExample> b)
    {
        b.ToTable("AiExamples", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.MessageId).HasColumnName("message_id");
        b.Property(e => e.Question).HasColumnName("question").HasMaxLength(2000).IsRequired();
        b.Property(e => e.QuerySpecJson).HasColumnName("query_spec_json").IsRequired();
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
        b.Property(e => e.Review).HasColumnName("review").HasMaxLength(500);
        b.Property(e => e.CreatedBy).HasColumnName("created_by").HasMaxLength(100).IsRequired();
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
    }
}
