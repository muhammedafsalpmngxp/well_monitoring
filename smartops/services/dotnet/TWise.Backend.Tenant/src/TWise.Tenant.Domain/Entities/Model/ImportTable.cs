namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>A sheet loaded into a table of the [import] schema, and where it came from. Maps to [model].[ImportTable].</summary>
public class ImportTable
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long ConnectionId { get; set; }

    /// <summary>The table's name in [import]: a letter, then letters, digits and underscores.</summary>
    public string TableName { get; set; } = string.Empty;

    public string FileName { get; set; } = string.Empty;
    public string? SheetName { get; set; }

    /// <summary>Rows of the sheet, counted from 1 as in the spreadsheet.</summary>
    public int HeaderRow { get; set; }
    public int LastRow { get; set; }

    public int LoadedRows { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; }
}
