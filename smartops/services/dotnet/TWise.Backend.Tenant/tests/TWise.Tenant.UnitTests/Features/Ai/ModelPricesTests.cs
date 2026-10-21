using TWise.Tenant.Application.Features.Ai.ModelPrices;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.UnitTests.Features.Ai;

public sealed class ModelPricesTests
{
    [Theory]
    [InlineData("gpt-5.6-luna", "frontier", 1.25, 10, true)]
    [InlineData("gpt-4o-mini", "fast", 0.15, 0.6, true)]
    [InlineData("", "fast", 1, 1, false)]
    [InlineData("m", "cheap", 1, 1, false)]
    [InlineData("m", "fast", -1, 1, false)]
    public void Validator_ChecksEachPrice(string model, string modelClass, double input, double output, bool valid) =>
        new SaveAiModelPricesCommandValidator().Validate(new SaveAiModelPricesCommand(1, "u",
            [new AiModelPriceDto(model, modelClass, (decimal)input, (decimal)output)])).IsValid.Should().Be(valid);

    [Fact]
    public void Validator_RefusesTheSameModelTwice() =>
        new SaveAiModelPricesCommandValidator().Validate(new SaveAiModelPricesCommand(1, "u",
            [new AiModelPriceDto("GPT-4o", "standard", 1, 1), new AiModelPriceDto("gpt-4o", "fast", 1, 1)])).IsValid.Should().BeFalse();
}
