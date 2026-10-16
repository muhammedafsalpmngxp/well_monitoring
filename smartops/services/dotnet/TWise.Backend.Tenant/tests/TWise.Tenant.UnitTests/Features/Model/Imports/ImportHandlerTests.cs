using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Imports;

public sealed class ImportHandlerTests
{
    private const long UserId = 9;

    // A workbook: a sheet with only a title, then the crew hours with a totals row.
    private static readonly ImportFile Workbook = new("Crew hours.xlsx", [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);

    private static readonly ImportSheet[] Sheets =
    [
        new("Cover", [["Crew hours, September"]]),
        new("Hours", [
            ["Crew", "crew_type_id", "Hours"],
            ["A1", 1.0, 8.0],
            ["B2", 2.0, 7.5],
            ["Total", null, 15.5],
        ]),
    ];

    private static readonly ImportOptions Load = new("Hours", 1, 3, ["text", "whole", "decimal"], "Crew_hours");

    private sealed record Setup(
        Mock<IDatasetRepository> Repo, Mock<IFileImportParserService> Parser, Mock<IImportTableStore> Store);

    private static Setup Make(DatasetParts? parts = null)
    {
        var repo = Repo(NewDataset(), parts ?? Parts());
        var parser = new Mock<IFileImportParserService>();
        parser.Setup(p => p.ReadSheets(It.IsAny<Stream>(), "xlsx", "Crew hours.xlsx", It.IsAny<string?>(), ImportRules.MaxSheetRows, ImportRules.MaxCells)).Returns(Sheets);
        var store = new Mock<IImportTableStore>();
        store.Setup(s => s.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((ImportTable table, ImportShape _, CancellationToken _) => table);
        store.Setup(s => s.UsagesAsync(4, TenantId, It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<(Dataset, DatasetParts)>());
        return new Setup(repo, parser, store);
    }

    [Fact]
    public async Task The_preview_opens_the_first_sheet_with_a_table_and_suggests_its_rows_types_and_name()
    {
        var s = Make();

        var result = await new PreviewImportHandler(s.Repo.Object, s.Parser.Object)
            .Handle(new PreviewImportQuery(1, Workbook, new ImportOptions(null, null, null, null, null), TenantId), default);

        // The Cover sheet has a title only, so the Hours sheet is the first one with data rows.
        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        result.Value!.Should().BeEquivalentTo(new
        {
            Sheets = new[] { "Cover", "Hours" }, Sheet = "Hours", SheetRows = 4, HeaderRow = 1, LastRow = 3, DataRows = 2,
            SuggestedTableName = "Crew_hours_Hours",
            Columns = new[] { new ImportColumn("Crew", "text"), new ImportColumn("crew_type_id", "whole"), new ImportColumn("Hours", "decimal") },
        });
    }

    [Fact]
    public async Task A_file_whose_content_does_not_match_its_extension_is_refused_before_it_is_read()
    {
        var s = Make();

        var result = await new PreviewImportHandler(s.Repo.Object, s.Parser.Object).Handle(
            new PreviewImportQuery(1, new ImportFile("Crew hours.xlsx", "Crew,Hours\n"u8.ToArray()), new ImportOptions(null, null, null, null, null), TenantId), default);

        result.ErrorMessage.Should().Be("Upload an Excel workbook (.xlsx or .xls) or a CSV file. The file's content must match its extension.");
        s.Parser.Verify(p => p.ReadSheets(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task Loading_writes_the_chosen_rows_as_a_table_on_the_datasets_connection()
    {
        var s = Make();

        var result = await new CreateImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new CreateImportCommand(1, Workbook, Load, TenantId, UserId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        result.Value!.Should().BeEquivalentTo(new { TableName = "Crew_hours", FileName = "Crew hours.xlsx", SheetName = "Hours", HeaderRow = 1, LastRow = 3 });
        s.Store.Verify(x => x.WriteAsync(
            It.Is<ImportTable>(t => t.Id == 0 && t.ConnectionId == 4 && t.TenantId == TenantId && t.CreatedBy == UserId),
            It.Is<ImportShape>(shape => shape.Rows.Count == 2 && (long)shape.Rows[1][1]! == 2L),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Loading_is_refused_on_a_data_model_that_reads_another_database()
    {
        var s = Make();
        var other = NewDataset();
        other.ConnectionId = 10005;
        s.Repo.Setup(r => r.GetAsync(1, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(other);

        var result = await new CreateImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new CreateImportCommand(1, Workbook, Load, TenantId, UserId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("Files load into the tenant database, so they can be added only to a data model on it. This data model reads AlTasnimBI.");
        s.Store.Verify(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Replacing_is_refused_on_a_data_model_that_reads_another_database()
    {
        var s = Make();
        var other = NewDataset();
        other.ConnectionId = 10005;
        s.Repo.Setup(r => r.GetAsync(1, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(other);

        var result = await new ReplaceImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new ReplaceImportCommand(1, 3, Workbook, Load, TenantId, UserId), default);

        result.IsValidationError.Should().BeTrue();
        s.Store.Verify(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("crew hours")]
    [InlineData(null)]
    public async Task A_table_name_that_is_not_allowed_is_refused(string? tableName)
    {
        var s = Make();

        var result = await new CreateImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new CreateImportCommand(1, Workbook, Load with { TableName = tableName }, TenantId, UserId), default);

        result.IsValidationError.Should().BeTrue();
        s.Store.Verify(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Column_names_the_database_treats_as_the_same_are_a_validation_error()
    {
        var s = Make();
        s.Store.Setup(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new DuplicateImportColumnException());

        var result = await new CreateImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new CreateImportCommand(1, Workbook, Load, TenantId, UserId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("Two column headers of the sheet count as the same name in the database. Rename one of them in the file and upload it again.");
    }

    [Fact]
    public async Task Column_names_the_database_treats_as_the_same_are_a_validation_error_on_a_replace()
    {
        var s = Make();
        s.Store.Setup(x => x.GetAsync(3, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(Existing());
        s.Store.Setup(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new DuplicateImportColumnException());

        var result = await new ReplaceImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new ReplaceImportCommand(1, 3, Workbook, Load with { TableName = null }, TenantId, UserId), default);

        result.IsValidationError.Should().BeTrue();
    }

    /// <summary>A dataset whose only use of import.Crew_hours is through the stored SQL of a view source.</summary>
    private static Setup ReadThroughAView()
    {
        var hours = new DatasetSource
        {
            Id = 6, DatasetId = 1, SourceKind = "view", SchemaName = "view", SourceName = "12", Alias = "Hours view", RlsMode = "none",
            ViewSql = "SELECT h.Crew, h.Hours FROM [IMPORT].[crew_HOURS] AS h",
        };
        var parts = Parts(Tasks(), hours);
        var s = Make(parts);
        s.Store.Setup(x => x.GetAsync(3, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(Existing());
        s.Store.Setup(x => x.UsagesAsync(4, TenantId, "Crew_hours", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { (NewDataset(), parts) });
        s.Repo.Setup(r => r.GetColumnsAsync(4, TenantId, It.Is<IReadOnlyCollection<string>>(t => t.Contains("Crew_hours")), It.IsAny<CancellationToken>()))
            .ReturnsAsync([
                new CatalogColumn("import", "Crew_hours", "Crew", false, false, null, null, null, "nvarchar"),
                new CatalogColumn("import", "Crew_hours", "crew_type_id", false, false, null, null, null, "bigint"),
                new CatalogColumn("import", "Crew_hours", "Hours", false, false, null, null, null, "decimal"),
            ]);
        return s;
    }

    [Fact]
    public async Task Replacing_a_table_a_view_source_reads_is_refused_when_a_column_goes_away()
    {
        var s = ReadThroughAView();
        s.Parser.Setup(p => p.ReadSheets(It.IsAny<Stream>(), "xlsx", "Crew hours.xlsx", It.IsAny<string?>(), ImportRules.MaxSheetRows, ImportRules.MaxCells))
            .Returns([new ImportSheet("Hours", [["Crew", "Hours"], ["A1", 8.0]])]);

        var result = await new ReplaceImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new ReplaceImportCommand(1, 3, Workbook, new ImportOptions("Hours", 1, 2, ["text", "decimal"], null), TenantId, UserId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("Hours view").And.Contain("crew_type_id");
        s.Store.Verify(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Replacing_the_rows_of_a_table_a_view_source_reads_is_allowed_when_its_columns_stay()
    {
        var s = ReadThroughAView();

        var result = await new ReplaceImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new ReplaceImportCommand(1, 3, Workbook, Load with { TableName = null }, TenantId, UserId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
    }

    [Fact]
    public void A_view_source_reads_an_import_table_only_when_its_stored_sql_names_that_table()
    {
        var reads = new DatasetSource { Id = 1, SourceKind = "view", Alias = "A", ViewSql = "SELECT h.Crew FROM [IMPORT].[crew_HOURS] AS h" };
        var other = new DatasetSource { Id = 2, SourceKind = "view", Alias = "B", ViewSql = "SELECT h.Crew FROM import.Crew_hours_2 AS h" };
        var legacy = new DatasetSource { Id = 3, SourceKind = "view", Alias = "C" };
        var script = new DatasetSource { Id = 4, SourceKind = "script", Alias = "D", ViewSql = "DECLARE @x INT = 1; SELECT h.Crew FROM import.Crew_hours AS h" };

        ImportRules.ViewSourcesReading(Parts(reads, other, legacy, script), "Crew_hours").Select(v => v.Alias).Should().Equal("A", "D");
    }

    [Fact]
    public async Task A_taken_table_name_is_a_conflict()
    {
        var s = Make();
        s.Store.Setup(x => x.NameTakenAsync("Crew_hours", It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var result = await new CreateImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new CreateImportCommand(1, Workbook, Load, TenantId, UserId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be("A loaded table called Crew_hours already exists. Choose another name, or replace that table.");
    }

    private static ImportTable Existing() => new()
    {
        Id = 3, TenantId = TenantId, ConnectionId = 4, TableName = "Crew_hours", FileName = "Crew hours old.xlsx", SheetName = "Hours",
        HeaderRow = 1, LastRow = 3, LoadedRows = 2,
    };

    [Fact]
    public async Task Replacing_keeps_the_table_name_and_writes_the_new_rows()
    {
        var s = Make();
        var existing = Existing();
        s.Store.Setup(x => x.GetAsync(3, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(existing);

        var result = await new ReplaceImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new ReplaceImportCommand(1, 3, Workbook, Load with { TableName = "Ignored" }, TenantId, UserId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        result.Value!.TableName.Should().Be("Crew_hours");
        existing.FileName.Should().Be("Crew hours.xlsx");
        existing.ModifiedBy.Should().Be(UserId);
        s.Store.Verify(x => x.WriteAsync(existing, It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Replacing_is_refused_when_a_dataset_would_lose_a_column_it_relates_on()
    {
        var upload = new DatasetSource
            { Id = 5, DatasetId = 1, SourceKind = "table", SchemaName = "import", SourceName = "Crew_hours", Alias = "Hours", RlsMode = "none" };
        var relationship = new DatasetRelationship
        {
            Id = 12, DatasetId = 1, FromSourceId = 5, FromColumn = "crew_type_id", ToSourceId = 2, ToColumn = "crew_type_id",
            Cardinality = "many_to_one", IsActive = true, DetectedFrom = "user",
        };
        var parts = Parts(Tasks(), Crews(), upload, relationship);
        var s = Make(parts);
        s.Store.Setup(x => x.GetAsync(3, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(Existing());
        s.Store.Setup(x => x.UsagesAsync(4, TenantId, "Crew_hours", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { (NewDataset(), parts) });
        // The new file has no crew_type_id column.
        s.Parser.Setup(p => p.ReadSheets(It.IsAny<Stream>(), "xlsx", "Crew hours.xlsx", It.IsAny<string?>(), ImportRules.MaxSheetRows, ImportRules.MaxCells))
            .Returns([new ImportSheet("Hours", [["Crew", "Hours"], ["A1", 8.0]])]);

        var result = await new ReplaceImportHandler(s.Repo.Object, s.Parser.Object, s.Store.Object)
            .Handle(new ReplaceImportCommand(1, 3, Workbook, new ImportOptions("Hours", 1, 2, ["text", "decimal"], null), TenantId, UserId), default);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Be(
            "The data model \"Slice check\" relates Hours on the column crew_type_id, which the new file does not have. Keep those columns in the new file, or change the data model first.");
        s.Store.Verify(x => x.WriteAsync(It.IsAny<ImportTable>(), It.IsAny<ImportShape>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Only_the_sheet_the_options_name_is_read()
    {
        var s = Make();

        await new PreviewImportHandler(s.Repo.Object, s.Parser.Object).Handle(new PreviewImportQuery(1, Workbook, Load, TenantId), default);

        s.Parser.Verify(p => p.ReadSheets(It.IsAny<Stream>(), "xlsx", "Crew hours.xlsx", "Hours", ImportRules.MaxSheetRows, ImportRules.MaxCells));
    }

    [Fact]
    public async Task A_workbook_that_unpacks_to_too_much_data_is_refused_in_plain_words()
    {
        var s = Make();
        s.Parser.Setup(p => p.ReadSheets(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<int>(), It.IsAny<int>()))
            .Throws(new ImportTooLargeException());

        var result = await new PreviewImportHandler(s.Repo.Object, s.Parser.Object).Handle(new PreviewImportQuery(1, Workbook, Load, TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be("The workbook holds more than 100 MB of data once unpacked. Split it into smaller files.");
    }

    [Fact]
    public async Task The_list_holds_the_uploads_on_the_datasets_connection()
    {
        var s = Make();
        s.Store.Setup(x => x.ListAsync(4, TenantId, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { Existing() });

        var result = await new ListImportsHandler(s.Repo.Object, s.Store.Object).Handle(new ListImportsQuery(1, TenantId), default);

        result.Value!.Select(t => (t.Id, t.TableName, t.LoadedRows)).Should().Equal((3L, "Crew_hours", 2));
    }

    [Fact]
    public void Loading_and_replacing_drop_the_cached_datasets_of_the_tenant_because_they_change_the_catalogue()
    {
        new CreateImportCommand(1, Workbook, Load, TenantId, UserId).Should().BeAssignableTo<IChangesConnection>();
        new ReplaceImportCommand(1, 3, Workbook, Load, TenantId, UserId).Should().BeAssignableTo<IChangesConnection>();
    }
}
