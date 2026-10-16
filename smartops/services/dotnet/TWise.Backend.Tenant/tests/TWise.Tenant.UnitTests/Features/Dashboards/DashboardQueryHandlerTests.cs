using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

public sealed class GetWipDashboardsHandlerTests
{
    private readonly Mock<IDashboardRepository> _repo = new();
    private readonly Mock<ICurrentUserService> _currentUser = new();
    private readonly Mock<ILogger<GetWipDashboardsHandler>> _logger = new();
    private GetWipDashboardsHandler Sut => new(_repo.Object, _currentUser.Object, _logger.Object);

    [Fact]
    public async Task Handle_ReturnsGroupedDashboards()
    {
        _currentUser.Setup(u => u.UserId).Returns("user1");
        var categories = new List<Category>
        {
            new() { CategoryId = 1, CategoryName = "Others" },
            new() { CategoryId = 2, CategoryName = "Production" }
        };
        var dashboards = new List<Dashboard>
        {
            new() { DashboardId = 1, DashboardName = "D1", CategoryId = 1, Status = DashboardStatus.Draft, ConfigJson = "{\"widgets\":[{\"chartId\":1}]}" },
            new() { DashboardId = 2, DashboardName = "D2", CategoryId = 1, Status = DashboardStatus.Draft },
            new() { DashboardId = 3, DashboardName = "D3", CategoryId = 2, Status = DashboardStatus.Draft }
        };
        _repo.Setup(r => r.GetDashboardCategoriesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(categories);
        _repo.Setup(r => r.GetDashboardsByCreatorAsync("user1", It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>())).ReturnsAsync(dashboards);

        var result = await Sut.Handle(new GetWipDashboardsQuery(), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().HaveCount(2);
        result.Value![0].DashboardCount.Should().Be(2);
        result.Value[0].Dashboards.Should().HaveCount(2);
        result.Value[1].DashboardCount.Should().Be(1);
    }

    [Fact]
    public async Task Handle_ReturnsEmptyList_WhenNoDrafts()
    {
        _currentUser.Setup(u => u.UserId).Returns("user1");
        var categories = new List<Category> { new() { CategoryId = 1, CategoryName = "Others" } };
        _repo.Setup(r => r.GetDashboardCategoriesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(categories);
        _repo.Setup(r => r.GetDashboardsByCreatorAsync("user1", It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>())).ReturnsAsync(new List<Dashboard>());

        var result = await Sut.Handle(new GetWipDashboardsQuery(), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value![0].DashboardCount.Should().Be(0);
        result.Value[0].Dashboards.Should().BeEmpty();
    }
}

public sealed class GetPublishedDashboardsHandlerTests
{
    private readonly Mock<IDashboardRepository> _repo = new();
    private readonly Mock<ICurrentUserService> _currentUser = new();
    private readonly Mock<ILogger<GetPublishedDashboardsHandler>> _logger = new();
    private GetPublishedDashboardsHandler Sut => new(_repo.Object, _currentUser.Object, _logger.Object);

    [Fact]
    public async Task Handle_ReturnsPublishedDashboards()
    {
        _currentUser.Setup(u => u.Roles).Returns(new List<string>());
        var categories = new List<Category> { new() { CategoryId = 1, CategoryName = "Others" } };
        var dashboards = new List<Dashboard>
        {
            new() { DashboardId = 1, DashboardName = "Published1", CategoryId = 1, Status = DashboardStatus.Published, CreatedBy = "admin" }
        };
        _repo.Setup(r => r.GetDashboardCategoriesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(categories);
        _repo.Setup(r => r.GetPublishedListAsync(It.IsAny<bool>(), It.IsAny<CancellationToken>())).ReturnsAsync(dashboards);

        var result = await Sut.Handle(new GetPublishedDashboardsQuery(), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value![0].Dashboards.Should().HaveCount(1);
        result.Value[0].Dashboards[0].DashboardName.Should().Be("Published1");
        result.Value[0].Dashboards[0].Status.Should().Be(DashboardStatus.Published);
    }
}

public sealed class GetDashboardByIdHandlerTests
{
    private readonly Mock<IDashboardRepository> _repo = new();
    private readonly Mock<ILogger<GetDashboardByIdHandler>> _logger = new();
    private GetDashboardByIdHandler Sut => new(_repo.Object, _logger.Object);

    [Fact]
    public async Task Handle_ReturnsDashboardDetail_WhenFound()
    {
        var dashboard = new Dashboard
        {
            DashboardId = 1,
            DashboardName = "My Dashboard",
            CategoryId = 2,
            Status = DashboardStatus.Published,
            Description = "Test",
            ConfigJson = "{\"widgets\":[{\"chartId\":1,\"sortOrder\":1},{\"chartId\":2,\"sortOrder\":2}]}",
            IsActive = true,
            Category = new Category { CategoryName = "Production" },
        };
        _repo.Setup(r => r.GetDashboardDetailByIdAsync(1, It.IsAny<CancellationToken>())).ReturnsAsync(dashboard);

        var result = await Sut.Handle(new GetDashboardByIdQuery(1), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.DashboardId.Should().Be(1);
        result.Value.DashboardName.Should().Be("My Dashboard");
        result.Value.CategoryName.Should().Be("Production");
        result.Value.IsActive.Should().BeTrue();
        result.Value.ConfigJson.Should().Contain("chartId");
    }

    [Fact]
    public async Task Handle_ReturnsNotFound_WhenDashboardMissing()
    {
        _repo.Setup(r => r.GetDashboardDetailByIdAsync(99, It.IsAny<CancellationToken>())).ReturnsAsync((Dashboard?)null);

        var result = await Sut.Handle(new GetDashboardByIdQuery(99), CancellationToken.None);

        result.IsNotFound.Should().BeTrue();
        result.ErrorMessage.Should().Contain("not found");
    }

    [Fact]
    public async Task Handle_ReturnsNullConfigJson_WhenDashboardHasNone()
    {
        var dashboard = new Dashboard
        {
            DashboardId = 1,
            DashboardName = "Empty",
            CategoryId = 1,
            Status = DashboardStatus.Draft,
            Category = new Category { CategoryName = "Others" },
            ConfigJson = null
        };
        _repo.Setup(r => r.GetDashboardDetailByIdAsync(1, It.IsAny<CancellationToken>())).ReturnsAsync(dashboard);

        var result = await Sut.Handle(new GetDashboardByIdQuery(1), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ConfigJson.Should().BeNull();
    }
}
