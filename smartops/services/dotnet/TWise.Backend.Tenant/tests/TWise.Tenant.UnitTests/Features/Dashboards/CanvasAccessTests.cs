using System.Security.Claims;
using Moq;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

public sealed class CanvasAccessTests
{
    private const string CanvasConfig = """{"kind":"canvas","layout":{"version":2,"sheets":[]}}""";

    private static ClaimsPrincipal User(params string[] perms) => new(new ClaimsIdentity(
        perms.Select(p => new Claim("perm", p)).Append(new Claim(ClaimTypes.NameIdentifier, "5")), "test"));

    private static async Task<bool> Opens(ClaimsPrincipal user, string status)
    {
        var dashboards = new Mock<IDashboardRepository>();
        dashboards.Setup(r => r.GetDashboardByIdAsync(31, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dashboard { DashboardId = 31, ConfigJson = CanvasConfig, Status = status, IsActive = true });
        var service = new DashboardPermissionService(Mock.Of<ICommentRepository>(), dashboards.Object);
        return (await service.ResolveVersionAccessAsync(user, 31, false, CancellationToken.None)).IsSuccess;
    }

    [Fact]
    public async Task A_canvas_author_opens_any_canvas_and_a_viewer_only_published_ones()
    {
        (await Opens(User("dashboard.canvas:v"), DashboardStatus.Draft)).Should().BeTrue();
        (await Opens(User("dashboard.standard-canvases:v"), DashboardStatus.Published)).Should().BeTrue();
        (await Opens(User("dashboard.standard-canvases:v"), DashboardStatus.Draft)).Should().BeFalse();
        (await Opens(User("dashboard.standard-boards:v"), DashboardStatus.Published)).Should().BeFalse();
    }
}
