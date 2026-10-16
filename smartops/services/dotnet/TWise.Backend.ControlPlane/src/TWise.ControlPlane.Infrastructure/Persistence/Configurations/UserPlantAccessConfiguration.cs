using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence.Configurations;

public class UserPlantAccessConfiguration : IEntityTypeConfiguration<UserPlantAccess>
{
    public void Configure(EntityTypeBuilder<UserPlantAccess> builder)
    {
        builder.ToTable("UserPlantAccess", "control");
        builder.HasKey(x => x.UserPlantAccessId);
        builder.Property(x => x.UserPlantAccessId).HasColumnName("user_plant_access_id");
        builder.Property(x => x.UserId).HasColumnName("user_id");
        builder.Property(x => x.PlantCode).HasColumnName("plant_code");
        builder.Property(x => x.IsActive).HasColumnName("is_active");
        builder.Property(x => x.IsDeleted).HasColumnName("is_deleted");
        builder.Property(x => x.DeletedAt).HasColumnName("deleted_at");
        builder.Property(x => x.CreatedAt).HasColumnName("created_at");
        builder.Property(x => x.ModifiedAt).HasColumnName("modified_at");

        builder.HasIndex(x => new { x.UserId, x.PlantCode }).IsUnique();
        builder.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
    }
}
