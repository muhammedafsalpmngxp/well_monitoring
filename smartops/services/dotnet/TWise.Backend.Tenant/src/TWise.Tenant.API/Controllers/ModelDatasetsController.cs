using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Application.Features.Model.Query;
using TWise.Tenant.Domain;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Model Studio datasets: their tables, relationships, measures, calculated columns and transforms. Reads need view on model.studio
/// or on dashboard.canvas (canvas authors pick datasets, fields and measures); creating a dataset
/// needs model.studio create, and every other change needs model.studio modify.
/// The Get Data navigator's reads (views, uploaded tables, row previews) need model.studio modify; uploading a new file needs create.
/// Every query is scoped to the tenant in the caller's token.
/// </summary>
[Authorize]
[Route("api/model/datasets")]
public sealed class ModelDatasetsController(ISender sender) : BaseApiController
{
    private const string Module = "model.studio";

    /// <summary>A user who may only view the Standard lists sees published datasets only.</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        var result = await sender.Send(new ListDatasetsQuery(tenantId), ct);
        return ToActionResult(result.IsSuccess && ViewsPublishedOnly
            ? Result<IReadOnlyList<DatasetSummaryDto>>.Success(result.Value!.Where(d => d.PublishedAt is not null).ToList())
            : result);
    }

    /// <summary>Neither a Model Studio user nor a canvas author: someone with view on the Standard lists only.</summary>
    private bool ViewsPublishedOnly => !ModulePermission.Has(User, Module, ModulePermission.View)
        && !ModulePermission.Has(User, ModulePermission.Canvas, ModulePermission.View);

    /// <summary>The connections a new data model may use: active SQL Server connections of the tenant.</summary>
    [HttpGet("connections")]
    public async Task<IActionResult> Connections(CancellationToken ct)
        => Denied(ModulePermission.View, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new ListDatasetConnectionsQuery(tenantId), ct));

    /// <summary>A saved view's SQL and its variables' defaults are sent only to callers who may change the data model.</summary>
    [HttpGet("{id:long}")]
    public async Task<IActionResult> Get(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.View, out var tenantId, out _) is { } denied) return denied;
        var result = await sender.Send(new GetDatasetQuery(id, tenantId), ct);
        if (result.IsSuccess && ViewsPublishedOnly && result.Value!.PublishedAt is null)
            return StatusCode(StatusCodes.Status404NotFound, ApiEnvelope<object>.Fail("The data model does not exist or is not published.", 404));
        return ToActionResult(result.IsSuccess && !ModulePermission.Has(User, Module, ModulePermission.Modify)
            ? Result<DatasetDetailDto>.Success(result.Value!.ForViewer())
            : result);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateDatasetRequest request, CancellationToken ct)
        => Denied(ModulePermission.Create, out var tenantId, out var userId)
           ?? ToActionResult(await sender.Send(new CreateDatasetCommand(request, tenantId, userId), ct), StatusCodes.Status201Created);

    [HttpPut("{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateDatasetRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out var userId)
           ?? ToActionResult(await sender.Send(new UpdateDatasetCommand(id, request, tenantId, userId), ct));

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out var userId)
           ?? ToVoidActionResult(await sender.Send(new DeleteDatasetCommand(id, tenantId, userId), ct));

    /// <summary>Makes the draft the version canvases read.</summary>
    [HttpPost("{id:long}/publish")]
    public async Task<IActionResult> Publish(long id, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out var userId)
           ?? ToActionResult(await sender.Send(new PublishDatasetCommand(id, tenantId, userId), ct));

    /// <summary>Throws the draft away and goes back to the published version.</summary>
    [HttpPost("{id:long}/discard-draft")]
    public async Task<IActionResult> DiscardDraft(long id, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new DiscardDraftCommand(id, tenantId), ct));

    [HttpPost("{id:long}/sources")]
    public async Task<IActionResult> AddSource(long id, [FromBody] AddSourceRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new AddSourceCommand(id, request, tenantId), ct));

    [HttpPut("{id:long}/sources/{sourceId:long}")]
    public async Task<IActionResult> UpdateSource(long id, long sourceId, [FromBody] UpdateSourceRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new UpdateSourceCommand(id, sourceId, request, tenantId), ct));

    [HttpPut("{id:long}/sources/{sourceId:long}/details")]
    public async Task<IActionResult> SetSourceDetails(long id, long sourceId, [FromBody] SourceDetailsRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new SetSourceDetailsCommand(id, sourceId, request, tenantId), ct));

    [HttpPut("{id:long}/sources/{sourceId:long}/hidden-columns")]
    public async Task<IActionResult> SetHiddenColumns(long id, long sourceId, [FromBody] HiddenColumnsRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new SetHiddenColumnsCommand(id, sourceId, request, tenantId), ct));

    /// <summary>Binds the variables of a saved view (kind script) to model fields; the list replaces the bindings it had.</summary>
    [HttpPut("{id:long}/sources/{sourceId:long}/parameters")]
    public async Task<IActionResult> SetSourceParameters(long id, long sourceId, [FromBody] IReadOnlyList<ParameterBindingRequest> request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new SetSourceParametersCommand(id, sourceId, request, tenantId), ct));

    [HttpDelete("{id:long}/sources/{sourceId:long}")]
    public async Task<IActionResult> RemoveSource(long id, long sourceId, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new RemoveSourceCommand(id, sourceId, tenantId), ct));

    /// <summary>Stores the view behind a view source as it is now, after checking it as when it was added.</summary>
    [HttpPost("{id:long}/sources/{sourceId:long}/refresh-view")]
    public async Task<IActionResult> RefreshViewSource(long id, long sourceId, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new RefreshViewSourceCommand(id, sourceId, tenantId), ct));

    [HttpPost("{id:long}/relationships")]
    public async Task<IActionResult> AddRelationship(long id, [FromBody] AddRelationshipRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new AddRelationshipCommand(id, request, tenantId), ct));

    [HttpPut("{id:long}/relationships/{relationshipId:long}")]
    public async Task<IActionResult> UpdateRelationship(long id, long relationshipId, [FromBody] UpdateRelationshipRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new UpdateRelationshipCommand(id, relationshipId, request, tenantId), ct));

    [HttpDelete("{id:long}/relationships/{relationshipId:long}")]
    public async Task<IActionResult> RemoveRelationship(long id, long relationshipId, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new RemoveRelationshipCommand(id, relationshipId, tenantId), ct));

    [HttpGet("{id:long}/relationship-suggestions")]
    public async Task<IActionResult> Suggestions(long id, CancellationToken ct)
        => Denied(ModulePermission.View, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new GetRelationshipSuggestionsQuery(id, tenantId), ct));

    /// <summary>View Builder views on the dataset's connection, each with whether it can be added and why not.</summary>
    [HttpGet("{id:long}/views")]
    public async Task<IActionResult> Views(long id, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new ListDatasetViewsQuery(id, tenantId), ct));

    /// <summary>
    /// Every connection of the tenant, for the Get Data database choice: joinable says whether the data model can add
    /// its tables (an active SQL Server connection on the model's server), and reason says why not.
    /// </summary>
    [HttpGet("{id:long}/connections")]
    public async Task<IActionResult> SourceConnections(long id, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new ListSourceConnectionsQuery(id, tenantId), ct));

    /// <summary>
    /// The first rows of a table or view, for the Get Data navigator. Administrators only; a refusal is 422
    /// with a stable code and a plain message, as for POST /api/query.
    /// </summary>
    [HttpPost("{id:long}/source-preview")]
    public async Task<IActionResult> PreviewSource(long id, [FromBody] SourcePreviewRequest request, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out _) is { } denied) return denied;
        try
        {
            return ToActionResult(Result<QueryResult>.Success(await sender.Send(new PreviewSourceCommand(id, request, tenantId), ct)));
        }
        catch (QueryException ex)
        {
            return UnprocessableEntity(new { code = ex.Code, message = ex.Message });
        }
    }

    // The file may be 10 MB; the rest of the form is a few short fields. The form is read by ImportForm.ReadAsync
    // after the permission check, not bound as a parameter, so a caller without permission never has it read.
    private const long MaxUploadBytes = ImportRules.MaxBytes + 1024 * 1024;

    /// <summary>Tables loaded from uploaded files on the dataset's connection.</summary>
    [HttpGet("{id:long}/imports")]
    public async Task<IActionResult> Imports(long id, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new ListImportsQuery(id, tenantId), ct));

    /// <summary>Reads an uploaded file and returns one sheet's suggested rows, types and first rows. Stores nothing.</summary>
    [HttpPost("{id:long}/imports/preview")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxUploadBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
    public async Task<IActionResult> PreviewImport(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.Create, out var tenantId, out _) is { } denied) return denied;
        if (await ImportForm.ReadAsync(Request, ct) is not { } form) return BadForm();
        return ToActionResult(await sender.Send(new PreviewImportQuery(id, await form.FileAsync(ct), form.Options(), tenantId), ct));
    }

    /// <summary>Loads a sheet into a new table of the import schema. Add it to the dataset with POST sources.</summary>
    [HttpPost("{id:long}/imports")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxUploadBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
    public async Task<IActionResult> CreateImport(long id, CancellationToken ct)
    {
        if (Denied(ModulePermission.Create, out var tenantId, out var userId) is { } denied) return denied;
        if (await ImportForm.ReadAsync(Request, ct) is not { } form) return BadForm();
        return ToActionResult(await sender.Send(new CreateImportCommand(id, await form.FileAsync(ct), form.Options(), tenantId, userId), ct),
            StatusCodes.Status201Created);
    }

    /// <summary>Replaces an uploaded table's rows, and its columns when the new file differs; refused when a dataset would break.</summary>
    [HttpPut("{id:long}/imports/{importId:long}")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(MaxUploadBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
    public async Task<IActionResult> ReplaceImport(long id, long importId, CancellationToken ct)
    {
        if (Denied(ModulePermission.Modify, out var tenantId, out var userId) is { } denied) return denied;
        if (await ImportForm.ReadAsync(Request, ct) is not { } form) return BadForm();
        return ToActionResult(await sender.Send(new ReplaceImportCommand(id, importId, await form.FileAsync(ct), form.Options(), tenantId, userId), ct));
    }

    /// <summary>
    /// Downloads a Google Sheet shared as "anyone with the link can view" as an .xlsx, which the navigator then
    /// reads as an uploaded file, every sheet of it. Stores nothing. Only docs.google.com is asked.
    /// </summary>
    [HttpGet("{id:long}/imports/google-sheet")]
    public async Task<IActionResult> GoogleSheet(long id, [FromQuery] string? link, [FromServices] IHttpClientFactory httpClients, CancellationToken ct)
    {
        if (Denied(ModulePermission.Create, out _, out _) is { } denied) return denied;
        if (ImportRules.GoogleSheetExport(link) is not { } export)
            return ToActionResult(Result<GoogleSheetFile>.ValidationError("Paste the link of a Google Sheet, starting https://docs.google.com/spreadsheets/d/."));

        const string unshared = "The Google Sheet could not be read. Share it as \"Anyone with the link can view\" and try again.";
        var client = httpClients.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);
        try
        {
            using var response = await client.GetAsync(export, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode) return ToActionResult(Result<GoogleSheetFile>.ValidationError(unshared));
            const string tooLarge = "The Google Sheet is larger than 10 MB as an Excel file. Split it into smaller sheets.";
            if (response.Content.Headers.ContentLength > ImportRules.MaxBytes) return ToActionResult(Result<GoogleSheetFile>.ValidationError(tooLarge));

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var memory = new MemoryStream();
            var buffer = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(buffer, ct)) > 0)
            {
                memory.Write(buffer, 0, read);
                if (memory.Length > ImportRules.MaxBytes) return ToActionResult(Result<GoogleSheetFile>.ValidationError(tooLarge));
            }

            // A sheet that is not shared answers with a sign-in page, not a workbook.
            var content = memory.ToArray();
            if (ImportRules.FileKind("sheet.xlsx", content) is null) return ToActionResult(Result<GoogleSheetFile>.ValidationError(unshared));

            var name = Path.GetFileName(response.Content.Headers.ContentDisposition?.FileNameStar ?? response.Content.Headers.ContentDisposition?.FileName?.Trim('"') ?? "");
            if (!name.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) name = "Google_Sheet.xlsx";
            return ToActionResult(Result<GoogleSheetFile>.Success(new GoogleSheetFile(name, content)));
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            return ToActionResult(Result<GoogleSheetFile>.ValidationError("Google Sheets could not be reached. Try again in a moment."));
        }
    }

    private IActionResult BadForm()
        => StatusCode(StatusCodes.Status400BadRequest, ApiEnvelope<object>.Fail("Send the file and its options as a form; header and last rows are whole numbers.", 400));

    [HttpPost("{id:long}/measures")]
    public async Task<IActionResult> AddMeasure(long id, [FromBody] SaveMeasureRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new AddMeasureCommand(id, request, tenantId), ct));

    /// <summary>The checks of saving a measure, without saving it. 200 with the kind, or the error Save would give.</summary>
    [HttpPost("{id:long}/measures/check")]
    public async Task<IActionResult> CheckMeasure(long id, [FromBody] CheckMeasureRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new CheckMeasureQuery(id, request, tenantId), ct));

    [HttpPut("{id:long}/measures/{measureId:long}")]
    public async Task<IActionResult> UpdateMeasure(long id, long measureId, [FromBody] SaveMeasureRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new UpdateMeasureCommand(id, measureId, request, tenantId), ct));

    /// <summary>Lists a measure under a table or with the dataset's measures, and in a folder or none.</summary>
    [HttpPut("{id:long}/measures/{measureId:long}/placement")]
    public async Task<IActionResult> PlaceMeasure(long id, long measureId, [FromBody] MeasurePlacementRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new PlaceMeasureCommand(id, measureId, request, tenantId), ct));

    [HttpDelete("{id:long}/measures/{measureId:long}")]
    public async Task<IActionResult> RemoveMeasure(long id, long measureId, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new RemoveMeasureCommand(id, measureId, tenantId), ct));

    [HttpPost("{id:long}/calculated-columns")]
    public async Task<IActionResult> AddCalculatedColumn(long id, [FromBody] SaveCalculatedColumnRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new AddCalculatedColumnCommand(id, request, tenantId), ct));

    /// <summary>The checks of saving a calculated column, without saving it.</summary>
    [HttpPost("{id:long}/calculated-columns/check")]
    public async Task<IActionResult> CheckCalculatedColumn(long id, [FromBody] CheckCalculatedColumnRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new CheckCalculatedColumnQuery(id, request, tenantId), ct));

    [HttpPut("{id:long}/calculated-columns/{columnId:long}")]
    public async Task<IActionResult> UpdateCalculatedColumn(long id, long columnId, [FromBody] UpdateCalculatedColumnRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new UpdateCalculatedColumnCommand(id, columnId, request, tenantId), ct));

    [HttpDelete("{id:long}/calculated-columns/{columnId:long}")]
    public async Task<IActionResult> RemoveCalculatedColumn(long id, long columnId, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new RemoveCalculatedColumnCommand(id, columnId, tenantId), ct));

    [HttpPost("{id:long}/transforms")]
    public async Task<IActionResult> AddTransform(long id, [FromBody] AddTransformRequest request, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new AddTransformCommand(id, request, tenantId), ct));

    [HttpDelete("{id:long}/transforms/{transformId:long}")]
    public async Task<IActionResult> RemoveTransform(long id, long transformId, CancellationToken ct)
        => Denied(ModulePermission.Modify, out var tenantId, out _)
           ?? ToActionResult(await sender.Send(new RemoveTransformCommand(id, transformId, tenantId), ct));

    /// <summary>Null when the caller may perform the action; otherwise the 401 or 403 to return.</summary>
    private IActionResult? Denied(char action, out long tenantId, out long userId)
    {
        userId = 0;
        if (!long.TryParse(User.FindFirst("tenantId")?.Value, out tenantId) || tenantId <= 0)
            return StatusCode(StatusCodes.Status401Unauthorized, ApiEnvelope<object>.Fail("TenantId not found in token.", 401));

        _ = long.TryParse(User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out userId);

        var allowed = action == ModulePermission.View ? ModulePermission.CanReadModel(User) : ModulePermission.Has(User, Module, action);
        return allowed
            ? null
            : StatusCode(StatusCodes.Status403Forbidden, ApiEnvelope<object>.Fail("You do not have permission to do this in Model Studio.", 403));
    }
}

/// <summary>A downloaded Google Sheet: its file name and the .xlsx, sent as base64.</summary>
public sealed record GoogleSheetFile(string FileName, byte[] Content);

/// <summary>The multipart form of an upload. Types is sent once per column, in column order.</summary>
public sealed class ImportForm
{
    public IFormFile? File { get; set; }
    public string? Sheet { get; set; }
    public int? HeaderRow { get; set; }
    public int? LastRow { get; set; }
    public List<string>? Types { get; set; }
    public string? TableName { get; set; }

    public ImportOptions Options() => new(Sheet, HeaderRow, LastRow, Types is { Count: > 0 } ? Types : null, TableName);

    /// <summary>The form of the request, with field names matched ignoring case; null when it is not a form or a row is not a whole number.</summary>
    public static async Task<ImportForm?> ReadAsync(HttpRequest request, CancellationToken ct)
    {
        if (!request.HasFormContentType) return null;
        var form = await request.ReadFormAsync(ct);
        if (!Row(form, nameof(HeaderRow), out var headerRow) || !Row(form, nameof(LastRow), out var lastRow)) return null;
        return new ImportForm
        {
            File = form.Files.GetFile(nameof(File)),
            Sheet = Text(form, nameof(Sheet)),
            HeaderRow = headerRow,
            LastRow = lastRow,
            Types = form[nameof(Types)].Where(t => !string.IsNullOrEmpty(t)).Select(t => t!).ToList(),
            TableName = Text(form, nameof(TableName)),
        };

        // As model binding reads them: an empty field is no value.
        static string? Text(IFormCollection form, string name) => string.IsNullOrEmpty(form[name]) ? null : form[name].ToString();

        static bool Row(IFormCollection form, string name, out int? value)
        {
            value = null;
            if (Text(form, name) is not { } text) return true;
            if (!int.TryParse(text, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var number)) return false;
            value = number;
            return true;
        }
    }

    /// <summary>The file in memory. With no file, an empty one, which the handlers refuse in plain words.</summary>
    public async Task<ImportFile> FileAsync(CancellationToken ct)
    {
        if (File is null) return new ImportFile("", []);
        await using var stream = File.OpenReadStream();
        using var memory = new MemoryStream();
        await stream.CopyToAsync(memory, ct);
        return new ImportFile(File.FileName, memory.ToArray());
    }
}
