using FluentAssertions;
using Moq;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Application.Common;
using SmartOps.Wells.Application.Features.Wells;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.UnitTests.Features.Wells;

public sealed class WellCommandsHandlerTests
{
    // ── CreateWell ────────────────────────────────────────────────────────────

    [Fact]
    public async Task CreateWellCommandHandler_Returns_Success_Result()
    {
        var request = new WellCreateRequest("99999", "NIMR", null, null, null, null, null, null);
        var created = new WellDto(99, "99999", "NIMR", null, null, null, null,
            null, null, 0, 0, 0, 0, null, "On Track", null, null);

        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.CreateWellAsync(request, It.IsAny<CancellationToken>()))
                .ReturnsAsync(created);

        var handler = new CreateWellCommandHandler(repoMock.Object);

        var result = await handler.Handle(new CreateWellCommand(request), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.WellId.Should().Be("99999");
    }

    [Fact]
    public async Task CreateWellCommandHandler_Returns_Conflict_When_Duplicate()
    {
        var request = new WellCreateRequest("34565", "NIMR", null, null, null, null, null, null);

        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.CreateWellAsync(request, It.IsAny<CancellationToken>()))
                .ThrowsAsync(new ArgumentException("Well '34565' already exists."));

        var handler = new CreateWellCommandHandler(repoMock.Object);

        var result = await handler.Handle(new CreateWellCommand(request), CancellationToken.None);

        result.IsConflict.Should().BeTrue();
        result.ErrorMessage.Should().Contain("already exists");
    }

    // ── DeleteWell ────────────────────────────────────────────────────────────

    [Fact]
    public async Task DeleteWellCommandHandler_Returns_Success_When_Deleted()
    {
        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.DeleteWellAsync("34565", It.IsAny<CancellationToken>()))
                .ReturnsAsync(true);

        var result = await new DeleteWellCommandHandler(repoMock.Object)
            .Handle(new DeleteWellCommand("34565"), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task DeleteWellCommandHandler_Returns_NotFound_When_Missing()
    {
        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.DeleteWellAsync("MISSING", It.IsAny<CancellationToken>()))
                .ReturnsAsync(false);

        var result = await new DeleteWellCommandHandler(repoMock.Object)
            .Handle(new DeleteWellCommand("MISSING"), CancellationToken.None);

        result.IsNotFound.Should().BeTrue();
    }
}
