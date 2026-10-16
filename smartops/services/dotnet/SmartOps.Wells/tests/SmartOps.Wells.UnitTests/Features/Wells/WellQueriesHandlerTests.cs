using FluentAssertions;
using Moq;
using SmartOps.Wells.Application.Abstractions;
using SmartOps.Wells.Application.Features.Wells;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.UnitTests.Features.Wells;

public sealed class WellQueriesHandlerTests
{
    // ── ListClusters ──────────────────────────────────────────────────────────

    [Fact]
    public async Task ListClustersQueryHandler_Returns_AllClusters()
    {
        // Arrange
        var expected = new List<ClusterDto>
        {
            new(1, "NIMR", "NIMR Cluster", "#2563eb", 10, 7, 70.0),
            new(2, "AMIN", "AMIN Cluster", "#16a34a", 10, 6, 60.0)
        };
        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.ListClustersAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(expected);

        var handler = new ListClustersQueryHandler(repoMock.Object);

        // Act
        var result = await handler.Handle(new ListClustersQuery(), CancellationToken.None);

        // Assert
        result.Should().BeEquivalentTo(expected);
        repoMock.Verify(r => r.ListClustersAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── GetWell ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetWellQueryHandler_Returns_Well_When_Found()
    {
        var wellDto = new WellDto(1, "34565", "NIMR", "Location", "Oil Producer", null, null,
            null, null, 78, 75, 8.4, 7.1, "Apr 28", "On Track", 1.04, 0.98);

        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.GetWellAsync("34565", It.IsAny<CancellationToken>()))
                .ReturnsAsync(wellDto);

        var handler = new GetWellQueryHandler(repoMock.Object);

        var result = await handler.Handle(new GetWellQuery("34565"), CancellationToken.None);

        result.Should().NotBeNull();
        result!.WellId.Should().Be("34565");
    }

    [Fact]
    public async Task GetWellQueryHandler_Returns_Null_When_NotFound()
    {
        var repoMock = new Mock<IWellsRepository>();
        repoMock.Setup(r => r.GetWellAsync("NONEXISTENT", It.IsAny<CancellationToken>()))
                .ReturnsAsync((WellDto?)null);

        var handler = new GetWellQueryHandler(repoMock.Object);

        var result = await handler.Handle(new GetWellQuery("NONEXISTENT"), CancellationToken.None);

        result.Should().BeNull();
    }
}
