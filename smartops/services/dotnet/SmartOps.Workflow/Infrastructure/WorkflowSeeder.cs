using System.Text.Json;
using SmartOps.Workflow.Domain.Entities;

namespace SmartOps.Workflow.Infrastructure;

public static class WorkflowSeeder
{
    public static async Task SeedAsync(WorkflowDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (!db.Flows.Any())
        {
            db.Flows.AddRange(
                new FlowDefinition
                {
                    Key = "daily-status-report",
                    Name = "Daily Status Report",
                    Description = "Send a daily summary of well progress to the executive team.",
                    NodesJson = JsonSerializer.Serialize(new object[] {
                        new { id="n1", type="trigger", label="Daily 06:00" },
                        new { id="n2", type="query",   label="Fetch progress" },
                        new { id="n3", type="email",   label="Email exec team" } }),
                    EdgesJson = JsonSerializer.Serialize(new object[] {
                        new { from="n1", to="n2" }, new { from="n2", to="n3" } }),
                    Status = "published"
                },
                new FlowDefinition
                {
                    Key = "penalty-alert",
                    Name = "Penalty Risk Alert",
                    Description = "Notify PM when penalty risk crosses threshold.",
                    NodesJson = JsonSerializer.Serialize(new object[] {
                        new { id="n1", type="trigger", label="On variance > 30 days" },
                        new { id="n2", type="compute", label="Score penalty risk" },
                        new { id="n3", type="slack",   label="Slack PM" } }),
                    EdgesJson = JsonSerializer.Serialize(new object[] {
                        new { from="n1", to="n2" }, new { from="n2", to="n3" } }),
                    Status = "draft"
                }
            );
        }

        if (!db.Connections.Any())
        {
            db.Connections.AddRange(
                new Connection { Name = "Internal SQL", Kind = "db",
                                 ConfigJson = JsonSerializer.Serialize(new { host = "localhost", db = "smartops" }) },
                new Connection { Name = "Databricks SQL", Kind = "db",
                                 ConfigJson = JsonSerializer.Serialize(new { host = "adb-7405604891058113.13.azuredatabricks.net" }) },
                new Connection { Name = "Outlook SMTP", Kind = "smtp",
                                 ConfigJson = JsonSerializer.Serialize(new { host = "smtp.office365.com", port = 587 }) }
            );
        }

        if (!db.Agents.Any())
        {
            db.Agents.AddRange(
                new AiAgent { Name = "Delay Watcher",
                              Description = "Watches forecast variance and recommends mitigations.",
                              SystemPrompt = "You are a delivery-risk analyst...",
                              ToolsJson = JsonSerializer.Serialize(new[] { "forecast.query", "alerts.publish" }) },
                new AiAgent { Name = "Quality Inspector",
                              Description = "Reviews DQ errors and suggests corrections.",
                              SystemPrompt = "You are a data steward...",
                              ToolsJson = JsonSerializer.Serialize(new[] { "dq.read", "dq.heal" }) }
            );
        }

        if (!db.Forms.Any())
        {
            db.Forms.AddRange(
                new FormDefinition { Key = "variation-request", Name = "Variation Order Request",
                                     SchemaJson = JsonSerializer.Serialize(new {
                                         fields = new object[] {
                                             new { name="well_id", type="string", required=true },
                                             new { name="description", type="text", required=true },
                                             new { name="amount", type="number" } } }),
                                     UiLayoutJson = JsonSerializer.Serialize(new {
                                         order = new[] { "well_id", "description", "amount" } }) },
                new FormDefinition { Key = "safety-incident", Name = "Safety Incident Report",
                                     SchemaJson = JsonSerializer.Serialize(new {
                                         fields = new object[] {
                                             new { name="location", type="string" },
                                             new { name="severity", type="select",
                                                   options=new[] { "low","medium","high" } },
                                             new { name="narrative", type="text" } } }),
                                     UiLayoutJson = JsonSerializer.Serialize(new {
                                         order = new[] { "location", "severity", "narrative" } }) }
            );
        }

        if (!db.Catalogue.Any())
        {
            db.Catalogue.AddRange(
                new CatalogueItem { Key = "new-well-onboarding", Name = "New Well Onboarding",
                                    Category = "Operations",
                                    Description = "Request paperwork to onboard a new well",
                                    Icon = "oil-well" },
                new CatalogueItem { Key = "resource-request", Name = "Additional Crew Request",
                                    Category = "HR",
                                    Description = "Request additional crew or equipment", Icon = "users" },
                new CatalogueItem { Key = "variation-order", Name = "Variation Order",
                                    Category = "Contracts",
                                    Description = "Submit a variation order to PDO", Icon = "file-edit" },
                new CatalogueItem { Key = "safety-incident", Name = "Safety Incident",
                                    Category = "HSE",
                                    Description = "Report a safety incident", Icon = "alert-triangle" }
            );
        }

        await db.SaveChangesAsync();
    }
}
