using FluentAssertions;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using TWise.Backend.ControlPlane.API.Controllers;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Tenants;
using TWise.Backend.ControlPlane.Domain.DTOs;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Controllers;

public sealed class TenantsControllerTests
{
    private readonly Mock<ISender> _sender = new();
    private readonly TenantsController _sut;

    private static readonly TenantDto SampleTenant =
        new(1, "T01", "Tenant One", 1, "dedicated", null, 1, "active", null, true);

    private static readonly TenantCreateRequest CreateReq =
        new("T01", "Tenant One", 1, "dedicated", null, 1, "active");

    private static readonly TenantUpdateRequest UpdateReq =
        new("T01", "Updated", 1, "dedicated", null, 1, "active");

    public TenantsControllerTests() => _sut = new TenantsController(_sender.Object);

    // ── List ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task List_ReturnsOk_WithItems()
    {
        var items = new List<TenantDto> { SampleTenant };
        _sender.Setup(s => s.Send(It.IsAny<ListTenantsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<TenantDto>>.Success(new PagedResult<TenantDto>(items, items.Count, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task List_ReturnsOk_WhenEmpty()
    {
        _sender.Setup(s => s.Send(It.IsAny<ListTenantsQuery>(), default))
               .ReturnsAsync(Result<PagedResult<TenantDto>>.Success(new PagedResult<TenantDto>(new List<TenantDto>(), 0, 1, 200)));

        var result = await _sut.List(default);

        result.Should().BeOfType<OkObjectResult>()
              ;
    }

    // ── Get ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_ReturnsOk_WhenFound()
    {
        _sender.Setup(s => s.Send(new GetTenantQuery(1), default)).ReturnsAsync(Result<TenantDto>.Success(SampleTenant));

        var result = await _sut.Get(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(SampleTenant);
    }

    [Fact]
    public async Task Get_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetTenantQuery(999), default)).ReturnsAsync(Result<TenantDto>.NotFound());

        var result = await _sut.Get(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── Create ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_ReturnsCreated_WithDto()
    {
        _sender.Setup(s => s.Send(new CreateTenantCommand(CreateReq), default)).ReturnsAsync(Result<TenantDto>.Success(SampleTenant));

        var result = await _sut.Create(CreateReq, default);

        result.Should().BeOfType<CreatedResult>().Which.Value.Should().Be(SampleTenant);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new UpdateTenantCommand(1, UpdateReq), default))
               .ReturnsAsync(Result.Success());

        var result = await _sut.Update(1, UpdateReq, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new UpdateTenantCommand(999, UpdateReq), default))
               .ReturnsAsync(Result.NotFound());

        var result = await _sut.Update(999, UpdateReq, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DeleteTenantCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Delete(1, default);

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DeleteTenantCommand(999), default)).ReturnsAsync(Result.NotFound());

        var result = await _sut.Delete(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── Provision ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Provision_ReturnsAccepted_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new ProvisionTenantCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Provision(1, default);

        result.Should().BeOfType<AcceptedResult>();
    }

    [Fact]
    public async Task Provision_ReturnsNotFound_WhenTenantMissing()
    {
        _sender.Setup(s => s.Send(new ProvisionTenantCommand(999), default))
               .ReturnsAsync(Result.NotFound("Tenant not found"));

        var result = await _sut.Provision(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task Provision_ReturnsConflict_WhenAlreadyProvisioned()
    {
        _sender.Setup(s => s.Send(new ProvisionTenantCommand(1), default))
               .ReturnsAsync(Result.Conflict("Already provisioned"));

        var result = await _sut.Provision(1, default);

        result.Should().BeOfType<ConflictObjectResult>();
    }

    [Fact]
    public async Task Provision_ReturnsBadRequest_WhenValidationError()
    {
        _sender.Setup(s => s.Send(new ProvisionTenantCommand(1), default))
               .ReturnsAsync(Result.ValidationError("Missing region"));

        var result = await _sut.Provision(1, default);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Provision_ReturnsProblem_WhenFailure()
    {
        _sender.Setup(s => s.Send(new ProvisionTenantCommand(1), default))
               .ReturnsAsync(Result.Failure("Infrastructure error"));

        var result = await _sut.Provision(1, default);

        var obj = result.Should().BeOfType<ObjectResult>().Subject;
        obj.StatusCode.Should().Be(StatusCodes.Status500InternalServerError);
    }

    // ── RetryProvision ────────────────────────────────────────────────────────

    [Fact]
    public async Task RetryProvision_ReturnsAccepted_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new RetryProvisionCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.RetryProvision(1, default);

        result.Should().BeOfType<AcceptedResult>();
    }

    [Fact]
    public async Task RetryProvision_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new RetryProvisionCommand(999), default))
               .ReturnsAsync(Result.NotFound("Tenant not found"));

        var result = await _sut.RetryProvision(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── Decommission ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Decommission_ReturnsAccepted_WhenSuccess()
    {
        _sender.Setup(s => s.Send(new DecommissionTenantCommand(1), default)).ReturnsAsync(Result.Success());

        var result = await _sut.Decommission(1, default);

        result.Should().BeOfType<AcceptedResult>();
    }

    [Fact]
    public async Task Decommission_ReturnsNotFound_WhenFailed()
    {
        _sender.Setup(s => s.Send(new DecommissionTenantCommand(999), default))
               .ReturnsAsync(Result.NotFound("Tenant not found"));

        var result = await _sut.Decommission(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // ── ProvisionStatus ───────────────────────────────────────────────────────

    [Fact]
    public async Task ProvisionStatus_ReturnsOk_WhenFound()
    {
        var status = new TenantProvisionStatusDto(1, "provisioning", "step-2", null, 0);
        _sender.Setup(s => s.Send(new GetProvisionStatusQuery(1), default)).ReturnsAsync(Result<TenantProvisionStatusDto>.Success(status));

        var result = await _sut.ProvisionStatus(1, default);

        result.Should().BeOfType<OkObjectResult>().Which.Value.Should().Be(status);
    }

    [Fact]
    public async Task ProvisionStatus_ReturnsNotFound_WhenNull()
    {
        _sender.Setup(s => s.Send(new GetProvisionStatusQuery(999), default))
               .ReturnsAsync(Result<TenantProvisionStatusDto>.NotFound());

        var result = await _sut.ProvisionStatus(999, default);

        result.Should().BeOfType<NotFoundObjectResult>();
    }
}
