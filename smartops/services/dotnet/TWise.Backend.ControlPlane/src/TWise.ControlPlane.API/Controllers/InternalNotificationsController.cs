using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Backend.ControlPlane.API.Auth;
using TWise.Backend.ControlPlane.Application.Features.Notifications;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.API.Controllers;

/// <summary>
/// Service-to-service ingest for notifications whose triggering event happened in another
/// service's DB (e.g. Tenant's Data Share / Data Quality events) — writes into the same
/// centralized control.Notification/NotificationRecipient store the navbar bell reads from.
/// Secured via the internal API key, same convention as InternalUsersController.
/// </summary>
[ApiController]
[Authorize(AuthenticationSchemes = InternalApiKeyHandler.SchemeName, Policy = InternalApiKeyHandler.PolicyName)]
[Route("internal/notifications")]
[Tags("Internal")]
public sealed class InternalNotificationsController(ISender sender) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Create([FromBody] CreateNotificationRequest request, CancellationToken ct)
    {
        if (request.TenantId <= 0)
            return BadRequest(new { error = "A valid tenantId is required." });
        if (string.IsNullOrWhiteSpace(request.Type) || string.IsNullOrWhiteSpace(request.Title))
            return BadRequest(new { error = "type and title are required." });
        if (request.RecipientUserIds.Count == 0 && string.IsNullOrWhiteSpace(request.ModuleCode))
            return BadRequest(new { error = "Either recipientUserIds or moduleCode (broadcast) is required." });

        var result = await sender.Send(new CreateNotificationCommand(request), ct);
        return result.IsSuccess ? Ok() : StatusCode(500);
    }
}
