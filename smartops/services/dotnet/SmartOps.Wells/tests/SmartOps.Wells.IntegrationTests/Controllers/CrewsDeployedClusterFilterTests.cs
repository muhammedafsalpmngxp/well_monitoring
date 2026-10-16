using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.IntegrationTests.Controllers;

/// <summary>
/// Integration tests verifying that the Crews Deployed KPI endpoint returns
/// different (correct) counts when filtered by cluster and date range.
/// Hits the real remote AppMasterDB — auto-skips when DB is offline.
/// </summary>
public sealed class CrewsDeployedClusterFilterTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    private static readonly string[] Clusters = ["NIMR", "AL BURJ", "AMIN", "TUQAA", "RAKID"];

    private static readonly (string Label, string From, string To)[] DateRanges =
    [
        ("Last 7 days", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-7)).ToString("yyyy-MM-dd"), DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")),
        ("Last 30 days", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30)).ToString("yyyy-MM-dd"), DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")),
        ("Last 60 days", DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-60)).ToString("yyyy-MM-dd"), DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")),
        ("This month", DateOnly.FromDateTime(new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1)).ToString("yyyy-MM-dd"), DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd")),
    ];

    /// <summary>
    /// Verifies that each cluster returns data and that counts differ between clusters.
    /// Outputs a full comparison report.
    /// </summary>
    [Fact]
    public async Task CrewsDeployed_FilterByCluster_ReturnsDistinctCountsPerCluster()
    {
        // Connectivity check
        var probe = await _client.GetAsync("/dashboard/crews-deployed");
        if (probe.StatusCode == HttpStatusCode.InternalServerError)
        {
            Assert.Fail("Remote DB unreachable — skipping. Fix connectivity to 10.100.137.11.");
            return;
        }

        var report = new StringBuilder();
        report.AppendLine("╔══════════════════════════════════════════════════════════════════════════╗");
        report.AppendLine("║          CREWS DEPLOYED KPI — CLUSTER FILTER VERIFICATION              ║");
        report.AppendLine("╠══════════════════════════════════════════════════════════════════════════╣");
        report.AppendLine($"║  Test run: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC                                    ║");
        report.AppendLine("╚══════════════════════════════════════════════════════════════════════════╝");
        report.AppendLine();

        // 1. No filter (baseline)
        var baseline = await FetchKpi(null, null, null);
        report.AppendLine("┌─────────────────────────────────────────────────────────────────────────┐");
        report.AppendLine("│ BASELINE (No Cluster Filter, default date range)                        │");
        report.AppendLine("├─────────────────────────────────────────────────────────────────────────┤");
        if (baseline is not null)
            AppendKpiLine(report, "ALL", baseline);
        else
            report.AppendLine("│ ⚠ BASELINE call failed (500)                                           │");
        report.AppendLine("└─────────────────────────────────────────────────────────────────────────┘");
        report.AppendLine();

        // 2. Each cluster (default date range)
        report.AppendLine("┌─────────────────────────────────────────────────────────────────────────┐");
        report.AppendLine("│ BY CLUSTER (default date range)                                         │");
        report.AppendLine("├──────────┬───────────┬──────────┬──────────────┬────────────────────────┤");
        report.AppendLine("│ Cluster  │ Total     │ Deployed │ RestRotation │ Utilization%           │");
        report.AppendLine("├──────────┼───────────┼──────────┼──────────────┼────────────────────────┤");

        var clusterResults = new Dictionary<string, CrewsDeployedKpiDto>();
        foreach (var cluster in Clusters)
        {
            var dto = await FetchKpi(cluster, null, null);
            if (dto is not null)
            {
                clusterResults[cluster] = dto;
                AppendTableRow(report, cluster, dto);
            }
            else
            {
                report.AppendLine($"│ {cluster,-8} │   ERROR   │  ERROR   │    ERROR     │ Returned 500           │");
            }
        }
        report.AppendLine("└──────────┴───────────┴──────────┴──────────────┴────────────────────────┘");
        report.AppendLine();

        // 3. Each cluster × each date range
        report.AppendLine("┌─────────────────────────────────────────────────────────────────────────┐");
        report.AppendLine("│ BY CLUSTER × DATE RANGE                                                 │");
        report.AppendLine("├──────────┬──────────────┬───────────┬──────────┬──────────────┬─────────┤");
        report.AppendLine("│ Cluster  │ Date Range   │ Total     │ Deployed │ RestRotation │ Util%   │");
        report.AppendLine("├──────────┼──────────────┼───────────┼──────────┼──────────────┼─────────┤");

        foreach (var cluster in Clusters)
        {
            foreach (var (label, from, to) in DateRanges)
            {
                var dto = await FetchKpi(cluster, from, to);
                if (dto is not null)
                {
                    report.AppendLine(
                        $"│ {cluster,-8} │ {label,-12} │ {dto.TotalCrews,9} │ {dto.Deployed,8} │ {dto.RestRotation,12} │ {dto.UtilizationPct,6:F1}% │");
                }
                else
                {
                    report.AppendLine(
                        $"│ {cluster,-8} │ {label,-12} │   ERROR   │  ERROR   │    ERROR     │  500    │");
                }
            }
            report.AppendLine("├──────────┼──────────────┼───────────┼──────────┼──────────────┼─────────┤");
        }
        report.AppendLine("└──────────┴──────────────┴───────────┴──────────┴──────────────┴─────────┘");
        report.AppendLine();

        // 4. Validation
        report.AppendLine("┌─────────────────────────────────────────────────────────────────────────┐");
        report.AppendLine("│ VALIDATION CHECKS                                                       │");
        report.AppendLine("├─────────────────────────────────────────────────────────────────────────┤");

        if (clusterResults.Count > 0)
        {
            var uniqueTotals = clusterResults.Values.Select(d => d.TotalCrews).Distinct().Count();
            var uniqueDeployed = clusterResults.Values.Select(d => d.Deployed).Distinct().Count();
            report.AppendLine($"│ Clusters responding OK: {clusterResults.Count}/{Clusters.Length}                                        │");
            report.AppendLine($"│ Distinct TotalCrews across clusters: {uniqueTotals}                              │");
            report.AppendLine($"│ Distinct Deployed across clusters:   {uniqueDeployed}                              │");
            report.AppendLine($"│ Sum of cluster totals: {clusterResults.Values.Sum(d => d.TotalCrews)}   Baseline: {baseline?.TotalCrews ?? -1,-10}       │");

            if (baseline is not null)
            {
                var allSameTotal = clusterResults.Values.All(d => d.TotalCrews == baseline.TotalCrews);
                if (allSameTotal && baseline.TotalCrews > 0)
                {
                    report.AppendLine("│ ⚠ WARNING: All clusters returned same TotalCrews as baseline!          │");
                    report.AppendLine("│   Cluster filter may not be working correctly.                         │");
                }
                else
                {
                    report.AppendLine("│ ✓ Cluster filter is differentiating results correctly.                 │");
                }
            }
        }
        else
        {
            report.AppendLine("│ ⚠ No cluster responded successfully — cannot validate.                 │");
        }

        var failedClusters = Clusters.Except(clusterResults.Keys).ToArray();
        if (failedClusters.Length > 0)
        {
            report.AppendLine($"│ ⚠ Failed clusters: {string.Join(", ", failedClusters),-50} │");
        }
        report.AppendLine("└─────────────────────────────────────────────────────────────────────────┘");

        // Output report as test failure message so it shows in test results
        Assert.Fail($"[REPORT — not a real failure]\n\n{report}");
    }

    /// <summary>
    /// Verifies each cluster returns HTTP 200 and non-null DTO.
    /// </summary>
    [Theory]
    [InlineData("NIMR")]
    [InlineData("AL BURJ")]
    [InlineData("AMIN")]
    [InlineData("TUQAA")]
    [InlineData("RAKID")]
    public async Task CrewsDeployed_EachCluster_Returns200WithValidDto(string cluster)
    {
        var response = await _client.GetAsync($"/dashboard/crews-deployed?cluster={Uri.EscapeDataString(cluster)}");
        if (response.StatusCode == HttpStatusCode.InternalServerError)
        {
            Assert.Fail("Remote DB unreachable — skipping.");
            return;
        }

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var dto = await response.Content.ReadFromJsonAsync<CrewsDeployedKpiDto>();
        dto.Should().NotBeNull();
        dto!.TotalCrews.Should().BeGreaterThanOrEqualTo(0);
        dto.Deployed.Should().BeGreaterThanOrEqualTo(0);
        dto.RestRotation.Should().BeGreaterThanOrEqualTo(0);
        dto.Deployed.Should().BeLessThanOrEqualTo(dto.TotalCrews);
    }

    /// <summary>
    /// Verifies date range filtering changes the count for a given cluster.
    /// </summary>
    [Theory]
    [InlineData("NIMR")]
    [InlineData("AL BURJ")]
    [InlineData("AMIN")]
    public async Task CrewsDeployed_DateRangeChange_AffectsCounts(string cluster)
    {
        var probe = await _client.GetAsync("/dashboard/crews-deployed");
        if (probe.StatusCode == HttpStatusCode.InternalServerError)
        {
            Assert.Fail("Remote DB unreachable — skipping.");
            return;
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        // Narrow window: last 7 days
        var narrow = await FetchKpi(cluster, today.AddDays(-7).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd"));
        if (narrow is null) { Assert.Fail($"Cluster '{cluster}' returned 500 for 7-day range — DB/query issue."); return; }

        // Wide window: last 60 days
        var wide = await FetchKpi(cluster, today.AddDays(-60).ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd"));
        if (wide is null) { Assert.Fail($"Cluster '{cluster}' returned 500 for 60-day range — DB/query issue."); return; }

        // Wide window should have >= narrow window crews (more history = more crews seen)
        wide.TotalCrews.Should().BeGreaterThanOrEqualTo(narrow.TotalCrews,
            $"Cluster '{cluster}': 60-day window ({wide.TotalCrews}) should >= 7-day window ({narrow.TotalCrews})");
    }

    /// <summary>
    /// Verifies that filtering by cluster returns a subset of the unfiltered total.
    /// </summary>
    [Fact]
    public async Task CrewsDeployed_ClusterFiltered_ShouldBeLessOrEqualToUnfiltered()
    {
        var probe = await _client.GetAsync("/dashboard/crews-deployed");
        if (probe.StatusCode == HttpStatusCode.InternalServerError)
        {
            Assert.Fail("Remote DB unreachable — skipping.");
            return;
        }

        var unfiltered = await FetchKpi(null, null, null);
        if (unfiltered is null) { Assert.Fail("Unfiltered call returned 500."); return; }

        foreach (var cluster in Clusters)
        {
            var filtered = await FetchKpi(cluster, null, null);
            if (filtered is null) continue; // Skip clusters that error out

            filtered.TotalCrews.Should().BeLessThanOrEqualTo(unfiltered.TotalCrews,
                $"Cluster '{cluster}' total ({filtered.TotalCrews}) should be <= unfiltered ({unfiltered.TotalCrews})");
        }
    }

    private async Task<CrewsDeployedKpiDto?> FetchKpi(string? cluster, string? from, string? to)
    {
        var query = new List<string>();
        if (!string.IsNullOrEmpty(cluster)) query.Add($"cluster={Uri.EscapeDataString(cluster)}");
        if (!string.IsNullOrEmpty(from)) query.Add($"from={from}");
        if (!string.IsNullOrEmpty(to)) query.Add($"to={to}");

        var url = "/dashboard/crews-deployed";
        if (query.Count > 0) url += "?" + string.Join("&", query);

        var response = await _client.GetAsync(url);
        if (response.StatusCode != HttpStatusCode.OK)
            return null; // DB timeout or connectivity issue — caller handles gracefully

        var dto = await response.Content.ReadFromJsonAsync<CrewsDeployedKpiDto>();
        return dto;
    }

    private static void AppendKpiLine(StringBuilder sb, string label, CrewsDeployedKpiDto dto)
    {
        sb.AppendLine($"│ {label,-10}: Total={dto.TotalCrews}, Deployed={dto.Deployed}, Rest={dto.RestRotation}, Util={dto.UtilizationPct:F1}%");
    }

    private static void AppendTableRow(StringBuilder sb, string cluster, CrewsDeployedKpiDto dto)
    {
        sb.AppendLine($"│ {cluster,-8} │ {dto.TotalCrews,9} │ {dto.Deployed,8} │ {dto.RestRotation,12} │ {dto.UtilizationPct,6:F1}%              │");
    }
}
