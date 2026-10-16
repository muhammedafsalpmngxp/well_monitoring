using TWise.Tenant.Application.Features.Model.Datasets;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class DatasetValidatorTests
{
    private static AddSourceCommand AddSource(string alias, string rlsMode = "none", string? plantColumn = null)
        => new(1, new AddSourceRequest("core", "TaskDaily", alias, rlsMode, plantColumn), 2);

    [Theory]
    [InlineData("Task.Daily")]
    [InlineData("1st")]
    [InlineData("")]
    public void Alias_must_be_a_plain_identifier(string alias)
        => new AddSourceCommandValidator().Validate(AddSource(alias)).IsValid.Should().BeFalse();

    [Fact]
    public void Plant_filter_without_a_column_is_refused()
        => new AddSourceCommandValidator().Validate(AddSource("TaskDaily", "plant"))
            .Errors.Should().ContainSingle(e => e.ErrorMessage == "Choose the column that holds the plant code.");

    [Fact]
    public void Complete_source_request_passes()
        => new AddSourceCommandValidator().Validate(AddSource("TaskDaily")).IsValid.Should().BeTrue();

    [Fact]
    public void Blank_dataset_name_is_refused()
        => new CreateDatasetCommandValidator().Validate(new CreateDatasetCommand(new CreateDatasetRequest("   ", null, 4), 2, 7))
            .IsValid.Should().BeFalse();

    [Theory]
    [InlineData("rename", "x")]
    [InlineData("Trim", null)]
    [InlineData("null_fill", null)]
    public void Only_trim_and_a_fill_with_a_value_pass(string kind, string? value)
        => new AddTransformCommandValidator().Validate(new AddTransformCommand(1, new AddTransformRequest(1, "code", kind, value), 2))
            .IsValid.Should().BeFalse();

    [Fact]
    public void A_fill_with_a_value_passes()
        => new AddTransformCommandValidator().Validate(new AddTransformCommand(1, new AddTransformRequest(1, "code", "null_fill", ""), 2))
            .IsValid.Should().BeTrue();

    public static TheoryData<string, string?, Dictionary<string, string>?> NewTransformsThatPass => new()
    {
        { "replace", "-", new() { ["with"] = "" } },
        { "replace", "N/A", new() { ["with"] = "None", ["match"] = "whole" } },
        { "type", "number", null },
        { "type", "date", new() { ["style"] = "dmy" } },
        { "remove_rows", "Test", new() { ["op"] = "contains" } },
        { "remove_rows", null, new() { ["op"] = "blank" } },
    };

    [Theory]
    [MemberData(nameof(NewTransformsThatPass))]
    public void Replace_type_and_remove_rows_pass_with_their_settings(string kind, string? value, Dictionary<string, string>? options)
        => new AddTransformCommandValidator().Validate(new AddTransformCommand(1, new AddTransformRequest(1, "code", kind, value, options), 2))
            .IsValid.Should().BeTrue();

    public static TheoryData<string, string?, Dictionary<string, string>?> NewTransformsThatFail => new()
    {
        { "replace", "", new() { ["with"] = "x" } },
        { "replace", "-", null },
        { "type", "boolean", null },
        { "type", "date", new() { ["style"] = "ymd" } },
        { "remove_rows", "x", new() { ["op"] = "like" } },
        { "remove_rows", null, new() { ["op"] = "eq" } },
        { "remove_rows", "", new() { ["op"] = "contains" } },
        { "remove_rows", "", new() { ["op"] = "starts_with" } },
        { "remove_rows", "", new() { ["op"] = "ends_with" } },
        { "trim", null, new() { ["colour"] = "red" } },
    };

    [Theory]
    [MemberData(nameof(NewTransformsThatFail))]
    public void Replace_type_and_remove_rows_fail_without_the_settings_they_need(string kind, string? value, Dictionary<string, string>? options)
        => new AddTransformCommandValidator().Validate(new AddTransformCommand(1, new AddTransformRequest(1, "code", kind, value, options), 2))
            .IsValid.Should().BeFalse();
}
