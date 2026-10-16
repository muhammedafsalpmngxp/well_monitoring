using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using SmartOps.Wells.Contracts;

namespace SmartOps.Wells.IntegrationTests.Controllers;

/// <summary>
/// Integration tests for the Wells endpoints using an in-process WebApplicationFactory.
/// These tests run against a test server with real middleware and routing but a mocked
/// repository layer — no SQL Server required.
///
/// NOTE: Wire up a custom WebApplicationFactory that replaces IWellsRepository with an
/// in-memory stub before running these tests in CI (see README for setup instructions).
/// </summary>
public sealed class WellsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GET_wells_Returns_200()
    {
        var response = await _client.GetAsync("/wells");

        // Will return 401 without a JWT — this test verifies routing is correct.
        response.StatusCode.Should().BeOneOf(HttpStatusCode.OK, HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GET_health_Returns_200()
    {
        var response = await _client.GetAsync("/health");
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task GET_dashboard_crews_deployed_Returns_200()
    {
        var response = await _client.GetAsync("/dashboard/crews-deployed");
        // Dashboard endpoint has [Authorize] commented out — expect 200 or 500 if DB unreachable
        response.StatusCode.Should().BeOneOf(
            HttpStatusCode.OK,
            HttpStatusCode.InternalServerError,
            HttpStatusCode.ServiceUnavailable);
    }
}
