using System.Text;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Features.Delivery;
using TWise.Tenant.Infrastructure.Delivery;
using Xunit;

namespace TWise.Tenant.UnitTests.Features.Delivery;

public sealed class SmtpMailSenderTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "twise-mail-test-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_folder)) Directory.Delete(_folder, true);
    }

    private SmtpMailSender Sender(params string[] allowedDomains)
    {
        var settings = new Dictionary<string, string?> { ["Mail:Host"] = "", ["Mail:PickupDirectory"] = _folder, ["Mail:From"] = "reports@tasnim.om", ["Mail:FromName"] = "T-Wise" };
        for (var i = 0; i < allowedDomains.Length; i++) settings[$"Mail:AllowedDomains:{i}"] = allowedDomains[i];
        return new SmtpMailSender(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
    }

    private static MailEnvelope Envelope(params string[] to) => new(
        to, ["cc@tasnim.om"], ["hidden@tasnim.om"], "Wells on 28 Sep 2026", "Hello\n\nhttp://app/reports/view/9",
        [new MailAttachment("Wells.csv", "text/csv", Encoding.UTF8.GetBytes("a,b\r\n1,2\r\n"))]);

    [Fact]
    public async Task Without_a_host_the_mail_is_written_to_the_pickup_folder()
    {
        var result = await Sender().SendAsync(Envelope("ops@tasnim.om"), default);

        result.Refused.Should().BeEmpty();
        var eml = await File.ReadAllTextAsync(Directory.GetFiles(_folder, "*.eml").Single());
        eml.Should().Contain("To: ops@tasnim.om");
        eml.Should().Contain("Cc: cc@tasnim.om");
        eml.Should().NotContain("Bcc:");
        eml.Should().Contain("X-Receiver: hidden@tasnim.om");
        eml.Should().Contain("From: \"T-Wise\" <reports@tasnim.om>");
        eml.Should().Contain("Subject: Wells on 28 Sep 2026");
        eml.Should().Contain("name=Wells.csv");
        eml.Should().Contain(Convert.ToBase64String(Encoding.UTF8.GetBytes("a,b\r\n1,2\r\n")));
    }

    [Fact]
    public async Task Addresses_outside_the_allowed_domains_are_refused_and_the_rest_get_the_mail()
    {
        var result = await Sender("tasnim.om").SendAsync(Envelope("ops@tasnim.om", "someone@gmail.com"), default);

        result.Refused.Should().Equal("someone@gmail.com");
        var eml = await File.ReadAllTextAsync(Directory.GetFiles(_folder, "*.eml").Single());
        eml.Should().NotContain("gmail.com");
    }

    [Fact]
    public async Task Nothing_is_written_when_every_address_is_refused()
    {
        var result = await Sender("tasnim.om").SendAsync(
            new MailEnvelope(["a@gmail.com"], [], [], "S", "B", []), default);

        result.Refused.Should().Equal("a@gmail.com");
        Directory.Exists(_folder).Should().BeFalse();
    }

    [Fact]
    public async Task Pickup_mode_says_so_in_the_result()
        => (await Sender().SendAsync(Envelope("ops@tasnim.om"), default)).Note.Should().Contain("pickup folder");
}
