using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities.Model;
using static TWise.Tenant.UnitTests.Features.Model.Datasets.DatasetFixture;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

public sealed class ScriptSourceHandlerTests
{
    private const string Batch = "DECLARE @plant NVARCHAR(100) = NULL;\nSELECT c.code AS crew_code, COUNT(*) AS crews FROM ref.CrewType AS c GROUP BY c.code ORDER BY c.code;";

    /// <summary>View 30 on connection 4: it fails the view contract (DECLARE) and runs as written.</summary>
    private static PreparedView SavedView() => new(30, "Crews by code", null, null, ["Rule 1: one SELECT only."], [])
    {
        Text = Batch,
        Script = new ScriptView(Batch, [], [new ViewColumn("crew_code", "nvarchar(20)"), new ViewColumn("crews", "int")]),
    };

    private static DatasetSource Saved(string? paramsJson = null) => new()
    {
        Id = 5, DatasetId = 1, SourceKind = "script", SchemaName = "script", SourceName = "30", Alias = "CrewCount", RlsMode = "none",
        ViewSql = Batch, ParamsJson = paramsJson,
    };

    private static Mock<IDatasetRepository> RepoWith(DatasetParts parts)
    {
        var repo = Repo(NewDataset(), parts);
        repo.Setup(r => r.GetViewsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<long>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { SavedView() });
        repo.Setup(r => r.GetViewSourceColumnsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<DatasetSource>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ScriptSource.CatalogColumns("30", SavedView().Script!.Columns).ToArray());
        return repo;
    }

    [Fact]
    public async Task A_saved_view_is_added_with_its_batch_pinned_as_saved()
    {
        var repo = RepoWith(Parts(Tasks()));

        var result = await new AddSourceHandler(repo.Object).Handle(
            new AddSourceCommand(1, new AddSourceRequest("script", "30", "CrewCount", "none", null, "script"), TenantId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        repo.Verify(r => r.AddAsync(It.Is<DatasetSource>(s => s.SourceKind == "script" && s.SchemaName == "script" && s.SourceName == "30" && s.ViewSql == Batch),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public void A_view_that_cannot_run_as_written_is_refused_with_its_reason()
    {
        var view = SavedView() with { Script = new ScriptView(Batch, ["It runs EXEC."], []) };

        var result = DatasetRules.NewScriptSource(1, new AddSourceRequest("script", "30", "CrewCount", "none", null, "script"), view, []);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Contain("It runs EXEC.");
    }

    [Fact]
    public async Task The_dataset_lists_a_saved_views_parameters_and_sql()
    {
        var repo = RepoWith(Parts(Tasks(), Saved("""{"@plant":"TaskDaily.task_code"}""")));

        var result = await new GetDatasetHandler(repo.Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default);

        var source = result.Value!.Sources.Single(s => s.Kind == "script");
        source.Label.Should().Be("Crews by code");
        source.ViewChanged.Should().BeFalse();
        source.Sql.Should().Be(Batch);
        source.Parameters.Should().Equal(new ScriptParameter("@plant", "nvarchar(100)", "NULL", "TaskDaily.task_code"));
    }

    [Fact]
    public async Task Binding_a_variable_stores_the_field_as_the_model_spells_it()
    {
        var saved = Saved();
        var repo = RepoWith(Parts(Tasks(), saved));

        var result = await new SetSourceParametersHandler(repo.Object).Handle(
            new SetSourceParametersCommand(1, 5, [new ParameterBindingRequest("@PLANT", "taskdaily.TASK_CODE")], TenantId), default);

        result.IsSuccess.Should().BeTrue(result.ErrorMessage);
        saved.ParamsJson.Should().Be("""{"@plant":"TaskDaily.task_code"}""");
        repo.Verify(r => r.SaveAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task A_blank_field_unbinds_the_variable()
    {
        var saved = Saved("""{"@plant":"TaskDaily.task_code"}""");

        await new SetSourceParametersHandler(RepoWith(Parts(Tasks(), saved)).Object).Handle(
            new SetSourceParametersCommand(1, 5, [new ParameterBindingRequest("@plant", null)], TenantId), default);

        saved.ParamsJson.Should().BeNull();
    }

    [Theory]
    [InlineData("@site", "TaskDaily.task_code", "no variable called @site")]
    [InlineData("@plant", "TaskDaily.nothing", "no field called TaskDaily.nothing")]
    [InlineData("@plant", "Nowhere.task_code", "no field called Nowhere.task_code")]
    public async Task Unknown_variables_and_fields_are_refused(string variable, string field, string message)
    {
        var saved = Saved();

        var result = await new SetSourceParametersHandler(RepoWith(Parts(Tasks(), saved)).Object).Handle(
            new SetSourceParametersCommand(1, 5, [new ParameterBindingRequest(variable, field)], TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Contain(message);
        saved.ParamsJson.Should().BeNull();
    }

    [Fact]
    public async Task A_table_has_no_parameters_to_bind()
    {
        var result = await new SetSourceParametersHandler(RepoWith(Parts(Tasks())).Object).Handle(
            new SetSourceParametersCommand(1, 1, [new ParameterBindingRequest("@plant", "TaskDaily.task_code")], TenantId), default);

        result.IsValidationError.Should().BeTrue();
    }
    [Fact]
    public async Task A_variable_the_view_sets_again_after_declaring_it_cannot_be_bound()
    {
        var saved = Saved();
        saved.ViewSql = "DECLARE @plant NVARCHAR(100) = NULL; SET @plant = N'Nimr'; SELECT c.code AS crew_code, 1 AS crews FROM ref.CrewType AS c;";

        var result = await new SetSourceParametersHandler(RepoWith(Parts(Tasks(), saved)).Object).Handle(
            new SetSourceParametersCommand(1, 5, [new ParameterBindingRequest("@plant", "TaskDaily.task_code")], TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Contain("@plant").And.Contain("sets it again");
    }

    [Fact]
    public void Parameter_bindings_need_a_body_with_named_variables_and_at_most_fifty_of_them()
    {
        var validator = new SetSourceParametersCommandValidator();
        SetSourceParametersCommand With(IReadOnlyList<ParameterBindingRequest>? bindings) => new(1, 5, bindings!, TenantId);

        validator.Validate(With(null)).IsValid.Should().BeFalse();
        validator.Validate(With([new ParameterBindingRequest(" ", "TaskDaily.task_code")])).IsValid.Should().BeFalse();
        validator.Validate(With([null!])).IsValid.Should().BeFalse();
        validator.Validate(With(Enumerable.Range(0, 51).Select(i => new ParameterBindingRequest($"@v{i}", null)).ToList())).IsValid.Should().BeFalse();
        validator.Validate(With([new ParameterBindingRequest("@plant", null)])).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task Updating_a_saved_view_that_now_meets_the_view_contract_says_to_add_it_as_a_view()
    {
        var repo = RepoWith(Parts(Tasks(), Saved()));
        var compliant = ViewSource.Prepare("SELECT c.code AS crew_code FROM ref.CrewType AS c", "One row per crew type.", (_, _) => true);
        repo.Setup(r => r.GetViewsAsync(4, TenantId, It.IsAny<IReadOnlyCollection<long>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new PreparedView(30, "Crews by code", "One row per crew type.", compliant.Sql, [], [new ViewColumn("crew_code", "nvarchar(20)")]) });

        var result = await new RefreshViewSourceHandler(repo.Object).Handle(new RefreshViewSourceCommand(1, 5, TenantId), default);

        result.IsValidationError.Should().BeTrue();
        result.ErrorMessage.Should().Contain("now meets the view contract; remove it and add it as a view");
    }

    [Fact]
    public async Task A_viewer_gets_no_sql_and_no_parameter_defaults()
    {
        var detail = (await new GetDatasetHandler(RepoWith(Parts(Tasks(), Saved())).Object, NewCache()).Handle(new GetDatasetQuery(1, TenantId), default)).Value!;

        var source = detail.ForViewer().Sources.Single(s => s.Kind == "script");

        source.Sql.Should().BeNull();
        source.Parameters.Should().Equal(new ScriptParameter("@plant", "nvarchar(100)", null));
        detail.Sources.Single(s => s.Kind == "script").Sql.Should().Be(Batch);
    }
}
