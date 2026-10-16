using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

/// <summary>A save may not turn a canvas into a dashboard or a dashboard into a canvas.</summary>
public sealed class DashboardKindChangeTests
{
    private const string V1 = """{"widgets":[],"layout":{"version":1,"columns":20,"items":[]}}""";
    private const string CanvasJson = """{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[{"name":"Sheet 1","items":[]}]}}""";
    private const string CanvasMessage = "This is a canvas. Open it from BI Canvas to change it.";
    private const string DashboardMessage = "This is a dashboard. Open it from the dashboard builder to change it.";

    private static Mock<IDashboardRepository> Repo(string storedConfig)
    {
        var repo = new Mock<IDashboardRepository>();
        repo.Setup(r => r.GetDashboardByIdAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(new Dashboard
        {
            DashboardId = 5, DashboardName = "Board", CategoryId = 1, Status = DashboardStatus.Draft,
            CreatedBy = "7", ConfigJson = storedConfig,
        });
        repo.Setup(r => r.CategoryExistsAsync(1, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        return repo;
    }

    private static ICurrentUserService User()
    {
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.UserId).Returns("7");
        user.Setup(u => u.Roles).Returns(new List<string>());
        return user.Object;
    }

    private static async Task<(bool Ok, bool Invalid, string? Message, Mock<IDashboardRepository> Repo)> Put(string stored, string incoming)
    {
        var repo = Repo(stored);
        var handler = new UpdateDashboardHandler(repo.Object, User(), Mock.Of<ILogger<UpdateDashboardHandler>>(), Mock.Of<ICategoryRepository>(), Mock.Of<IWidgetService>());
        var result = await handler.Handle(new UpdateDashboardCommand(5, new SaveDashboardRequest
        {
            DashboardName = "Board", CategoryId = 1, ConfigJson = incoming,
        }), CancellationToken.None);
        return (result.IsSuccess, result.IsValidationError, result.ErrorMessage, repo);
    }

    private static async Task<(bool Ok, bool Invalid, string? Message, Mock<IDashboardRepository> Repo)> Patch(string stored, string incoming)
    {
        var repo = Repo(stored);
        var handler = new PatchDashboardLayoutHandler(repo.Object, User(), Mock.Of<ILogger<PatchDashboardLayoutHandler>>());
        var result = await handler.Handle(new PatchDashboardLayoutCommand(5, incoming), CancellationToken.None);
        return (result.IsSuccess, result.IsValidationError, result.ErrorMessage, repo);
    }

    [Theory]
    [InlineData(CanvasJson, V1, CanvasMessage)]
    [InlineData(V1, CanvasJson, DashboardMessage)]
    public async Task Put_refuses_a_kind_change_and_keeps_the_stored_config(string stored, string incoming, string message)
    {
        var (ok, invalid, error, repo) = await Put(stored, incoming);

        ok.Should().BeFalse();
        invalid.Should().BeTrue();
        error.Should().Be(message);
        repo.Verify(r => r.UpdateDashboardAsync(It.IsAny<Dashboard>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(CanvasJson, V1, CanvasMessage)]
    [InlineData(V1, CanvasJson, DashboardMessage)]
    [InlineData(CanvasJson, """{"widgets":[]}""", CanvasMessage)]
    public async Task Patch_refuses_a_kind_change_and_keeps_the_stored_config(string stored, string incoming, string message)
    {
        var (ok, invalid, error, repo) = await Patch(stored, incoming);

        ok.Should().BeFalse();
        invalid.Should().BeTrue();
        error.Should().Be(message);
        repo.Verify(r => r.UpdateDashboardConfigAsync(It.IsAny<Dashboard>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(CanvasJson, CanvasJson)]
    [InlineData(V1, V1)]
    [InlineData(null, V1)]
    public async Task Put_and_patch_save_a_config_of_the_same_kind(string? stored, string incoming)
    {
        var put = await Put(stored!, incoming);
        var patch = await Patch(stored!, incoming);

        put.Ok.Should().BeTrue();
        patch.Ok.Should().BeTrue();
        put.Repo.Verify(r => r.UpdateDashboardAsync(It.Is<Dashboard>(d => DashboardKind.Of(d.ConfigJson) == DashboardKind.Of(incoming)), It.IsAny<CancellationToken>()), Times.Once);
        patch.Repo.Verify(r => r.UpdateDashboardConfigAsync(It.IsAny<Dashboard>(), It.IsAny<CancellationToken>()), Times.Once);
    }
}
