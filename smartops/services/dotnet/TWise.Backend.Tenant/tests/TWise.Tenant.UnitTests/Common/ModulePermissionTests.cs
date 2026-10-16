using System.Security.Claims;
using TWise.Tenant.Application.Common;

namespace TWise.Tenant.UnitTests.Common;

public sealed class ModulePermissionTests
{
    private static ClaimsPrincipal User(params Claim[] claims) => new(new ClaimsIdentity(claims, "test"));

    [Theory]
    [InlineData("model.studio:v", 'v', true)]
    [InlineData("model.studio:vcm", 'm', true)]
    [InlineData("model.studio:v", 'c', false)]
    [InlineData("model.studio.extra:vcma", 'v', false)]
    [InlineData("settings.database-view:vcma", 'v', false)]
    [InlineData("model.studio", 'v', false)]
    public void Perm_claim_grants_only_its_own_module_and_flags(string perm, char action, bool expected)
        => ModulePermission.Has(User(new Claim("perm", perm)), "model.studio", action).Should().Be(expected);

    [Fact]
    public void Each_module_has_its_own_perm_claim()
        => ModulePermission.Has(
                User(new Claim("perm", "dashboard.wip-boards:v"), new Claim("perm", "model.studio:vc")), "model.studio", 'c')
            .Should().BeTrue();

    [Theory]
    [InlineData(ClaimTypes.Role)]
    [InlineData("role")]
    public void Admin_role_passes_without_perm_claims(string claimType)
        => ModulePermission.Has(User(new Claim(claimType, "Admin")), "model.studio", 'm').Should().BeTrue();

    [Fact]
    public void No_claims_means_no_access()
        => ModulePermission.Has(User(), "model.studio", 'v').Should().BeFalse();

    [Theory]
    [InlineData("model.studio:v", true)]
    [InlineData("dashboard.canvas:v", true)]
    [InlineData("model.standard-datasets:v", true)]
    [InlineData("dashboard.standard-canvases:v", true)]
    [InlineData("dashboard.canvas:cm", false)]
    [InlineData("dashboard.wip-boards:vcma", false)]
    public void Datasets_can_be_read_through_model_studio_or_the_canvas(string perm, bool expected)
        => ModulePermission.CanReadModel(User(new Claim("perm", perm))).Should().Be(expected);

    [Fact]
    public void Admin_can_read_datasets_without_perm_claims()
        => ModulePermission.CanReadModel(User(new Claim(ClaimTypes.Role, "admin"))).Should().BeTrue();
}
