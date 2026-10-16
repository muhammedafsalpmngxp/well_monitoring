using System.Text.Json;
using SmartOps.Reports.Domain.Entities;

namespace SmartOps.Reports.Infrastructure;

public static class ReportsSeeder
{
    public static async Task SeedAsync(ReportsDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (!db.Reports.Any())
        {
            db.Reports.AddRange(
                new Report { Key = "daily-progress", Name = "Daily Progress Report",
                             Category = "Operations",
                             Description = "Daily summary of well progress vs plan",
                             LayoutJson = JsonSerializer.Serialize(new {
                                 sections = new[] { "overview", "by-cluster", "critical" } }) },
                new Report { Key = "weekly-pl", Name = "Weekly P&L",
                             Category = "Finance",
                             Description = "Job-cost roll-up per well",
                             LayoutJson = JsonSerializer.Serialize(new {
                                 sections = new[] { "pnl", "penalties", "bonuses" } }) },
                new Report { Key = "safety-summary", Name = "Safety Summary",
                             Category = "HSE",
                             Description = "Incidents and near-misses by site",
                             LayoutJson = JsonSerializer.Serialize(new {
                                 sections = new[] { "incidents", "by-severity", "trend" } }) }
            );
        }

        if (!db.Schedules.Any())
        {
            db.Schedules.AddRange(
                new ReportSchedule { ReportKey = "daily-progress", Cron = "0 6 * * *",
                                     RecipientsJson = JsonSerializer.Serialize(new[] {
                                         "pm@smartops.local", "exec@smartops.local" }),
                                     Format = "pdf", NextRun = DateTime.UtcNow.AddDays(1) },
                new ReportSchedule { ReportKey = "weekly-pl", Cron = "0 8 * * 1",
                                     RecipientsJson = JsonSerializer.Serialize(new[] {
                                         "finance@smartops.local" }),
                                     Format = "xlsx", NextRun = DateTime.UtcNow.AddDays(7) }
            );
        }

        if (!db.Briefings.Any())
        {
            db.Briefings.AddRange(
                new BriefingSnapshot { Audience = "md", Period = "2026-04-27",
                                       Headline = "3 wells in critical path; mitigation underway",
                                       BodyJson = JsonSerializer.Serialize(new {
                                           summary = "31780, 36076 and 36757 are critical. Penalty exposure: USD 119k.",
                                           actions = new[] { "Expedite HDPE fusion machine", "Re-allocate FCS-0402 crew" },
                                           kpis = new { spi = 0.82, cpi = 0.91 } }) },
                new BriefingSnapshot { Audience = "exec", Period = "2026-04-27",
                                       Headline = "Programme tracking 12% behind plan",
                                       BodyJson = JsonSerializer.Serialize(new {
                                           summary = "Overall programme variance -12%. AL BURJ cluster outperforming.",
                                           actions = new[] { "Approve crew rebalancing" },
                                           kpis = new { avg_progress = 56.4 } }) }
            );
        }

        if (!db.Alerts.Any())
        {
            db.Alerts.AddRange(
                new Alert { Category = "delay", Severity = "critical",
                            Title = "Well 31780 forecast slip 51 days",
                            Detail = "Sleeper installation 35 pts below plan.",
                            WellId = "31780", PayloadJson = JsonSerializer.Serialize(new { spi = 0.36 }) },
                new Alert { Category = "material", Severity = "critical",
                            Title = "OHL conductor not ordered",
                            Detail = "Well 36757 stringing blocked. Required by May 5.",
                            WellId = "36757", PayloadJson = JsonSerializer.Serialize(new { req_by = "2026-05-05" }) },
                new Alert { Category = "dq", Severity = "warning",
                            Title = "R04 violation on well 34565",
                            Detail = "planned_td vs planned_spud integrity check failed.",
                            WellId = "34565", PayloadJson = JsonSerializer.Serialize(new { rule = "R04" }) }
            );
        }

        await db.SaveChangesAsync();
    }
}
