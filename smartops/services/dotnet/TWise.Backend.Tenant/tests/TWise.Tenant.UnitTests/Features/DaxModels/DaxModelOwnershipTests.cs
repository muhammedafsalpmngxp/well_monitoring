using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.DaxModels;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.DaxModels;

/// <summary>Each user sees and edits only their own DAX models; admins see and edit all.</summary>
public class DaxModelOwnershipTests
{
    private static readonly DaxModelSaveRequest Request =
        new("Total Hours", "Table", "activity_task_plan", "Column", "SUM", ["planned_manhours"], "SUM([planned_manhours])", "Active");

    private static Mock<IDaxModelRepository> Repo()
    {
        var repo = new Mock<IDaxModelRepository>();
        repo.Setup(r => r.ListAsync(It.IsAny<DaxModelListFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Array.Empty<SavedDaxModel>(), 0));
        repo.Setup(r => r.CountBySourceTypeAsync(It.IsAny<long?>(), It.IsAny<CancellationToken>())).ReturnsAsync((0, 0, 0));
        repo.Setup(r => r.CountChartUsageAsync(It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<long, int>());
        return repo;
    }

    [Fact]
    public async Task A_user_lists_only_their_own_models()
    {
        var repo = Repo();
        await new ListDaxModelsHandler(repo.Object, Mock.Of<IRecipientResolver>()).Handle(new ListDaxModelsQuery(null, null, null, UserId: 7, IsAdmin: false, TenantId: 1), default);

        repo.Verify(r => r.ListAsync(It.Is<DaxModelListFilter>(f => f.OwnerId == 7), It.IsAny<CancellationToken>()));
        repo.Verify(r => r.CountBySourceTypeAsync(7, It.IsAny<CancellationToken>()));
    }

    [Fact]
    public async Task An_admin_lists_every_users_models()
    {
        var repo = Repo();
        await new ListDaxModelsHandler(repo.Object, Mock.Of<IRecipientResolver>()).Handle(new ListDaxModelsQuery(null, null, null, UserId: 1, IsAdmin: true, TenantId: 1), default);

        repo.Verify(r => r.ListAsync(It.Is<DaxModelListFilter>(f => f.OwnerId == null), It.IsAny<CancellationToken>()));
        repo.Verify(r => r.CountBySourceTypeAsync(null, It.IsAny<CancellationToken>()));
    }

    [Fact]
    public async Task Only_admins_get_the_creator_name()
    {
        var repo = Repo();
        repo.Setup(r => r.ListAsync(It.IsAny<DaxModelListFilter>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((new[] { new SavedDaxModel { Id = 1, CreatedBy = 7 }, new SavedDaxModel { Id = 2 } }, 2));
        var directory = new Mock<IRecipientResolver>();
        directory.Setup(d => d.ResolveAsync(1, It.IsAny<IReadOnlyCollection<long>>(), It.IsAny<IReadOnlyCollection<string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([new DirectoryUser(7, "asha@example.com", "Asha", true, [], [], [])]);
        var handler = new ListDaxModelsHandler(repo.Object, directory.Object);

        var admin = await handler.Handle(new ListDaxModelsQuery(null, null, null, UserId: 1, IsAdmin: true, TenantId: 1), default);
        var user = await handler.Handle(new ListDaxModelsQuery(null, null, null, UserId: 7, IsAdmin: false, TenantId: 1), default);

        admin.Items.Select(i => i.CreatedByName).Should().Equal("Asha", "Unknown");
        user.Items.Select(i => i.CreatedByName).Should().AllBeEquivalentTo((string?)null);
    }

    [Fact]
    public async Task A_new_model_belongs_to_its_creator()
    {
        var repo = Repo();
        repo.Setup(r => r.AddAsync(It.IsAny<SavedDaxModel>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((SavedDaxModel m, CancellationToken _) => m);

        await new CreateDaxModelHandler(repo.Object).Handle(new CreateDaxModelCommand(Request, UserId: 7), default);

        repo.Verify(r => r.AddAsync(It.Is<SavedDaxModel>(m => m.CreatedBy == 7), It.IsAny<CancellationToken>()));
    }

    [Fact]
    public async Task A_user_cannot_update_another_users_model()
    {
        var repo = Repo();
        // The repository only returns the model to its owner (ownerId 7); user 8 gets nothing back.
        repo.Setup(r => r.GetByIdAsync(5, 7, It.IsAny<CancellationToken>())).ReturnsAsync(new SavedDaxModel { Id = 5, CreatedBy = 7 });

        var result = await new UpdateDaxModelHandler(repo.Object).Handle(new UpdateDaxModelCommand(5, Request, UserId: 8, IsAdmin: false), default);

        result.Should().BeNull();
        repo.Verify(r => r.UpdateAsync(It.IsAny<SavedDaxModel>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task An_admin_can_update_any_users_model()
    {
        var repo = Repo();
        repo.Setup(r => r.GetByIdAsync(5, null, It.IsAny<CancellationToken>())).ReturnsAsync(new SavedDaxModel { Id = 5, CreatedBy = 7 });

        var result = await new UpdateDaxModelHandler(repo.Object).Handle(new UpdateDaxModelCommand(5, Request, UserId: 1, IsAdmin: true), default);

        result.Should().NotBeNull();
        repo.Verify(r => r.UpdateAsync(It.Is<SavedDaxModel>(m => m.CreatedBy == 7), It.IsAny<CancellationToken>()));
    }
}
