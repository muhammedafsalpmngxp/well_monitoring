using System.Reflection;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Controllers;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Common;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Common;

public sealed class SyncTimeTests
{
    private static readonly SyncTimeResponse LatestSync =
        new(new DateTimeOffset(2026, 10, 20, 2, 15, 11, TimeSpan.FromHours(4)));

    [Fact]
    public async Task Controller_returns_the_sync_time_and_forwards_cancellation()
    {
        using var cancellation = new CancellationTokenSource();
        var sender = new Mock<ISender>(MockBehavior.Strict);
        sender.Setup(s => s.Send(It.IsAny<GetSyncTimeQuery>(), cancellation.Token))
            .ReturnsAsync(LatestSync);

        var result = await Controller(sender.Object).GetSyncTime(cancellation.Token);

        result.Result.Should().BeOfType<OkObjectResult>()
            .Which.Value.Should().BeSameAs(LatestSync);
        sender.Verify(s => s.Send(It.IsAny<GetSyncTimeQuery>(), cancellation.Token), Times.Once);
    }

    [Fact]
    public async Task Controller_returns_not_found_when_no_sync_timestamp_exists()
    {
        var sender = new Mock<ISender>(MockBehavior.Strict);
        sender.Setup(s => s.Send(It.IsAny<GetSyncTimeQuery>(), CancellationToken.None))
            .ReturnsAsync((SyncTimeResponse?)null);

        var result = await Controller(sender.Object).GetSyncTime(CancellationToken.None);

        var response = result.Result.Should().BeOfType<ObjectResult>().Subject;
        response.StatusCode.Should().Be(StatusCodes.Status404NotFound);
        var problem = response.Value.Should().BeOfType<ProblemDetails>().Subject;
        problem.Status.Should().Be(StatusCodes.Status404NotFound);
        problem.Title.Should().Be("Sync time not found");
        problem.Detail.Should().Be("No successful migration sync timestamp is available.");
    }

    [Fact]
    public async Task Controller_leaves_failures_to_the_global_error_handler()
    {
        var failure = new InvalidOperationException("Database unavailable.");
        var sender = new Mock<ISender>(MockBehavior.Strict);
        sender.Setup(s => s.Send(It.IsAny<GetSyncTimeQuery>(), CancellationToken.None))
            .ThrowsAsync(failure);

        var act = () => Controller(sender.Object).GetSyncTime(CancellationToken.None);

        (await act.Should().ThrowAsync<InvalidOperationException>()).Which.Should().BeSameAs(failure);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Handler_preserves_the_service_result_and_cancellation(bool hasTimestamp)
    {
        using var cancellation = new CancellationTokenSource();
        var expected = hasTimestamp ? LatestSync : null;
        var service = new Mock<ISourceService>(MockBehavior.Strict);
        service.Setup(s => s.GetSyncTimeAsync(cancellation.Token)).ReturnsAsync(expected);

        var result = await new GetSyncTimeHandler(service.Object)
            .Handle(new GetSyncTimeQuery(), cancellation.Token);

        result.Should().BeSameAs(expected);
        service.Verify(s => s.GetSyncTimeAsync(cancellation.Token), Times.Once);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Service_preserves_the_repository_result_and_cancellation(bool hasTimestamp)
    {
        using var cancellation = new CancellationTokenSource();
        var expected = hasTimestamp ? LatestSync : null;
        var repository = new Mock<ISourceRepository>(MockBehavior.Strict);
        repository.Setup(r => r.GetSyncTimeAsync(cancellation.Token)).ReturnsAsync(expected);

        var result = await new SourceService(repository.Object).GetSyncTimeAsync(cancellation.Token);

        result.Should().BeSameAs(expected);
        repository.Verify(r => r.GetSyncTimeAsync(cancellation.Token), Times.Once);
    }

    [Fact]
    public void Response_serializes_the_Oman_offset_without_an_additional_conversion()
    {
        var json = JsonSerializer.Serialize(LatestSync, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var document = JsonDocument.Parse(json);

        document.RootElement.GetProperty("omanTimestamp").GetString()
            .Should().Be("2026-10-20T02:15:11+04:00");
        LatestSync.OmanTimestamp.UtcDateTime.Should().Be(
            new DateTime(2026, 10, 19, 22, 15, 11, DateTimeKind.Utc));
    }

    [Fact]
    public void Endpoint_uses_the_common_route_and_requires_authentication()
    {
        var controller = typeof(CommonController);
        var method = controller.GetMethod(nameof(CommonController.GetSyncTime))!;

        controller.GetCustomAttribute<RouteAttribute>()!.Template.Should().Be("api/common");
        method.GetCustomAttribute<HttpGetAttribute>()!.Template.Should().Be("sync-time");
        controller.GetCustomAttribute<AuthorizeAttribute>().Should().NotBeNull();
        method.GetCustomAttribute<AllowAnonymousAttribute>().Should().BeNull();
    }

    private static CommonController Controller(ISender sender) =>
        new(sender, Mock.Of<IDashboardShareAccessService>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
}
