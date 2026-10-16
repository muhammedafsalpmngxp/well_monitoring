using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Operations;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class AuditEventsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly AuditEventsController _sut;

    private static readonly AuditEventDto Sample = new(1, 10, 5, "CREATE", "Tenant", "Tenant created", null);
    private static readonly AuditEventCreateRequest CreateReq = new(10, 5, "CREATE", "Tenant", "Tenant created", null);
    private static readonly AuditEventUpdateRequest UpdateReq = new(10, 5, "CREATE", "Tenant", "Resolved: no issue", null);

    public AuditEventsControllerTests() => _sut = new AuditEventsController(_sender.Object);

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<AuditEventDto> { Sample };
        _sender.Setup(s => s.Send(It.IsAny<ListAuditEventsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<AuditEventDto>>.Success(new PagedResult<AuditEventDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListAuditEventsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<AuditEventDto>>.Success(new PagedResult<AuditEventDto>(new List<AuditEventDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetAuditEventQuery(1), default)).ReturnsAsync(Result<AuditEventDto>.Success(Sample));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetAuditEventQuery(999), default)).ReturnsAsync(Result<AuditEventDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateAuditEventCommand(CreateReq), default)).ReturnsAsync(Result<AuditEventDto>.Success(Sample));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(Sample);
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateAuditEventCommand(1, UpdateReq), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateAuditEventCommand(999, UpdateReq), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteAuditEventCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteAuditEventCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
