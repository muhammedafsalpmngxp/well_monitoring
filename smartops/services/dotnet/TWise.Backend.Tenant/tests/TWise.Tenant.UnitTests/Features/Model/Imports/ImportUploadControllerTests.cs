using System.Security.Claims;
using System.Text;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Controllers;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Imports;

namespace TWise.Tenant.UnitTests.Features.Model.Imports;

/// <summary>The upload endpoints check the caller's permission before they read the request body.</summary>
public sealed class ImportUploadControllerTests
{
    private const string Boundary = "b0undary";

    private sealed class WatchedStream(byte[] content) : MemoryStream(content)
    {
        public bool WasRead { get; private set; }

        public override int Read(byte[] buffer, int offset, int count) { WasRead = true; return base.Read(buffer, offset, count); }

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) { WasRead = true; return base.ReadAsync(buffer, ct); }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) { WasRead = true; return base.ReadAsync(buffer, offset, count, ct); }
    }

    private static byte[] Multipart()
    {
        var text = new StringBuilder();
        void Field(string name, string value)
            => text.Append($"--{Boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n");
        Field("sheet", "Hours");
        Field("headerRow", "2");
        Field("types", "text");
        Field("types", "decimal");
        text.Append($"--{Boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"crew.csv\"\r\nContent-Type: text/csv\r\n\r\nCrew,Hours\r\n--{Boundary}--\r\n");
        return Encoding.UTF8.GetBytes(text.ToString());
    }

    private static (ModelDatasetsController Controller, WatchedStream Body, Mock<ISender> Sender) Make(string permission)
    {
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<PreviewImportQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result<ImportPreviewDto>.ValidationError("stop"));
        var body = new WatchedStream(Multipart());
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("tenantId", "2"), new Claim("perm", permission)], "test")),
        };
        http.Request.ContentType = $"multipart/form-data; boundary={Boundary}";
        http.Request.Body = body;
        var controller = new ModelDatasetsController(sender.Object) { ControllerContext = new ControllerContext { HttpContext = http } };
        return (controller, body, sender);
    }

    [Fact]
    public async Task An_upload_by_someone_who_may_not_create_is_refused_before_its_body_is_read()
    {
        var (controller, body, sender) = Make("model.studio:vm");

        var result = await controller.PreviewImport(1, default);

        result.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(403);
        body.WasRead.Should().BeFalse();
        sender.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task An_allowed_upload_reads_the_file_and_options_from_the_form()
    {
        var (controller, _, sender) = Make("model.studio:vc");

        await controller.PreviewImport(1, default);

        sender.Verify(s => s.Send(It.Is<PreviewImportQuery>(q =>
            q.File.FileName == "crew.csv" && q.File.Content.Length == 10
            && q.Options.Sheet == "Hours" && q.Options.HeaderRow == 2 && q.Options.LastRow == null
            && q.Options.Types!.SequenceEqual(new[] { "text", "decimal" }) && q.TenantId == 2), It.IsAny<CancellationToken>()));
    }
}
