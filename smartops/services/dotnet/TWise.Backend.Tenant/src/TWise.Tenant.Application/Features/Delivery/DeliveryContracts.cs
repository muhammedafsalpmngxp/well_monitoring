using TWise.Tenant.Domain.Entities.Delivery;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>
/// A user as the control plane knows them now: address, name, whether they may sign in, roles, plants, and the page
/// modules they may view (ViewModules). An admin role passes every module check, as it does in the access token.
/// </summary>
public sealed record DirectoryUser(
    long UserId, string Email, string? Name, bool IsActive, IReadOnlyList<string> RoleCodes, IReadOnlyList<int> PlantCodes,
    IReadOnlyList<string>? ViewModules = null)
{
    public bool CanView(string moduleCode)
        => RunAsScope.Roles(this).Contains("admin") || (ViewModules ?? []).Contains(moduleCode);
}

/// <summary>
/// Reads users of the tenant from the control plane: the named users, and every user holding one of the role codes.
/// Throws when the control plane cannot be reached, so the run fails rather than sending to fewer people.
/// </summary>
public interface IRecipientResolver
{
    Task<IReadOnlyList<DirectoryUser>> ResolveAsync(
        long tenantId, IReadOnlyCollection<long> userIds, IReadOnlyCollection<string> roleCodes, CancellationToken ct);
}

public sealed record MailAttachment(string FileName, string ContentType, byte[] Content);

public sealed record MailEnvelope(
    IReadOnlyList<string> To, IReadOnlyList<string> Cc, IReadOnlyList<string> Bcc, string Subject, string Body,
    IReadOnlyList<MailAttachment> Attachments);

/// <summary>
/// Refused lists the addresses the sender would not send to (a domain outside Mail:AllowedDomains); the rest got the
/// mail. Note is anything the Delivery Log should show about a mail that went, such as it being kept in a pickup folder.
/// </summary>
public sealed record MailResult(IReadOnlyList<string> Refused, string? Note = null);

public interface IMailSender
{
    /// <summary>Throws when the mail could not be handed to the server; the runner then tries again.</summary>
    Task<MailResult> SendAsync(MailEnvelope mail, CancellationToken ct);
}

/// <summary>What a run sends: the item's name, its link, the files, and whether every table in them is empty.</summary>
/// <summary>Note, when set, is logged on the run, for example the filters a saved view's rows are not filtered by.</summary>
public sealed record RenderedDelivery(string TargetName, string Link, bool IsEmpty, IReadOnlyList<MailAttachment> Attachments, string? Note = null);

/// <summary>
/// Turns one kind of item into what a run sends. It runs inside RunAsScope, so the data is read as the schedule's owner.
/// Throws DeliveryException when the item is missing or cannot be read.
/// </summary>
public interface IDeliveryRenderer
{
    /// <summary>Report, Dashboard or Canvas.</summary>
    string TargetType { get; }

    Task<RenderedDelivery> RenderAsync(Schedule schedule, CancellationToken ct);
}

/// <summary>A run that cannot go ahead, with the reason the Delivery Log shows.</summary>
public sealed class DeliveryException(string message) : Exception(message);

public static class DeliveryLinks
{
    /// <summary>The page that shows the item, under App:PublicBaseUrl.</summary>
    public static string For(string? publicBaseUrl, string targetType, long targetId)
    {
        var path = targetType switch
        {
            DeliveryTerms.Report => $"reports/view/{targetId}",
            DeliveryTerms.Dashboard => $"dashboard/operations-dashboard/{targetId}",
            _ => $"canvas/{targetId}",
        };
        return $"{(publicBaseUrl ?? string.Empty).TrimEnd('/')}/{path}";
    }
}
