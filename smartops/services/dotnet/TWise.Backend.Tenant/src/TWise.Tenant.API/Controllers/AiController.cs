using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.Activity;
using TWise.Tenant.Application.Features.Ai.AgenticFeatures;
using TWise.Tenant.Application.Features.Ai.Alerts;
using TWise.Tenant.Application.Features.Ai.Ask;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Application.Features.Ai.PromptLibrary;
using TWise.Tenant.Application.Features.Ai.Builder;
using TWise.Tenant.Application.Features.Ai.Conversations;
using TWise.Tenant.Application.Features.Ai.DatasetPrompts;
using TWise.Tenant.Application.Features.Ai.Deck;
using TWise.Tenant.Application.Features.Ai.Feedback;
using TWise.Tenant.Application.Features.Ai.Knowledge;
using TWise.Tenant.Application.Features.Ai.Relationships;
using TWise.Tenant.Application.Features.Ai.Settings;
using TWise.Tenant.Application.Features.Ai.SqlReview;
using TWise.Tenant.Domain.DTOs;

using TWise.Tenant.Application.Features.Ai.ModelPrices;
namespace TWise.Tenant.API.Controllers;

/// <summary>
/// Ask AI and its admin pages. Every action only reads the caller's identity and sends a query or
/// command (Features/Ai/*); the handlers hold the logic. Streaming answers go out as server-sent events.
/// Business errors (InvalidOperationException) become 400 with { message }; validation failures are
/// turned into 400 by the ValidationExceptionMiddleware.
/// </summary>
[ApiController]
[Authorize]
[Route("api/ai")]
public sealed class AiController(ISender sender, ICurrentUserService currentUser) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ── Ask your data (any signed-in user) ─────────────────────────────────────

    /// <summary>Feature keys this user may use right now (master flag, active provider and role grants folded in).</summary>
    [HttpGet("features")]
    [ProducesResponseType(typeof(AiFeaturesDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> Features(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        return Ok(await sender.Send(new GetAiFeaturesQuery(tenantId, currentUser.Roles), ct));
    }

    /// <summary>Views and completed imports this user may ask about.</summary>
    [HttpGet("datasets")]
    [ProducesResponseType(typeof(IReadOnlyList<AiDatasetDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Datasets(CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId) || !TryGetUserId(out var userId)) return Unauthorized();
        return Ok(await sender.Send(new ListAiDatasetsQuery(tenantId, userId), ct));
    }

    /// <summary>
    /// Asks a question. Streams server-sent events: status (text), spec (AiQuerySpec), result (AiQueryResult),
    /// answer (text delta, repeated), done ({conversationId, sourceName, messageId}) or error (text). Each event is
    /// "event: {type}\ndata: {json}\n\n".
    /// </summary>
    [HttpPost("ask")]
    [Produces("text/event-stream")]
    public Task Ask([FromBody] AiAskRequest request, CancellationToken ct) =>
        TryGetIds(out var tenantId, out var userId) ? StreamAsync(new AskAiStream(request, tenantId, userId), ct) : UnauthorizedStreamAsync();

    /// <summary>Narrative summary of one chart's data, streamed like ask (answer deltas, then done or error).</summary>
    [HttpPost("summary")]
    [Produces("text/event-stream")]
    public Task Summary([FromBody] AiSummaryRequest request, CancellationToken ct) =>
        TryGetIds(out var tenantId, out var userId) ? StreamAsync(new SummarizeAiChartStream(request, tenantId, userId), ct) : UnauthorizedStreamAsync();

    /// <summary>Narrative summary of a whole dashboard, streamed like ask.</summary>
    [HttpPost("dashboard-summary")]
    [Produces("text/event-stream")]
    public Task DashboardSummary([FromBody] AiDashboardSummaryRequest request, CancellationToken ct) =>
        TryGetIds(out var tenantId, out var userId) ? StreamAsync(new SummarizeAiDashboardStream(request, tenantId, userId), ct) : UnauthorizedStreamAsync();

    // ── Builder helpers (Chart Builder and Dashboard Builder) ───────────────────

    /// <summary>Up to 6 dashboard-wide filters the AI recommends for the placed charts.</summary>
    [HttpPost("suggest-filters")]
    [ProducesResponseType(typeof(IReadOnlyList<AiFilterSuggestion>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> SuggestFilters([FromBody] AiFilterSuggestRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => Ok(await sender.Send(new SuggestAiFiltersCommand(request, t, u), ct)));

    /// <summary>Turns a plain-words instruction into a chart configuration patch.</summary>
    [HttpPost("chart-edit")]
    [ProducesResponseType(typeof(AiChartEditResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> ChartEdit([FromBody] AiChartEditRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => Ok(await sender.Send(new EditChartByAiCommand(request, t, u), ct)));

    /// <summary>Three suggested charts for a loaded data source.</summary>
    [HttpPost("chart-suggest")]
    [ProducesResponseType(typeof(IReadOnlyList<AiChartSuggestion>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> ChartSuggest([FromBody] AiChartSuggestRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => Ok(await sender.Send(new SuggestAiChartsCommand(request, t, u), ct)));

    /// <summary>A first dashboard (title and up to 6 charts) for a dataset and a goal.</summary>
    [HttpPost("dashboard-suggest")]
    [ProducesResponseType(typeof(AiDashboardSuggestion), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> DashboardSuggest([FromBody] AiDashboardSuggestRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => Ok(await sender.Send(new SuggestAiDashboardCommand(request, t, u), ct)));

    /// <summary>The narrative for a slide deck of the dashboard's charts: headline, per-chart title/bullets/takeaway, closing. Explain charts feature.</summary>
    [HttpPost("deck")]
    [ProducesResponseType(typeof(AiDeckDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IActionResult> Deck([FromBody] AiDeckRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => Ok(await sender.Send(new BuildAiDeckCommand(request, t, u), ct)));

    /// <summary>Explains a view's SQL with facts from its estimated plan, lists issues and proposes an optimised query. SQL review feature.</summary>
    [HttpPost("sql-review")]
    [ProducesResponseType(typeof(AiSqlReviewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> SqlReview([FromBody] AiSqlReviewRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new ReviewSqlCommand(request, t, u), ct) is { } r ? Ok(r) : NotFound());

    // ── Conversations (own) ─────────────────────────────────────────────────────

    /// <summary>The user's conversations, newest first.</summary>
    [HttpGet("conversations")]
    [ProducesResponseType(typeof(IReadOnlyList<AiConversationDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Conversations(CancellationToken ct)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return Ok(await sender.Send(new ListAiConversationsQuery(tenantId, userId), ct));
    }

    /// <summary>A conversation with its messages (assistant messages carry the query they ran).</summary>
    [HttpGet("conversations/{id:long}")]
    [ProducesResponseType(typeof(AiConversationDetailDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Conversation(long id, CancellationToken ct)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return await sender.Send(new GetAiConversationQuery(tenantId, userId, id), ct) is { } c ? Ok(c) : NotFound();
    }

    [HttpDelete("conversations/{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteConversation(long id, CancellationToken ct)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return await sender.Send(new DeleteAiConversationCommand(tenantId, userId, id), ct) ? NoContent() : NotFound();
    }

    // ── Feedback on an answer (own) ─────────────────────────────────────────────

    /// <summary>Thumbs-up: the answer becomes an example for later questions. Learning feature.</summary>
    [HttpPost("messages/{id:long}/like")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Like(long id, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new LikeAiMessageCommand(t, u, id), ct) ? NoContent() : NotFound());

    /// <summary>Removes the thumbs-up.</summary>
    [HttpDelete("messages/{id:long}/like")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Unlike(long id, CancellationToken ct)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return await sender.Send(new UnlikeAiMessageCommand(tenantId, userId, id), ct) ? NoContent() : NotFound();
    }

    /// <summary>Thumbs-down: the answer is never used as an example. Learning feature.</summary>
    [HttpPost("messages/{id:long}/dislike")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Dislike(long id, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new DislikeAiMessageCommand(t, u, id), ct) ? NoContent() : NotFound());

    /// <summary>The steps behind an answer: what was sent to the AI, what came back, timings. Own answers, Prompt trace feature.</summary>
    [HttpGet("messages/{id:long}/trace")]
    [ProducesResponseType(typeof(IReadOnlyList<AiTraceStep>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Trace(long id, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new GetAiMessageTraceQuery(t, u, id), ct) is { } trace ? Ok(trace) : NotFound());

    /// <summary>Insight report for an answer: trend, findings and anomalies checked in code, recommendations from the AI. Own answers.</summary>
    [HttpPost("messages/{id:long}/report")]
    [ProducesResponseType(typeof(AiInsightReportDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Report(long id, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new BuildAiInsightReportCommand(t, u, id), ct) is { } report ? Ok(report) : NotFound());

    // ── Alerts: watched answers (own alerts, Alerts feature) ────────────────────

    /// <summary>The user's alerts, newest first.</summary>
    [HttpGet("alerts")]
    [ProducesResponseType(typeof(IReadOnlyList<AiAlertDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> Alerts(CancellationToken ct)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return Ok(await sender.Send(new ListAiAlertsQuery(tenantId, userId), ct));
    }

    /// <summary>Watches an answer; the first check runs straight away without notifying.</summary>
    [HttpPost("alerts")]
    [ProducesResponseType(typeof(AiAlertDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> CreateAlert([FromBody] CreateAiAlertRequest request, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new CreateAiAlertCommand(request, t, u), ct) is { } a ? Ok(a) : NotFound());

    /// <summary>Runs the check now; notifies when the alert starts firing.</summary>
    [HttpPost("alerts/{id:long}/check")]
    [ProducesResponseType(typeof(AiAlertDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> CheckAlert(long id, CancellationToken ct) =>
        SendAiAsync(async (t, u) => await sender.Send(new CheckAiAlertCommand(t, u, id), ct) is { } a ? Ok(a) : NotFound());

    [HttpDelete("alerts/{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteAlert(long id, CancellationToken ct)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return await sender.Send(new DeleteAiAlertCommand(tenantId, userId, id), ct) ? NoContent() : NotFound();
    }

    // ── Relationship graph between datasets (admin) ─────────────────────────────

    /// <summary>Datasets and the links between them (suggested, confirmed, rejected).</summary>
    [HttpGet("relations")]
    [ProducesResponseType(typeof(AiRelationGraphDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetRelations(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiRelationGraphQuery(t), ct)));

    /// <summary>Scans datasets for shared columns with overlapping values and stores the links as suggested.</summary>
    [HttpPost("relations/detect")]
    [ProducesResponseType(typeof(AiRelationScanDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> DetectRelations([FromBody] DetectAiRelationsRequest request, CancellationToken ct)
    {
        if (!IsAdmin()) return Forbid();
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        return Ok(await sender.Send(new DetectAiRelationsCommand(tenantId, userId, request?.Datasets), ct));
    }

    /// <summary>Adds a confirmed link drawn by the admin.</summary>
    [HttpPost("relations")]
    [ProducesResponseType(typeof(AiRelationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> AddRelation([FromBody] AddAiRelationRequest request, CancellationToken ct)
    {
        if (!IsAdmin()) return Forbid();
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        try { return Ok(await sender.Send(new AddAiRelationCommand(tenantId, userId, request), ct)); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Confirms or rejects a link.</summary>
    [HttpPut("relations/{id:long}/status")]
    [ProducesResponseType(typeof(AiRelationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> SetRelationStatus(long id, [FromBody] SetAiRelationStatusRequest request, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new SetAiRelationStatusCommand(t, UserId(), id, request.Status), ct) is { } r ? Ok(r) : NotFound());

    [HttpDelete("relations/{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> DeleteRelation(long id, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new DeleteAiRelationCommand(t, id), ct) ? NoContent() : NotFound());

    // ── Dataset-level AI instructions (admin) ───────────────────────────────────

    /// <summary>The instructions that can differ per dataset, with the tenant text as default.</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/prompts")]
    [ProducesResponseType(typeof(IReadOnlyList<AiPromptDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetDatasetPrompts(string sourceType, long sourceId, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiDatasetPromptsQuery(t, sourceType, sourceId), ct)));

    /// <summary>Sets one instruction for the dataset; empty text goes back to the tenant text. Returns the dataset's prompts.</summary>
    [HttpPut("datasets/{sourceType}/{sourceId:long}/prompts/{key}")]
    [ProducesResponseType(typeof(IReadOnlyList<AiPromptDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveDatasetPrompt(string sourceType, long sourceId, string key, [FromBody] SaveAiPromptRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiDatasetPromptCommand(t, UserId(), sourceType, sourceId, key, request.Text), ct)));

    // ── Grounding: dataset notes, metrics, terms, proposals and examples ────────

    /// <summary>Business notes for a dataset; column null is the dataset-level note. Readable by any user.</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/notes")]
    [ProducesResponseType(typeof(IReadOnlyList<AiDatasetNoteDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetNotes(string sourceType, long sourceId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        return Ok(await sender.Send(new GetAiDatasetNotesQuery(tenantId, sourceType, sourceId), ct));
    }

    /// <summary>Replaces the dataset's notes (admin). Empty notes are dropped; notes are capped at 1000 characters.</summary>
    [HttpPut("datasets/{sourceType}/{sourceId:long}/notes")]
    [ProducesResponseType(typeof(IReadOnlyList<AiDatasetNoteDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveNotes(string sourceType, long sourceId, [FromBody] IReadOnlyList<AiDatasetNoteDto> notes, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiDatasetNotesCommand(t, UserId(), sourceType, sourceId, notes ?? []), ct)));

    /// <summary>Trusted metric definitions for a dataset. Readable by any user.</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/metrics")]
    [ProducesResponseType(typeof(IReadOnlyList<AiMetricDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetMetrics(string sourceType, long sourceId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        return Ok(await sender.Send(new GetAiDatasetMetricsQuery(tenantId, sourceType, sourceId), ct));
    }

    /// <summary>Replaces the dataset's metrics (admin). Each needs a name, an agg and (except count) a column.</summary>
    [HttpPut("datasets/{sourceType}/{sourceId:long}/metrics")]
    [ProducesResponseType(typeof(IReadOnlyList<AiMetricDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveMetrics(string sourceType, long sourceId, [FromBody] IReadOnlyList<AiMetricDto> metrics, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiDatasetMetricsCommand(t, UserId(), sourceType, sourceId, metrics ?? []), ct)));

    /// <summary>Column names of a dataset, for the pickers in Dataset notes.</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/columns")]
    [ProducesResponseType(typeof(IReadOnlyList<string>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetColumns(string sourceType, long sourceId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        try { return Ok(await sender.Send(new GetAiDatasetColumnsQuery(tenantId, sourceType, sourceId), ct)); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Business terms of a dataset. Readable by any user.</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/terms")]
    [ProducesResponseType(typeof(IReadOnlyList<AiTermDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTerms(string sourceType, long sourceId, CancellationToken ct)
    {
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        return Ok(await sender.Send(new GetAiDatasetTermsQuery(tenantId, sourceType, sourceId), ct));
    }

    /// <summary>
    /// Replaces the dataset's business terms (admin). Each term needs a filter (column and value) or a
    /// meaning; a term or synonym may appear only once across the list.
    /// </summary>
    [HttpPut("datasets/{sourceType}/{sourceId:long}/terms")]
    [ProducesResponseType(typeof(IReadOnlyList<AiTermDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveTerms(string sourceType, long sourceId, [FromBody] IReadOnlyList<AiTermDto> terms, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiDatasetTermsCommand(t, UserId(), sourceType, sourceId, terms ?? []), ct)));

    /// <summary>Notes the AI proposed from conversations and nobody has reviewed yet (admin).</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/proposals")]
    [ProducesResponseType(typeof(IReadOnlyList<AiNoteProposalDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetProposals(string sourceType, long sourceId, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiNoteProposalsQuery(t, sourceType, sourceId), ct)));

    /// <summary>Adds the proposed note to the dataset's notes (admin).</summary>
    [HttpPost("proposals/{id:long}/approve")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> ApproveProposal(long id, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new ReviewAiNoteProposalCommand(t, UserId(), id, true), ct) ? NoContent() : NotFound());

    /// <summary>Discards the proposed note (admin).</summary>
    [HttpPost("proposals/{id:long}/reject")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> RejectProposal(long id, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new ReviewAiNoteProposalCommand(t, UserId(), id, false), ct) ? NoContent() : NotFound());

    /// <summary>Learned examples of a dataset with their review status (admin).</summary>
    [HttpGet("datasets/{sourceType}/{sourceId:long}/examples")]
    [ProducesResponseType(typeof(IReadOnlyList<AiExampleDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetExamples(string sourceType, long sourceId, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiExamplesQuery(t, sourceType, sourceId), ct)));

    /// <summary>Approves or rejects an example, overriding the AI's review (admin).</summary>
    [HttpPut("examples/{id:long}/status")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> SetExampleStatus(long id, [FromBody] AiExampleStatusRequest request, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new SetAiExampleStatusCommand(t, id, request?.Status ?? ""), ct) ? NoContent() : NotFound());

    [HttpDelete("examples/{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> DeleteExample(long id, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new DeleteAiExampleCommand(t, id), ct) ? NoContent() : NotFound());

    // ── Settings, providers and usage (admin) ──────────────────────────────────

    /// <summary>Admin: the feature catalog and which roles are granted each feature in this tenant.</summary>
    [HttpGet("feature-access")]
    [ProducesResponseType(typeof(AiFeatureAccessDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetFeatureAccess(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiFeatureAccessQuery(t), ct)));

    /// <summary>Admin: replaces every grant. Body is { featureKey: [ roleCode, … ] }.</summary>
    [HttpPut("feature-access")]
    [ProducesResponseType(typeof(AiFeatureAccessDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveFeatureAccess([FromBody] Dictionary<string, IReadOnlyList<string>> access, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiFeatureAccessCommand(t, access ?? []), ct)));

    /// <summary>Daily quota, enabled flag and the active provider id.</summary>
    [HttpGet("settings")]
    [ProducesResponseType(typeof(AiSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetSettings(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiSettingsQuery(t), ct)));

    /// <summary>Saves the daily quota and enabled flag. Enabling needs an active provider.</summary>
    [HttpPut("settings")]
    [ProducesResponseType(typeof(AiSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveSettings([FromBody] SaveAiSettingsRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiSettingsCommand(t, UserId(), request), ct)));

    /// <summary>The editable AI instructions with their defaults and the text in use.</summary>
    [HttpGet("prompts")]
    [ProducesResponseType(typeof(IReadOnlyList<AiPromptDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetPrompts(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiPromptsQuery(t), ct)));

    /// <summary>Saves one instruction; empty text (or the default) resets it. Returns every prompt.</summary>
    [HttpPut("prompts/{key}")]
    [ProducesResponseType(typeof(IReadOnlyList<AiPromptDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SavePrompt(string key, [FromBody] SaveAiPromptRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiPromptCommand(t, UserId(), key, request.Text), ct)));

    // ── Ask Data settings (Settings → AI Settings, admins only) ─────────────────────────────────────────────────────

    /// <summary>What Ask Data may read (schemas, hidden tables and columns) and its limits.</summary>
    [HttpGet("settings/ask-data")]
    [ProducesResponseType(typeof(AskDataSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetAskDataSettings(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAskDataSettingsQuery(t), ct)));

    /// <summary>Saves them. Allowed schemas must exist in the Ask Data database; 400 with { message } lists every problem.</summary>
    [HttpPut("settings/ask-data")]
    [ProducesResponseType(typeof(AskDataSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveAskDataSettings([FromBody] SaveAskDataSettingsRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAskDataSettingsCommand(t, UserId(), request), ct)));

    /// <summary>The Ask Data database's schemas, tables and columns, to choose from. 400 when it cannot be read.</summary>
    [HttpGet("settings/ask-data/catalog")]
    [ProducesResponseType(typeof(AskDataCatalogDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetAskDataCatalog(CancellationToken ct) =>
        AdminAsync(async _ => Ok(await sender.Send(new GetAskDataCatalogQuery(), ct)));

    // ── Agentic Features settings (Settings → AI Settings, admins only) ──────────────────────────────────────────────

    /// <summary>Every Agentic Feature (Slippage, Daily Report, Data Anomaly) with its setting definitions, values in use
    /// (defaults filled in), the tables it may read and, for verified-SQL features, the tables its queries read.</summary>
    [HttpGet("settings/features")]
    [ProducesResponseType(typeof(IReadOnlyList<AgenticFeatureSettingsDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetAgenticFeatureSettings(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAgenticFeatureSettingsQuery(t), ct)));

    /// <summary>Saves one feature's settings and tables. Values not sent keep theirs; tables and schemas must exist in the
    /// Ask Data database; 400 with { message } lists every problem.</summary>
    [HttpPut("settings/features/{feature}")]
    [ProducesResponseType(typeof(AgenticFeatureSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> SaveAgenticFeatureSettings(string feature, [FromBody] SaveAgenticFeatureSettingsRequest request,
        CancellationToken ct) =>
        AdminAsync(async t => AgenticFeatureCatalog.IsKnown(feature)
            ? Ok(await sender.Send(new SaveAgenticFeatureSettingsCommand(t, UserName(), feature, request), ct))
            : NotFound());

    /// <summary>Restores one feature's default settings and tables.</summary>
    [HttpDelete("settings/features/{feature}")]
    [ProducesResponseType(typeof(AgenticFeatureSettingsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> ResetAgenticFeatureSettings(string feature, CancellationToken ct) =>
        AdminAsync(async t => AgenticFeatureCatalog.IsKnown(feature)
            ? Ok(await sender.Send(new ResetAgenticFeatureSettingsCommand(t, UserName(), feature), ct))
            : NotFound());

    // ── AI prompts (Settings → AI Prompts, admins only) ───────────────────────────────────────────────────────────

    /// <summary>Every AI prompt of the tenant (AI features, Ask Data, agents): text in use, version, original, last change.</summary>
    [HttpGet("prompt-library")]
    [ProducesResponseType(typeof(IReadOnlyList<AiPromptItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetPromptLibrary(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiPromptLibraryQuery(t), ct)));

    /// <summary>Every saved version of one prompt, newest first.</summary>
    [HttpGet("prompt-library/{key}/history")]
    [ProducesResponseType(typeof(IReadOnlyList<AiPromptVersionDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetPromptHistory(string key, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiPromptHistoryQuery(t, key), ct)));

    /// <summary>Saves a new version of one prompt. 400 with the reason when the text breaks a rule (a placeholder or the
    /// reply format removed) or someone saved a newer version than ExpectedVersion.</summary>
    [HttpPut("prompt-library/{key}")]
    [ProducesResponseType(typeof(AiPromptItemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SavePromptVersion(string key, [FromBody] SaveAiPromptVersionRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiPromptVersionCommand(t, UserName(), key, request), ct)));

    /// <summary>Makes an earlier version (1 = the original) the active one, as a new version.</summary>
    [HttpPost("prompt-library/{key}/restore")]
    [ProducesResponseType(typeof(AiPromptItemDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> RestorePrompt(string key, [FromBody] RestoreAiPromptRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new RestoreAiPromptCommand(t, UserName(), key, request), ct)));
    /// <summary>The model price catalog and the active provider's models, for agent cost estimates (any signed-in user).</summary>
    [HttpGet("model-prices")]
    [ProducesResponseType(typeof(AiModelPricesDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> ModelPrices(CancellationToken ct) =>
        TryGetTenantId(out var t) ? Ok(await sender.Send(new GetAiModelPricesQuery(t), ct)) : Unauthorized();

    /// <summary>Replaces the model price catalog (admins).</summary>
    [HttpPut("model-prices")]
    [ProducesResponseType(typeof(AiModelPricesDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> SaveModelPrices([FromBody] IReadOnlyList<AiModelPriceDto> prices, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiModelPricesCommand(t, UserId(), prices), ct)));

    /// <summary>All registered providers, active first.</summary>
    [HttpGet("providers")]
    [ProducesResponseType(typeof(IReadOnlyList<AiProviderDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> ListProviders(CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new ListAiProvidersQuery(t), ct)));

    /// <summary>Adds a provider. The first one a tenant adds becomes active.</summary>
    [HttpPost("providers")]
    [ProducesResponseType(typeof(AiProviderDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> AddProvider([FromBody] SaveAiProviderRequest request, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new SaveAiProviderCommand(t, UserId(), null, request), ct)));

    /// <summary>Updates a provider. Omit apiKey to keep the stored one.</summary>
    [HttpPut("providers/{id:long}")]
    [ProducesResponseType(typeof(AiProviderDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateProvider(long id, [FromBody] SaveAiProviderRequest request, CancellationToken ct)
    {
        if (!IsAdmin()) return Forbid();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        try { return Ok(await sender.Send(new SaveAiProviderCommand(tenantId, UserId(), id, request), ct)); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Soft-deletes a provider. The active provider cannot be deleted.</summary>
    [HttpDelete("providers/{id:long}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> DeleteProvider(long id, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new DeleteAiProviderCommand(t, UserId(), id), ct) ? NoContent() : NotFound());

    /// <summary>Makes this provider the one the AI features use.</summary>
    [HttpPost("providers/{id:long}/activate")]
    [ProducesResponseType(typeof(AiProviderDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> ActivateProvider(long id, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new ActivateAiProviderCommand(t, UserId(), id), ct) is { } r ? Ok(r) : NotFound());

    /// <summary>Sends a one-line prompt to this provider (active or not). Counts against the quota.</summary>
    [HttpPost("providers/{id:long}/test")]
    [ProducesResponseType(typeof(AiTestResultDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> TestProvider(long id, CancellationToken ct) =>
        AdminAsync(async t => Ok(await sender.Send(new TestAiProviderCommand(t, UserId(), id), ct)));

    // ── AI activity (admin): every user's answers, their traces, failed calls ──

    /// <summary>Answered questions of every user in the last N days, newest first; q filters by answer, dataset, title or user id.</summary>
    [HttpGet("activity")]
    [ProducesResponseType(typeof(AiActivityPageDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetActivity([FromQuery] int days = 7, [FromQuery] string? q = null, [FromQuery] int skip = 0, [FromQuery] int take = 50, CancellationToken ct = default) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiActivityQuery(t, days, q, skip, take), ct)));

    /// <summary>The steps behind any user's answer (prompts, replies, timings).</summary>
    [HttpGet("activity/{messageId:long}/trace")]
    [ProducesResponseType(typeof(IReadOnlyList<AiTraceStep>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> GetActivityTrace(long messageId, CancellationToken ct) =>
        AdminAsync(async t => await sender.Send(new GetAiActivityTraceQuery(t, messageId), ct) is { } trace ? Ok(trace) : NotFound());

    /// <summary>Failed AI calls in the last N days, newest first.</summary>
    [HttpGet("activity/failures")]
    [ProducesResponseType(typeof(IReadOnlyList<AiFailureDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetFailures([FromQuery] int days = 7, [FromQuery] int take = 100, CancellationToken ct = default) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiFailuresQuery(t, days, take), ct)));

    /// <summary>Calls today vs quota, and per-day totals for the last N days (default 14, max 90).</summary>
    [HttpGet("usage")]
    [ProducesResponseType(typeof(AiUsageSummaryDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public Task<IActionResult> GetUsage([FromQuery] int days = 14, CancellationToken ct = default) =>
        AdminAsync(async t => Ok(await sender.Send(new GetAiUsageQuery(t, days), ct)));

    // ── Plumbing ────────────────────────────────────────────────────────────────

    /// <summary>Writes a stream request's events as server-sent events.</summary>
    private async Task StreamAsync(IStreamRequest<AiAskEvent> request, CancellationToken ct)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";
        await foreach (var ev in sender.CreateStream(request, ct))
        {
            await Response.WriteAsync($"event: {ev.Type}\ndata: {JsonSerializer.Serialize(ev.Data, Json)}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }
    }

    private Task UnauthorizedStreamAsync() { Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; }

    /// <summary>Signed-in user's action: a business or provider error becomes 400 with { message }.</summary>
    private async Task<IActionResult> SendAiAsync(Func<long, long, Task<IActionResult>> action)
    {
        if (!TryGetIds(out var tenantId, out var userId)) return Unauthorized();
        try { return await action(tenantId, userId); }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException) { return BadRequest(new { message = ex.Message }); }
    }

    /// <summary>Admin action: 403 for others, business errors become 400 with { message }.</summary>
    private async Task<IActionResult> AdminAsync(Func<long, Task<IActionResult>> action)
    {
        if (!IsAdmin()) return Forbid();
        if (!TryGetTenantId(out var tenantId)) return Unauthorized();
        try { return await action(tenantId); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    private bool IsAdmin() => User.IsInRole("admin") || User.IsInRole("tenant_admin");

    private string UserId() =>
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "";

    private bool TryGetUserId(out long userId) => long.TryParse(UserId(), out userId);

    /// <summary>Who to show in a prompt's history: the e-mail from the token, else the user id.</summary>
    private string UserName() =>
        User.FindFirst(JwtRegisteredClaimNames.Email)?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value
        ?? User.FindFirst("email")?.Value ?? UserId();

    private bool TryGetIds(out long tenantId, out long userId) => TryGetTenantId(out tenantId) & TryGetUserId(out userId);

    private bool TryGetTenantId(out long tenantId)
    {
        tenantId = 0;
        var claim = User.FindFirst("tenantId")?.Value;
        return claim is not null && long.TryParse(claim, out tenantId) && tenantId > 0;
    }
}
