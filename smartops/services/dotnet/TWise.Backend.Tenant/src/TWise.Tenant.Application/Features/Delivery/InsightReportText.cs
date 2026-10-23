using System.Text;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>An insight report as the plain text of a scheduled mail: the question, then each section that has lines.</summary>
public static class InsightReportText
{
    public static string Format(AiInsightReportDto report)
    {
        var text = new StringBuilder($"{report.Question}\n{report.SourceName} · {report.TotalRows} rows");
        Section(text, "Trend", report.Trend);
        Section(text, "Key findings", report.Findings);
        Section(text, "Unusual", report.Anomalies);
        Section(text, "Recommendations", report.Recommendations);
        return text.ToString();
    }

    private static void Section(StringBuilder text, string title, IReadOnlyList<string> lines)
    {
        if (lines.Count == 0) return;
        text.Append($"\n\n{title}");
        foreach (var line in lines) text.Append($"\n- {line}");
    }
}
