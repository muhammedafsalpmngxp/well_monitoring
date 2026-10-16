using System.Text.Json;
using FluentAssertions;
using TWise.Tenant.Application.Features.Canvas;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Canvas;

public class BrandKitRulesTests
{
    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    [Fact]
    public void A_named_kit_object_can_be_saved()
        => BrandKitRules.Problem(new BrandKitRequest(" Tasnim ", Json("{\"colors\":[\"#112233\"]}"))).Should().BeNull();

    [Theory]
    [InlineData("", "{}", "Give the brand kit a name.")]
    [InlineData("Kit", "[1]", "The brand kit is missing.")]
    public void Blank_names_and_non_objects_are_refused(string name, string kit, string problem)
        => BrandKitRules.Problem(new BrandKitRequest(name, Json(kit))).Should().Be(problem);

    [Fact]
    public void Long_names_and_huge_kits_are_refused()
    {
        BrandKitRules.Problem(new BrandKitRequest(new string('a', 81), Json("{}"))).Should().Contain("80 characters");
        var huge = Json("{\"logo\":\"" + new string('x', BrandKitRules.MaxKitLength) + "\"}");
        BrandKitRules.Problem(new BrandKitRequest("Kit", huge)).Should().Contain("too large");
    }
}
