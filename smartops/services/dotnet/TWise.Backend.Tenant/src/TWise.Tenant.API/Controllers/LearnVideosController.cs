using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Auth;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.LearnVideos;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.API.Controllers;

/// <summary>
/// "Learn" videos for the builder screens. The MP4 is served from object storage (S3); this only
/// hands the client the URL and chapter markers stored in core.LearnVideos. Admins manage the rows
/// from Settings → Learn Videos.
/// </summary>
[ApiController]
[Authorize]
[Route("api/learn-videos")]
public sealed class LearnVideosController(ISender sender) : ControllerBase
{
    /// <summary>Every configured video, active or not (admin only).</summary>
    [HttpGet]
    [RequireModulePermission("settings.learn-videos", 'v')]
    [ProducesResponseType(typeof(IReadOnlyList<LearnVideoDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        return Ok(await sender.Send(new ListLearnVideosQuery(), ct));
    }

    /// <summary>The active video for a screen, e.g. chart-builder or report-builder. 404 when none is configured.</summary>
    [HttpGet("{screenKey}")]
    [ProducesResponseType(typeof(LearnVideoDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Get(string screenKey, CancellationToken ct)
    {
        var video = await sender.Send(new GetLearnVideoQuery(screenKey), ct);
        return video is null ? NotFound() : Ok(video);
    }

    /// <summary>Creates or replaces the video for a screen (admin only). URLs must be https.</summary>
    [HttpPut("{screenKey}")]
    [RequireModulePermission("settings.learn-videos", 'c', 'm')]
    [ProducesResponseType(typeof(LearnVideoDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> Save(string screenKey, [FromBody] SaveLearnVideoRequest request, CancellationToken ct)
    {
        try
        {
            var videos = await sender.Send(new ListLearnVideosQuery(), ct);
            var exists = videos.Any(video => string.Equals(video.ScreenKey, screenKey, StringComparison.OrdinalIgnoreCase));
            if (!ModulePermission.Has(User, "settings.learn-videos", exists ? ModulePermission.Modify : ModulePermission.Create))
                return Forbid();
            return Ok(await sender.Send(new SaveLearnVideoCommand(screenKey, request), ct));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

}
