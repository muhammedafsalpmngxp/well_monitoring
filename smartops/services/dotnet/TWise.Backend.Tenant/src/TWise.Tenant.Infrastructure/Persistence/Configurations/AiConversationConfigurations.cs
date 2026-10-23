using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

/// <summary>Maps to [core].[AiConversations] (see infra/sql/add-ai-conversations.sql).</summary>
public sealed class AiConversationConfiguration : IEntityTypeConfiguration<AiConversation>
{
    public void Configure(EntityTypeBuilder<AiConversation> b)
    {
        b.ToTable("AiConversations", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.UserId).HasColumnName("user_id").HasMaxLength(100).IsRequired();
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.SourceName).HasColumnName("source_name").HasMaxLength(200).IsRequired();
        b.Property(e => e.Title).HasColumnName("title").HasMaxLength(120).IsRequired();
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.ModifiedAt).HasColumnName("modified_at");
        b.Property(e => e.IsDeleted).HasColumnName("is_deleted");
        b.HasQueryFilter(e => !e.IsDeleted);
    }
}

/// <summary>Maps to [core].[AiChatMessages].</summary>
public sealed class AiChatMessageConfiguration : IEntityTypeConfiguration<AiChatMessage>
{
    public void Configure(EntityTypeBuilder<AiChatMessage> b)
    {
        b.ToTable("AiChatMessages", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.ConversationId).HasColumnName("conversation_id");
        b.Property(e => e.Role).HasColumnName("role").HasMaxLength(10).IsRequired();
        b.Property(e => e.Content).HasColumnName("content").IsRequired();
        b.Property(e => e.QuerySpecJson).HasColumnName("query_spec_json");
        b.Property(e => e.AnswerJson).HasColumnName("answer_json");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
    }
}

public sealed class AiAlertConfiguration : IEntityTypeConfiguration<AiAlert>
{
    public void Configure(EntityTypeBuilder<AiAlert> b)
    {
        b.ToTable("AiAlerts", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.UserId).HasColumnName("user_id").HasMaxLength(100).IsRequired();
        b.Property(e => e.SourceType).HasColumnName("source_type").HasMaxLength(10).IsRequired();
        b.Property(e => e.SourceId).HasColumnName("source_id");
        b.Property(e => e.SourceName).HasColumnName("source_name").HasMaxLength(200).IsRequired();
        b.Property(e => e.Question).HasColumnName("question").HasMaxLength(2000).IsRequired();
        b.Property(e => e.QuerySpecJson).HasColumnName("query_spec_json").IsRequired();
        b.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(10).IsRequired();
        b.Property(e => e.Threshold).HasColumnName("threshold");
        b.Property(e => e.EveryHours).HasColumnName("every_hours");
        b.Property(e => e.NotifyEmails).HasColumnName("notify_emails").HasMaxLength(1000);
        b.Property(e => e.IsTriggered).HasColumnName("is_triggered");
        b.Property(e => e.LastMessage).HasColumnName("last_message").HasMaxLength(1000);
        b.Property(e => e.HistoryJson).HasColumnName("history_json");
        b.Property(e => e.LastCheckedAt).HasColumnName("last_checked_at");
        b.Property(e => e.NextCheckAt).HasColumnName("next_check_at");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
    }
}

public sealed class AiTraceConfiguration : IEntityTypeConfiguration<AiTrace>
{
    public void Configure(EntityTypeBuilder<AiTrace> b)
    {
        b.ToTable("AiTraces", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.MessageId).HasColumnName("message_id");
        b.Property(e => e.TraceJson).HasColumnName("trace_json").IsRequired();
        b.Property(e => e.RejectionsJson).HasColumnName("rejections_json");
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
    }
}
