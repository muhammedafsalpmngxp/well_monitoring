using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Dashboards;

public sealed class DashboardListKindTests
{
    private const string V1 = """{"widgets":[{"chartId":1,"sortOrder":1,"type":"chart"}]}""";
    private const string CanvasJson = """{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[{"name":"Sheet 1","items":[]}]}}""";

    private static List<Dashboard> Rows(string status) =>
    [
        new() { DashboardId = 1, DashboardName = "Board", CategoryId = 1, Status = status, ConfigJson = V1, IsLatestVersion = true },
        new() { DashboardId = 2, DashboardName = "Old board", CategoryId = 1, Status = status, ConfigJson = null, IsLatestVersion = true },
        new() { DashboardId = 3, DashboardName = "Canvas", CategoryId = 1, Status = status, ConfigJson = CanvasJson, IsLatestVersion = true },
    ];

    private static Mock<IDashboardRepository> Repo(string status)
    {
        var repo = new Mock<IDashboardRepository>();
        repo.Setup(r => r.GetDashboardCategoriesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Category> { new() { CategoryId = 1, CategoryName = "Others" } });
        repo.Setup(r => r.GetDashboardsByCreatorAsync("7", It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Rows(status));
        repo.Setup(r => r.GetPublishedListAsync(It.IsAny<bool>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Rows(status));
        return repo;
    }

    private static Mock<ICurrentUserService> User()
    {
        var user = new Mock<ICurrentUserService>();
        user.Setup(u => u.UserId).Returns("7");
        user.Setup(u => u.Roles).Returns(new List<string>());
        return user;
    }

    private static IEnumerable<int> Ids(Result<IReadOnlyList<DashboardCategoryResponse>> result)
        => result.Value!.SelectMany(c => c.Dashboards).Select(d => d.DashboardId);

    private static GetWipDashboardsHandler Wip()
        => new(Repo(DashboardStatus.Draft).Object, User().Object, Mock.Of<ILogger<GetWipDashboardsHandler>>());

    [Fact]
    public async Task Wip_list_without_a_kind_keeps_every_dashboard_and_leaves_out_canvases()
        => Ids(await Wip().Handle(new GetWipDashboardsQuery(), CancellationToken.None)).Should().Equal(1, 2);

    [Fact]
    public async Task Wip_list_of_kind_canvas_holds_only_canvases()
        => Ids(await Wip().Handle(new GetWipDashboardsQuery("canvas"), CancellationToken.None)).Should().Equal(3);

    [Fact]
    public async Task An_unknown_kind_is_refused()
    {
        var result = await Wip().Handle(new GetWipDashboardsQuery("report"), CancellationToken.None);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Be(DashboardKind.UnknownKindMessage);
    }

    [Fact]
    public async Task An_unknown_kind_is_refused_by_every_list()
    {
        var published = await new GetPublishedDashboardsHandler(
                Repo(DashboardStatus.Published).Object, User().Object, Mock.Of<ILogger<GetPublishedDashboardsHandler>>())
            .Handle(new GetPublishedDashboardsQuery("report"), CancellationToken.None);
        var minimal = await new GetWipDashboardsMinimalHandler(Repo(DashboardStatus.Draft).Object, User().Object)
            .Handle(new GetWipDashboardsMinimalQuery("report"), CancellationToken.None);
        var shared = await new GetSharedWithMeDashboardsHandler(
                Repo(DashboardStatus.Draft).Object, User().Object, Mock.Of<ILogger<GetSharedWithMeDashboardsHandler>>())
            .Handle(new GetSharedWithMeDashboardsQuery("report"), CancellationToken.None);

        published.IsValidationError.Should().BeTrue();
        published.ErrorMessage.Should().Be(DashboardKind.UnknownKindMessage);
        minimal.IsValidationError.Should().BeTrue();
        minimal.ErrorMessage.Should().Be(DashboardKind.UnknownKindMessage);
        shared.IsValidationError.Should().BeTrue();
        shared.ErrorMessage.Should().Be(DashboardKind.UnknownKindMessage);
    }

    [Fact]
    public async Task Filtering_keeps_the_list_order_and_counts_only_the_kept_rows()
    {
        var repo = new Mock<IDashboardRepository>();
        repo.Setup(r => r.GetDashboardCategoriesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new List<Category>
        {
            new() { CategoryId = 1, CategoryName = "Others" },
            new() { CategoryId = 2, CategoryName = "Fleet" },
        });
        repo.Setup(r => r.GetDashboardsByCreatorAsync("7", It.IsAny<IEnumerable<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Dashboard>
            {
                new() { DashboardId = 9, DashboardName = "Z", CategoryId = 1, Status = DashboardStatus.Draft, ConfigJson = V1 },
                new() { DashboardId = 4, DashboardName = "C1", CategoryId = 1, Status = DashboardStatus.Draft, ConfigJson = CanvasJson },
                new() { DashboardId = 2, DashboardName = "A", CategoryId = 1, Status = DashboardStatus.Draft, ConfigJson = null },
                new() { DashboardId = 8, DashboardName = "C2", CategoryId = 2, Status = DashboardStatus.Draft, ConfigJson = CanvasJson },
                new() { DashboardId = 5, DashboardName = "B", CategoryId = 2, Status = DashboardStatus.Draft, ConfigJson = V1 },
                new() { DashboardId = 6, DashboardName = "C3", CategoryId = 1, Status = DashboardStatus.Draft, ConfigJson = CanvasJson },
            });
        var handler = new GetWipDashboardsHandler(repo.Object, User().Object, Mock.Of<ILogger<GetWipDashboardsHandler>>());

        var dashboards = (await handler.Handle(new GetWipDashboardsQuery(), CancellationToken.None)).Value!;
        var canvases = (await handler.Handle(new GetWipDashboardsQuery("canvas"), CancellationToken.None)).Value!;
        var minimal = (await new GetWipDashboardsMinimalHandler(repo.Object, User().Object)
            .Handle(new GetWipDashboardsMinimalQuery(), CancellationToken.None)).Value!;

        dashboards.Select(c => (c.CategoryId, c.DashboardCount, Ids: string.Join(",", c.Dashboards.Select(d => d.DashboardId))))
            .Should().Equal((1, 2, "9,2"), (2, 1, "5"));
        canvases.Select(c => (c.CategoryId, c.DashboardCount, Ids: string.Join(",", c.Dashboards.Select(d => d.DashboardId))))
            .Should().Equal((1, 2, "4,6"), (2, 1, "8"));
        minimal.Select(d => d.DashboardId).Should().Equal(9, 2, 5);
    }

    [Fact]
    public async Task Published_list_leaves_out_canvases_unless_asked()
    {
        var handler = new GetPublishedDashboardsHandler(
            Repo(DashboardStatus.Published).Object, User().Object, Mock.Of<ILogger<GetPublishedDashboardsHandler>>());

        Ids(await handler.Handle(new GetPublishedDashboardsQuery(), CancellationToken.None)).Should().Equal(1, 2);
        Ids(await handler.Handle(new GetPublishedDashboardsQuery("canvas"), CancellationToken.None)).Should().Equal(3);
    }

    [Fact]
    public async Task Minimal_wip_list_for_the_copy_picker_leaves_out_canvases()
    {
        var handler = new GetWipDashboardsMinimalHandler(Repo(DashboardStatus.Draft).Object, User().Object);

        var result = await handler.Handle(new GetWipDashboardsMinimalQuery(), CancellationToken.None);

        result.Value!.Select(d => d.DashboardId).Should().Equal(1, 2);
    }

    [Fact]
    public async Task Shared_with_me_list_leaves_out_canvases_unless_asked()
    {
        var repo = Repo(DashboardStatus.Draft);
        repo.Setup(r => r.GetAllDashboardsForShareLookupAsync(It.IsAny<CancellationToken>())).ReturnsAsync(new List<Dashboard>
        {
            new() { DashboardId = 1, DashboardName = "Board", CategoryId = 1, Status = DashboardStatus.Draft,
                ConfigJson = """{"widgets":[],"_meta":{"sharedWithUserIds":[7]}}""" },
            new() { DashboardId = 3, DashboardName = "Canvas", CategoryId = 1, Status = DashboardStatus.Draft,
                ConfigJson = """{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[]},"_meta":{"sharedWithUserIds":[7]}}""" },
        });
        var handler = new GetSharedWithMeDashboardsHandler(repo.Object, User().Object, Mock.Of<ILogger<GetSharedWithMeDashboardsHandler>>());

        Ids(await handler.Handle(new GetSharedWithMeDashboardsQuery(), CancellationToken.None)).Should().Equal(1);
        Ids(await handler.Handle(new GetSharedWithMeDashboardsQuery("canvas"), CancellationToken.None)).Should().Equal(3);
    }
}
