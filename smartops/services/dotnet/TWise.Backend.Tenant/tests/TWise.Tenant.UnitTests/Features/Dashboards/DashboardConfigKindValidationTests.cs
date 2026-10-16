using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

public sealed class DashboardConfigKindValidationTests
{
    private static SaveDashboardRequest Request(string configJson)
        => new() { DashboardName = "Board", CategoryId = 1, ConfigJson = configJson };

    [Theory]
    [InlineData("""{"kind":"report"}""")]
    [InlineData("""{"kind":"canvass","layout":{"version":2,"columns":20,"sheets":[]}}""")]
    public void Create_update_and_layout_patch_refuse_an_unknown_kind(string configJson)
    {
        new CreateDashboardCommandValidator().Validate(new CreateDashboardCommand(Request(configJson)))
            .Errors.Select(e => e.ErrorMessage).Should().Contain(DashboardKind.UnknownKindMessage);
        new UpdateDashboardCommandValidator().Validate(new UpdateDashboardCommand(5, Request(configJson)))
            .Errors.Select(e => e.ErrorMessage).Should().Contain(DashboardKind.UnknownKindMessage);
        new PatchDashboardLayoutCommandValidator().Validate(new PatchDashboardLayoutCommand(5, configJson))
            .Errors.Select(e => e.ErrorMessage).Should().Contain(DashboardKind.UnknownKindMessage);
    }

    [Theory]
    [InlineData("""{"widgets":[]}""")]
    [InlineData("""{"kind":"dashboard","widgets":[]}""")]
    [InlineData("""{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[]}}""")]
    public void Create_update_and_layout_patch_accept_a_known_or_missing_kind(string configJson)
    {
        new CreateDashboardCommandValidator().Validate(new CreateDashboardCommand(Request(configJson))).IsValid.Should().BeTrue();
        new UpdateDashboardCommandValidator().Validate(new UpdateDashboardCommand(5, Request(configJson))).IsValid.Should().BeTrue();
        new PatchDashboardLayoutCommandValidator().Validate(new PatchDashboardLayoutCommand(5, configJson)).IsValid.Should().BeTrue();
    }
}
