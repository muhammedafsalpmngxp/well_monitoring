using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.DaxModels;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.DaxModels;

/// <summary>DFCT0010875: Delete on Settings → Dax Model removes an unused model and keeps one a chart uses.</summary>
public class DeleteDaxModelTests
{
    private static Mock<IDaxModelRepository> Repo(SavedDaxModel? model, long? ownerId, params string[] usedInCharts)
    {
        var repo = new Mock<IDaxModelRepository>();
        repo.Setup(r => r.GetByIdAsync(5, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(model);
        repo.Setup(r => r.ListChartNamesUsingAsync(5, It.IsAny<CancellationToken>())).ReturnsAsync(usedInCharts);
        return repo;
    }

    [Fact]
    public async Task An_unused_model_is_soft_deleted()
    {
        var model = new SavedDaxModel { Id = 5, Name = "testqadax-01", CreatedBy = 7 };
        var repo = Repo(model, ownerId: 7);

        var result = await new DeleteDaxModelHandler(repo.Object).Handle(new DeleteDaxModelCommand(5, UserId: 7, IsAdmin: false), default);

        result.Status.Should().Be(DeleteDaxModelStatus.Deleted);
        model.IsDeleted.Should().BeTrue();
        repo.Verify(r => r.UpdateAsync(model, It.IsAny<CancellationToken>()));
    }

    [Fact]
    public async Task A_model_used_in_a_chart_is_kept()
    {
        var model = new SavedDaxModel { Id = 5, Name = "test01", CreatedBy = 7 };
        var repo = Repo(model, ownerId: 7, "Wells by Plant");

        var result = await new DeleteDaxModelHandler(repo.Object).Handle(new DeleteDaxModelCommand(5, UserId: 7, IsAdmin: false), default);

        result.Status.Should().Be(DeleteDaxModelStatus.InUse);
        result.Name.Should().Be("test01");
        result.UsedInCharts.Should().Equal("Wells by Plant");
        model.IsDeleted.Should().BeFalse();
        repo.Verify(r => r.UpdateAsync(It.IsAny<SavedDaxModel>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_user_cannot_delete_another_users_model()
    {
        var repo = Repo(null, ownerId: 8);

        var result = await new DeleteDaxModelHandler(repo.Object).Handle(new DeleteDaxModelCommand(5, UserId: 8, IsAdmin: false), default);

        result.Status.Should().Be(DeleteDaxModelStatus.NotFound);
        repo.Verify(r => r.UpdateAsync(It.IsAny<SavedDaxModel>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task An_admin_can_delete_any_users_model()
    {
        var model = new SavedDaxModel { Id = 5, Name = "testqadax-01", CreatedBy = 7 };
        var repo = Repo(model, ownerId: null);

        var result = await new DeleteDaxModelHandler(repo.Object).Handle(new DeleteDaxModelCommand(5, UserId: 1, IsAdmin: true), default);

        result.Status.Should().Be(DeleteDaxModelStatus.Deleted);
        model.IsDeleted.Should().BeTrue();
    }
}
