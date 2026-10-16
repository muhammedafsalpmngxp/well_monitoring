using TWise.Tenant.Application.Features.Dashboards;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

public sealed class DashboardKindTests
{
    [Theory]
    [InlineData(null, "dashboard")]
    [InlineData("", "dashboard")]
    [InlineData("not json", "dashboard")]
    [InlineData("[]", "dashboard")]
    [InlineData("""{"widgets":[{"chartId":1,"sortOrder":1,"type":"chart"}],"layout":{"version":1,"columns":20,"items":[]}}""", "dashboard")]
    [InlineData("""{"kind":42}""", "dashboard")]
    [InlineData("""{"kind":""}""", "dashboard")]
    [InlineData("""{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[]}}""", "canvas")]
    [InlineData("""{"kind":" Canvas "}""", "canvas")]
    [InlineData("""{"kind":"report"}""", "dashboard")]
    [InlineData("""{"kind":"canvass"}""", "dashboard")]
    [InlineData("""{"_meta":{"kind":"canvas"}}""", "dashboard")]
    public void Kind_is_read_from_the_root_of_the_config(string? configJson, string expected)
        => DashboardKind.Of(configJson).Should().Be(expected);

    [Fact]
    public void A_config_holding_a_lone_surrogate_is_a_dashboard()
        => DashboardKind.Of("{\"kind\":\"canvas\",\"name\":\"\uD800\"}").Should().Be("dashboard");

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("not json", true)]
    [InlineData("""{"widgets":[]}""", true)]
    [InlineData("""{"kind":"dashboard"}""", true)]
    [InlineData("""{"kind":" Canvas "}""", true)]
    [InlineData("""{"_meta":{"kind":"report"}}""", true)]
    [InlineData("""{"kind":"report"}""", false)]
    [InlineData("""{"kind":"canvass"}""", false)]
    [InlineData("""{"kind":42}""", false)]
    public void A_config_may_only_name_a_known_kind(string? configJson, bool expected)
        => DashboardKind.HasKnownKind(configJson).Should().Be(expected);

    [Theory]
    [InlineData(null, true)]
    [InlineData(" ", true)]
    [InlineData("dashboard", true)]
    [InlineData("CANVAS", true)]
    [InlineData("report", false)]
    [InlineData("canvases", false)]
    public void Only_dashboard_and_canvas_can_be_asked_for(string? kind, bool expected)
        => DashboardKind.IsKnown(kind).Should().Be(expected);

    [Fact]
    public void No_kind_asked_means_dashboards_only()
    {
        DashboardKind.Matches(null, null).Should().BeTrue();
        DashboardKind.Matches("""{"widgets":[]}""", "dashboard").Should().BeTrue();
        DashboardKind.Matches("""{"kind":"canvas"}""", null).Should().BeFalse();
        DashboardKind.Matches("""{"kind":"canvas"}""", "Canvas").Should().BeTrue();
        DashboardKind.Matches("""{"widgets":[]}""", "canvas").Should().BeFalse();
    }
}
