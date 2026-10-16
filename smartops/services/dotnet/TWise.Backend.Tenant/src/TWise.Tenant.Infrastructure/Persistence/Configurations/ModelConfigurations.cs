using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TWise.Tenant.Domain.Entities.Model;

namespace TWise.Tenant.Infrastructure.Persistence.Configurations;

// The model schema is created by infra/sql/model/001-create-model-schema.sql and extended by
// 003-calculated-columns-and-transforms.sql and 004-import-schema.sql, not by EF.

public sealed class DatasetConfiguration : IEntityTypeConfiguration<Dataset>
{
    public void Configure(EntityTypeBuilder<Dataset> builder)
    {
        builder.ToTable("Dataset", "model");
        builder.HasKey(e => e.Id);
        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}

public sealed class DatasetSourceConfiguration : IEntityTypeConfiguration<DatasetSource>
{
    public void Configure(EntityTypeBuilder<DatasetSource> builder)
    {
        builder.ToTable("DatasetSource", "model");
        builder.HasKey(e => e.Id);
    }
}

public sealed class DatasetRelationshipConfiguration : IEntityTypeConfiguration<DatasetRelationship>
{
    public void Configure(EntityTypeBuilder<DatasetRelationship> builder)
    {
        builder.ToTable("Relationship", "model");
        builder.HasKey(e => e.Id);
    }
}

public sealed class DatasetMeasureConfiguration : IEntityTypeConfiguration<DatasetMeasure>
{
    public void Configure(EntityTypeBuilder<DatasetMeasure> builder)
    {
        builder.ToTable("Measure", "model");
        builder.HasKey(e => e.Id);
    }
}

public sealed class DatasetCalculatedColumnConfiguration : IEntityTypeConfiguration<DatasetCalculatedColumn>
{
    public void Configure(EntityTypeBuilder<DatasetCalculatedColumn> builder)
    {
        builder.ToTable("CalculatedColumn", "model");
        builder.HasKey(e => e.Id);
    }
}

public sealed class DatasetTransformConfiguration : IEntityTypeConfiguration<DatasetTransform>
{
    public void Configure(EntityTypeBuilder<DatasetTransform> builder)
    {
        builder.ToTable("Transform", "model");
        builder.HasKey(e => e.Id);
    }
}

public sealed class ImportTableConfiguration : IEntityTypeConfiguration<ImportTable>
{
    public void Configure(EntityTypeBuilder<ImportTable> builder)
    {
        builder.ToTable("ImportTable", "model");
        builder.HasKey(e => e.Id);
    }
}

public sealed class BrandKitConfiguration : IEntityTypeConfiguration<BrandKit>
{
    public void Configure(EntityTypeBuilder<BrandKit> builder)
    {
        builder.ToTable("BrandKit", "model");
        builder.HasKey(e => e.Id);
        builder.HasQueryFilter(e => !e.IsDeleted);
    }
}
