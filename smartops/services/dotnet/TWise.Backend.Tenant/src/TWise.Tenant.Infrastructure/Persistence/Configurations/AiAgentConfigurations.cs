using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class AiAgentConfiguration : IEntityTypeConfiguration<AiAgent>
{
    public void Configure(EntityTypeBuilder<AiAgent> b)
    {
        b.ToTable("AiAgents", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        b.Property(e => e.Role).HasColumnName("role").HasMaxLength(200);
        b.Property(e => e.Description).HasColumnName("description").HasMaxLength(1000);
        b.Property(e => e.SystemPrompt).HasColumnName("system_prompt");
        b.Property(e => e.Goal).HasColumnName("goal").HasMaxLength(1000);
        b.Property(e => e.StepsJson).HasColumnName("steps_json").IsRequired();
        b.Property(e => e.ToolsJson).HasColumnName("tools_json").IsRequired();
        b.Property(e => e.InputsJson).HasColumnName("inputs_json").IsRequired();
        b.Property(e => e.OutputsJson).HasColumnName("outputs_json").IsRequired();
        b.Property(e => e.AskDataJson).HasColumnName("ask_data_json");
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
        b.Property(e => e.AgentState).HasColumnName("agent_state").HasMaxLength(20).IsRequired();
        b.Property(e => e.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        b.Property(e => e.MaxIterations).HasColumnName("max_iterations");
        b.Property(e => e.CreatedBy).HasColumnName("created_by").HasMaxLength(200).IsRequired();
        b.Property(e => e.CreatedAt).HasColumnName("created_at");
        b.Property(e => e.UpdatedAt).HasColumnName("updated_at");
    }
}

public sealed class AiAgentRunConfiguration : IEntityTypeConfiguration<AiAgentRun>
{
    public void Configure(EntityTypeBuilder<AiAgentRun> b)
    {
        b.ToTable("AiAgentRuns", "core");
        b.HasKey(e => e.Id);
        b.Property(e => e.Id).HasColumnName("id");
        b.Property(e => e.TenantId).HasColumnName("tenant_id");
        b.Property(e => e.AgentId).HasColumnName("agent_id");
        b.Property(e => e.AgentName).HasColumnName("agent_name").HasMaxLength(200).IsRequired();
        b.Property(e => e.RunBy).HasColumnName("run_by").HasMaxLength(200).IsRequired();
        b.Property(e => e.InputsJson).HasColumnName("inputs_json").IsRequired();
        b.Property(e => e.StepsJson).HasColumnName("steps_json");
        b.Property(e => e.Answer).HasColumnName("answer");
        b.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
        b.Property(e => e.Error).HasColumnName("error").HasMaxLength(1000);
        b.Property(e => e.Seconds).HasColumnName("seconds");
        b.Property(e => e.StartedAt).HasColumnName("started_at");
        b.Property(e => e.InputTokens).HasColumnName("input_tokens");     // infra/sql/add-ai-agents.sql
        b.Property(e => e.OutputTokens).HasColumnName("output_tokens");
        b.Property(e => e.TotalTokens).HasColumnName("total_tokens");
    }
}
