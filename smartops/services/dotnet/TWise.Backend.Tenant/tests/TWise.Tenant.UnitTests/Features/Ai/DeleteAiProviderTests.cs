using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Ai.Settings;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>Settings → AI Providers: Delete removes the provider row for good; the active one cannot be deleted.</summary>
public class DeleteAiProviderTests
{
    [Fact]
    public async Task An_inactive_provider_is_deleted_for_real()
    {
        var provider = new AiProvider { Id = 3, TenantId = 2, IsActive = false };
        var repo = new Mock<IAiProviderRepository>();
        repo.Setup(r => r.GetAsync(3, 2, It.IsAny<CancellationToken>())).ReturnsAsync(provider);

        var deleted = await new DeleteAiProviderHandler(repo.Object).Handle(new DeleteAiProviderCommand(2, "admin", 3), default);

        deleted.Should().BeTrue();
        repo.Verify(r => r.DeleteAsync(provider, It.IsAny<CancellationToken>()), Times.Once);
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task The_active_provider_is_refused_and_an_unknown_one_is_not_found()
    {
        var repo = new Mock<IAiProviderRepository>();
        repo.Setup(r => r.GetAsync(2, 2, It.IsAny<CancellationToken>())).ReturnsAsync(new AiProvider { Id = 2, TenantId = 2, IsActive = true });
        var handler = new DeleteAiProviderHandler(repo.Object);

        await handler.Invoking(h => h.Handle(new DeleteAiProviderCommand(2, "admin", 2), default))
            .Should().ThrowAsync<InvalidOperationException>();
        (await handler.Handle(new DeleteAiProviderCommand(2, "admin", 99), default)).Should().BeFalse();
        repo.Verify(r => r.DeleteAsync(It.IsAny<AiProvider>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
