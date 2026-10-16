using FluentAssertions;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;
using Xunit;

namespace TWise.Backend.ControlPlane.UnitTests.Features.Access;

public sealed class UserDirectoryTests
{
    private static readonly AppUser[] Users =
    [
        new() { UserId = 1, Email = "ana@t.om", DisplayName = "Ana", IsActive = true },
        new() { UserId = 2, Email = "ben@t.om", DisplayName = null, IsActive = false },
        new() { UserId = 3, Email = "cy@t.om", DisplayName = "Cy", IsActive = true },
        new() { UserId = 4, Email = "dan@other.om", DisplayName = "Dan", IsActive = true },
    ];

    private static readonly Role[] Roles =
    [
        new() { RoleId = 10, RoleCode = "planner" },
        new() { RoleId = 11, RoleCode = "tenant_admin" },
        new() { RoleId = 12, RoleCode = "retired", IsActive = false },
    ];

    private static readonly UserTenantRole[] TenantRoles =
    [
        new() { UserId = 1, TenantId = 2, RoleId = 10, IsActive = true },
        new() { UserId = 1, TenantId = 2, RoleId = 11, IsActive = true },
        new() { UserId = 2, TenantId = 2, RoleId = 10, IsActive = true },
        new() { UserId = 3, TenantId = 2, RoleId = 10, IsActive = false },
        new() { UserId = 4, TenantId = 9, RoleId = 10, IsActive = true },
        new() { UserId = 3, TenantId = 2, RoleId = 12, IsActive = true },
    ];

    private static readonly UserPlantAccess[] Plants =
    [
        new() { UserId = 1, PlantCode = 101, IsActive = true },
        new() { UserId = 1, PlantCode = 102, IsActive = false },
    ];

    private static List<DirectoryUserDto> Resolve(List<long>? ids, List<string>? codes)
        => UserDirectory.Resolve(new ResolveUsersRequest(2, ids, codes), Users, TenantRoles, Roles, Plants,
            new Dictionary<int, List<string>> { [10] = ["reports.my-reports"], [11] = ["smart-alerts.schedules", "reports.my-reports"] });

    [Fact]
    public void A_user_comes_with_roles_and_active_plants_of_the_tenant()
        => Resolve([1], null).Should().BeEquivalentTo([new DirectoryUserDto(1, "ana@t.om", "Ana", true, ["planner", "tenant_admin"], [101], ["reports.my-reports", "smart-alerts.schedules"])]);

    [Fact]
    public void A_role_code_expands_to_its_users_ignoring_case()
        => Resolve(null, ["PLANNER"]).Select(u => u.UserId).Should().Equal(1, 2);

    [Fact]
    public void An_inactive_user_is_returned_as_inactive()
        => Resolve([2], null).Single().IsActive.Should().BeFalse();

    [Fact]
    public void Users_without_an_active_role_in_the_tenant_are_left_out()
        => Resolve([3, 4], ["planner"]).Select(u => u.UserId).Should().Equal(1, 2);

    [Fact]
    public void A_user_named_twice_comes_once()
        => Resolve([1], ["planner", "tenant_admin"]).Count(u => u.UserId == 1).Should().Be(1);

    [Fact]
    public void An_inactive_role_gives_neither_access_nor_role_expansion()
    {
        Resolve([3], null).Should().BeEmpty();
        Resolve(null, ["retired"]).Should().BeEmpty();
    }
}
