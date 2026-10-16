using FluentAssertions;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Domain.Entities;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class TargetAccessTests
{
    private static bool CanRead(Report report, long userId) => TargetAccess.Reports(1, userId).Compile()(report);
    private static bool CanRead(Dashboard board, long userId) => TargetAccess.Boards(userId).Compile()(board);

    [Fact]
    public void A_report_is_readable_by_its_creator_or_once_published()
    {
        var draft = new Report { Id = 1, TenantId = 1, CreatedBy = 5, Status = "draft" };
        CanRead(draft, 5).Should().BeTrue();
        CanRead(draft, 6).Should().BeFalse();
        CanRead(new Report { Id = 1, TenantId = 1, CreatedBy = 5, Status = "published" }, 6).Should().BeTrue();
    }

    [Fact]
    public void Deleted_and_other_tenant_reports_are_not_readable()
    {
        CanRead(new Report { TenantId = 1, CreatedBy = 5, Status = "published", IsDeleted = true }, 5).Should().BeFalse();
        CanRead(new Report { TenantId = 2, CreatedBy = 5, Status = "published" }, 5).Should().BeFalse();
    }

    [Fact]
    public void A_dashboard_or_canvas_is_readable_by_its_creator_or_once_published()
    {
        var draft = new Dashboard { CreatedBy = "5", Status = DashboardStatus.Draft };
        CanRead(draft, 5).Should().BeTrue();
        CanRead(draft, 6).Should().BeFalse();
        CanRead(new Dashboard { CreatedBy = "5", Status = DashboardStatus.Published }, 6).Should().BeTrue();
        CanRead(new Dashboard { CreatedBy = "5", Status = DashboardStatus.Published, IsDeleted = true }, 5).Should().BeFalse();
    }
}
