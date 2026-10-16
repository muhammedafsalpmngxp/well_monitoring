using System.Globalization;
using System.Text;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>A table a delivery sends: rows keyed by Columns, shown under Headers. Name becomes the sheet or file name.</summary>
public sealed record DeliveryTable(
    string Name, IReadOnlyList<string> Columns, IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyDictionary<string, object?>> Rows);

/// <summary>RFC 4180 CSV: comma separated, CRLF rows, UTF-8 with a byte order mark so Excel reads Arabic text.</summary>
public static class DeliveryCsv
{
    public static byte[] Write(DeliveryTable table)
    {
        var text = new StringBuilder();
        text.Append(string.Join(',', table.Headers.Select(h => Field(Format(h))))).Append("\r\n");
        foreach (var row in table.Rows)
            text.Append(string.Join(',', table.Columns.Select(column => Field(Format(row.GetValueOrDefault(column)))))).Append("\r\n");
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(text.ToString())];
    }

    /// <summary>A value as text, the same on every server: invariant numbers, dates as 2026-09-28 07:05:00.</summary>
    public static string Format(object? value) => value switch
    {
        null => string.Empty,
        DateTime d => d.ToString(d.TimeOfDay == TimeSpan.Zero ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        DateTimeOffset d => d.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
        bool b => b ? "true" : "false",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        // Text a spreadsheet would run as a formula is written as text.
        string s when s.Length > 0 && "=+-@\t\r".Contains(s[0]) => "'" + s,
        _ => value.ToString() ?? string.Empty,
    };

    private static string Field(string value)
        => value.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
}
