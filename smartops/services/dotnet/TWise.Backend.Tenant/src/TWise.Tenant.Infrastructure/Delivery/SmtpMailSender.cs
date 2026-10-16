using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Features.Delivery;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// Sends through the SMTP server in Mail:Host (Port, EnableSsl, User, Password, From, FromName). With no host the mail
/// is written as an .eml file to Mail:PickupDirectory (default %TEMP%/twise-mail), so nothing leaves a dev or QA box by
/// accident. When Mail:AllowedDomains lists domains, other addresses are refused and returned; the rest get the mail.
/// Settings are read on each send, so a changed setting needs no code change.
/// </summary>
public sealed class SmtpMailSender(IConfiguration config) : IMailSender
{
    public async Task<MailResult> SendAsync(MailEnvelope mail, CancellationToken ct)
    {
        var mailConfig = config.GetSection("Mail");
        var allowed = mailConfig.GetSection("AllowedDomains").Get<string[]>()?.Where(d => !string.IsNullOrWhiteSpace(d)).ToArray() ?? [];
        var refused = new List<string>();
        List<string> Allowed(IEnumerable<string> addresses) => addresses.Where(address =>
        {
            var at = address.LastIndexOf('@');
            var ok = allowed.Length == 0 || (at > 0 && allowed.Contains(address[(at + 1)..].Trim(), StringComparer.OrdinalIgnoreCase));
            if (!ok) refused.Add(address);
            return ok;
        }).ToList();

        var to = Allowed(mail.To);
        var cc = Allowed(mail.Cc);
        var bcc = Allowed(mail.Bcc);
        if (to.Count + cc.Count + bcc.Count == 0) return new MailResult(refused);

        var from = mailConfig["From"] is { Length: > 0 } address ? address : "no-reply@localhost";
        using var message = new MailMessage
        {
            From = new MailAddress(from, mailConfig["FromName"] ?? string.Empty),
            Subject = mail.Subject,
            Body = mail.Body,
            IsBodyHtml = false,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
        };
        to.ForEach(message.To.Add);
        cc.ForEach(message.CC.Add);
        bcc.ForEach(message.Bcc.Add);
        foreach (var file in mail.Attachments)
            message.Attachments.Add(new Attachment(new MemoryStream(file.Content), file.FileName, file.ContentType));

        using var client = new SmtpClient();
        var host = mailConfig["Host"];
        string? note = null;
        if (string.IsNullOrWhiteSpace(host))
        {
            var folder = mailConfig["PickupDirectory"] is { Length: > 0 } pickup ? pickup : Path.Combine(Path.GetTempPath(), "twise-mail");
            Directory.CreateDirectory(folder);
            client.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
            client.PickupDirectoryLocation = Path.GetFullPath(folder);
            note = "No mail server is set; the message was saved to the pickup folder.";
        }
        else
        {
            client.Host = host;
            client.Port = int.TryParse(mailConfig["Port"], out var port) ? port : 587;
            client.EnableSsl = !bool.TryParse(mailConfig["EnableSsl"], out var ssl) || ssl;
            if (mailConfig["User"] is { Length: > 0 } user) client.Credentials = new NetworkCredential(user, mailConfig["Password"]);
        }
        await client.SendMailAsync(message, ct);
        return new MailResult(refused, note);
    }
}
