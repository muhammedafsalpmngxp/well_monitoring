using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using TWise.Tenant.Application.Features.Delivery;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// An Excel workbook with a sheet per table: a bold, frozen header row, then the rows. Numbers stay numbers and ISO
/// dates become dates, as the canvas export writes them, so Excel can sort and add them up. Text is never a formula.
/// </summary>
public static partial class DeliveryWorkbook
{
    public const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$")]
    private static partial Regex IsoDate();

    public static byte[] Write(IReadOnlyList<DeliveryTable> tables)
    {
        using var book = new XLWorkbook();
        foreach (var table in tables)
        {
            var sheet = book.Worksheets.Add(SheetName(table.Name, book));
            for (var c = 0; c < table.Headers.Count; c++) sheet.Cell(1, c + 1).Value = table.Headers[c];
            sheet.Row(1).Style.Font.Bold = true;
            sheet.SheetView.FreezeRows(1);
            for (var r = 0; r < table.Rows.Count; r++)
                for (var c = 0; c < table.Columns.Count; c++)
                    sheet.Cell(r + 2, c + 1).Value = Value(table.Rows[r].GetValueOrDefault(table.Columns[c]));
            if (table.Rows.Count <= 2000) sheet.Columns().AdjustToContents(1, 50, 8, 60);
        }
        if (tables.Count == 0) book.Worksheets.Add("Data");
        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    /// <summary>Excel allows 31 characters in a sheet name, none of []:*?/\, and each name once.</summary>
    private static string SheetName(string title, XLWorkbook book)
    {
        var name = new string(title.Where(ch => !"[]:*?/\\".Contains(ch)).ToArray()).Trim();
        name = Regex.Replace(name, @"\s+", " ");
        if (name.Length == 0) name = "Data";
        var candidate = name.Length > 31 ? name[..31] : name;
        for (var n = 2; book.Worksheets.Contains(candidate); n++)
        {
            var suffix = $" ({n})";
            candidate = (name.Length > 31 - suffix.Length ? name[..(31 - suffix.Length)] : name) + suffix;
        }
        return candidate;
    }

    private static XLCellValue Value(object? value) => value switch
    {
        null => Blank.Value,
        JsonElement json => Value(Plain(json)),
        string s when IsoDate().IsMatch(s)
            && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var date) => date,
        string s => s,
        bool b => b,
        DateTime d => d,
        DateTimeOffset d => d.UtcDateTime,
        DateOnly d => d.ToDateTime(TimeOnly.MinValue),
        TimeSpan t => t,
        byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal
            => Convert.ToDouble(value, CultureInfo.InvariantCulture),
        _ => DeliveryCsv.Format(value),
    };

    /// <summary>A JSON value (a stored view preview) as a plain value.</summary>
    internal static object? Plain(JsonElement json) => json.ValueKind switch
    {
        JsonValueKind.String => json.GetString(),
        JsonValueKind.Number => json.TryGetDecimal(out var d) ? d : json.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => json.GetRawText(),
    };
}
