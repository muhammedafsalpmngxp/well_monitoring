using System.Text.Json;
using SmartOps.Integrations.Domain.Entities;

namespace SmartOps.Integrations.Infrastructure;

public static class IntegrationsSeeder
{
    public static async Task SeedAsync(IntegrationsDbContext db)
    {
        await db.Database.EnsureCreatedAsync();

        if (!db.Endpoints.Any())
        {
            db.Endpoints.AddRange(
                new IntegrationEndpoint
                {
                    Key = "sap.purchase-order", System = "SAP", Name = "SAP Purchase Order",
                    BaseUrl = "https://sap.example.com/api/po", AuthType = "oauth",
                    ConfigJson = JsonSerializer.Serialize(new {
                        scope = "po.read po.write",
                        tokenUrl = "https://sap.example.com/oauth/token"
                    })
                },
                new IntegrationEndpoint
                {
                    Key = "salesforce.account", System = "Salesforce", Name = "Salesforce Account",
                    BaseUrl = "https://example.my.salesforce.com/services/data/v60.0",
                    AuthType = "oauth",
                    ConfigJson = JsonSerializer.Serialize(new {
                        instance = "example.my.salesforce.com",
                        loginUrl = "https://login.salesforce.com"
                    })
                },
                new IntegrationEndpoint
                {
                    Key = "servicenow.incident", System = "ServiceNow", Name = "ServiceNow Incident",
                    BaseUrl = "https://example.service-now.com/api/now/table/incident",
                    AuthType = "basic",
                    ConfigJson = JsonSerializer.Serialize(new {
                        table = "incident", note = "Used for safety incident sync"
                    })
                }
            );
        }
        await db.SaveChangesAsync();
    }
}
