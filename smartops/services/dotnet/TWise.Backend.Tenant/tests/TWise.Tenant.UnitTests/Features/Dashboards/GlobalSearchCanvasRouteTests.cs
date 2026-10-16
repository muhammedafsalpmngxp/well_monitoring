using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.GlobalSearch;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

public sealed class GlobalSearchCanvasRouteTests
{
    private const string CanvasJson = """{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[]}}""";

    private static async Task<Dictionary<string, string>> Routes(params Dashboard[] dashboards)
    {
        var repo = new Mock<IGlobalSearchRepository>();
        repo.Setup(r => r.SearchAllAsync("b", "7", 7, It.IsAny<CancellationToken>()))
            .ReturnsAsync((dashboards, new List<Widget>(), new List<Report>()));
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.UserId).Returns("7");

        var result = await new GlobalSearchHandler(repo.Object, user.Object).Handle(new GlobalSearchQuery("b"), CancellationToken.None);

        return result.Value!.ToDictionary(r => r.Name, r => r.Url);
    }

    private static Dashboard Row(int id, string name, string status, string? config)
        => new() { DashboardId = id, DashboardName = name, Status = status, ConfigJson = config, Category = new Category { CategoryName = "Others" } };

    [Fact]
    public async Task A_canvas_opens_in_the_canvas_editor_whatever_its_status()
    {
        var routes = await Routes(
            Row(1, "b draft", DashboardStatus.Draft, CanvasJson),
            Row(2, "b completed", DashboardStatus.Completed, CanvasJson),
            Row(3, "b published", DashboardStatus.Published, CanvasJson));

        routes.Should().Equal(new Dictionary<string, string>
        {
            ["b draft"] = "/canvas/1",
            ["b completed"] = "/canvas/2",
            ["b published"] = "/canvas/3",
        });
    }

    [Fact]
    public async Task A_dashboard_keeps_its_builder_and_viewer_routes()
    {
        var routes = await Routes(
            Row(1, "b draft", DashboardStatus.Draft, """{"widgets":[]}"""),
            Row(2, "b completed", DashboardStatus.Completed, null),
            Row(3, "b published", DashboardStatus.Published, """{"widgets":[],"_meta":{"kind":"canvas"}}"""));

        routes.Should().Equal(new Dictionary<string, string>
        {
            ["b draft"] = "/dashboard/builder/1",
            ["b completed"] = "/dashboard/builder/2",
            ["b published"] = "/dashboard/operations-dashboard/3",
        });
    }
}
