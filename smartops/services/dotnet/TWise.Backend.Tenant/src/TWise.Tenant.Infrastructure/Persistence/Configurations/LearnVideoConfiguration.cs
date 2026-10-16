using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

public sealed class LearnVideoConfiguration : IEntityTypeConfiguration<LearnVideo>
{
    public void Configure(EntityTypeBuilder<LearnVideo> builder)
    {
        builder.ToTable("LearnVideos", "core");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasColumnName("id");
        builder.Property(e => e.ScreenKey).HasColumnName("screen_key").HasMaxLength(50).IsRequired();
        builder.Property(e => e.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
        builder.Property(e => e.VideoUrl).HasColumnName("video_url").HasMaxLength(2000).IsRequired();
        builder.Property(e => e.PosterUrl).HasColumnName("poster_url").HasMaxLength(2000);
        builder.Property(e => e.ChaptersJson).HasColumnName("chapters_json");
        builder.Property(e => e.IsActive).HasColumnName("is_active");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.ModifiedAt).HasColumnName("modified_at");

        builder.HasIndex(e => e.ScreenKey).HasDatabaseName("IX_core_LearnVideos_screen_key");
    }
}
