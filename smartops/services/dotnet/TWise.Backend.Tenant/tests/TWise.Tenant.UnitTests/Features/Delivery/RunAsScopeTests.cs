using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Infrastructure.Services;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public class RunAsScopeTests
{
    private static CurrentUserService Service(ClaimsPrincipal? user = null)
        => new(new HttpContextAccessor { HttpContext = user is null ? null : new DefaultHttpContext { User = user } });

    [Fact]
    public void Inside_a_scope_the_current_user_is_the_run_as_user()
    {
        var caller = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "1"), new Claim(ClaimTypes.Role, "admin")], "Bearer"));
        var service = Service(caller);

        using (RunAsScope.Begin(new DirectoryUser(42, "o@t.om", "Owner", true, ["planner"], [101, 102])))
        {
            service.UserId.Should().Be("42");
            service.Role.Should().Be("planner");
            service.Roles.Should().Equal("planner");
            service.PlantCodes.Should().Equal(101, 102);
        }

        service.UserId.Should().Be("1");
        service.Roles.Should().Equal("admin");
    }

    [Fact]
    public void An_admin_role_code_reads_as_admin()
    {
        using var _ = RunAsScope.Begin(new DirectoryUser(42, "o@t.om", "Owner", true, ["tenant_admin"], []));

        Service().Role.Should().Be("admin");
        Service().Roles.Should().Contain(["tenant_admin", "admin"]);
    }

    [Fact]
    public async Task The_scope_flows_into_awaited_calls_and_ends_with_dispose()
    {
        var service = Service();
        using (RunAsScope.Begin(new DirectoryUser(7, "o@t.om", null, true, [], [])))
        {
            await Task.Yield();
            service.UserId.Should().Be("7");
        }
        service.UserId.Should().BeNull();
    }
}
