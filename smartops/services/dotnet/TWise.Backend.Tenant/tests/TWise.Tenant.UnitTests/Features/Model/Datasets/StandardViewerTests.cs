using System.Security.Claims;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using TWise.Tenant.API.Controllers;
using TWise.Tenant.Application.Common;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain;

namespace TWise.Tenant.UnitTests.Features.Model.Datasets;

/// <summary>Someone who may only view the Standard lists sees published data models only.</summary>
public sealed class StandardViewerTests
{
    private static readonly DatasetSummaryDto Draft = new(1, "Draft", null, 4, "draft", DateTime.UtcNow);
    private static readonly DatasetSummaryDto Published = new(2, "Published", null, 4, "published", DateTime.UtcNow, DateTime.UtcNow);

    private static ModelDatasetsController Make(string permission)
    {
        var sender = new Mock<ISender>();
        sender.Setup(s => s.Send(It.IsAny<ListDatasetsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result<IReadOnlyList<DatasetSummaryDto>>.Success([Draft, Published]));
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("tenantId", "2"), new Claim("perm", permission)], "test")),
        };
        return new ModelDatasetsController(sender.Object) { ControllerContext = new ControllerContext { HttpContext = http } };
    }

    private static async Task<IEnumerable<long>> Listed(string permission)
    {
        var ok = (await Make(permission).List(CancellationToken.None)).Should().BeAssignableTo<ObjectResult>().Subject;
        return ((ApiEnvelope<IReadOnlyList<DatasetSummaryDto>>)ok.Value!).Data!.Select(d => d.Id);
    }

    [Fact]
    public async Task A_standard_viewer_lists_published_data_models_and_an_author_lists_all()
    {
        (await Listed("model.standard-datasets:v")).Should().Equal(2);
        (await Listed("dashboard.standard-canvases:v")).Should().Equal(2);
        (await Listed("model.studio:v")).Should().Equal(1, 2);
        (await Listed("dashboard.canvas:v")).Should().Equal(1, 2);
    }
}
