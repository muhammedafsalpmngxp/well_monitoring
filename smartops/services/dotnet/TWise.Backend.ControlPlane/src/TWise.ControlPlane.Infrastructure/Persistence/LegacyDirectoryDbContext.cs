using Microsoft.EntityFrameworkCore;
using TWise.Backend.ControlPlane.Domain.Entities.Legacy;

namespace TWise.Backend.ControlPlane.Infrastructure.Persistence;

public class LegacyDirectoryDbContext(DbContextOptions<LegacyDirectoryDbContext> options) : DbContext(options)
{
    public DbSet<LegacyEmployee> Employees => Set<LegacyEmployee>();
    public DbSet<LegacyEmployeeContact> EmployeeContacts => Set<LegacyEmployeeContact>();
    public DbSet<LegacyPlantDescription> PlantDescriptions => Set<LegacyPlantDescription>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<LegacyEmployee>(e =>
        {
            e.ToTable("employee", "ref");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).HasColumnName("id");
            e.Property(x => x.EmpUid).HasColumnName("emp_uid").HasMaxLength(50);
            e.Property(x => x.EmpName).HasColumnName("emp_name").HasMaxLength(200);
            e.Property(x => x.Email).HasColumnName("email").HasMaxLength(200);
            e.Property(x => x.EmpStatus).HasColumnName("emp_status");
            e.Property(x => x.LocationId).HasColumnName("location_id");
        });

        modelBuilder.Entity<LegacyEmployeeContact>(e =>
        {
            e.ToTable("employee_contact", "dbo");
            e.HasKey(x => x.EmployeeContactId);
            e.Property(x => x.EmployeeContactId).HasColumnName("employee_contact_id");
            e.Property(x => x.PersonnelNumber).HasColumnName("personnel_number");
            e.Property(x => x.EmployeeName).HasColumnName("employee_name").HasMaxLength(200);
            e.Property(x => x.PersonnelArea).HasColumnName("personnel_area").HasMaxLength(200);
            e.Property(x => x.MobileNumber).HasColumnName("mobile_number").HasMaxLength(50);
            e.Property(x => x.ClusterId).HasColumnName("cluster_id");
        });

        modelBuilder.Entity<LegacyPlantDescription>(e =>
        {
            e.ToTable("plant_description", "dbo");
            e.HasKey(x => x.PlantCode);
            e.Property(x => x.PlantCode).HasColumnName("plant_code");
            e.Property(x => x.PlantDesc).HasColumnName("plant_description").HasMaxLength(200);
            e.Property(x => x.Cluster).HasColumnName("cluster").HasMaxLength(100);
            e.Property(x => x.Division).HasColumnName("division").HasMaxLength(100);
            e.Property(x => x.BusinessUnit).HasColumnName("business_unit").HasMaxLength(100);
            e.Property(x => x.Sector).HasColumnName("sector").HasMaxLength(100);
            e.Property(x => x.Country).HasColumnName("country").HasMaxLength(100);
        });
    }
}
