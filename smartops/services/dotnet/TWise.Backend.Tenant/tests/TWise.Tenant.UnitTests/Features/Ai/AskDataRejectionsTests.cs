using System.Text.Json;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Ai;

/// <summary>The queries Ask Data refused on the way to an answer, kept in core.AiTraces.rejections_json.</summary>
public class AskDataRejectionsTests
{
    [Fact]
    public void Each_refused_query_is_read_with_its_stage_reason_and_sql_in_order()
    {
        using var done = JsonDocument.Parse("""
            {"answer": "a", "rejections": [
              {"stage": "validator", "sql": "SELECT x FROM dbo.t", "reason": "Not allowed: dbo.t", "sub_question": "late wells"},
              {"stage": "verifier", "sql": "SELECT COUNT(*) FROM well.well_master", "reason": "Counts wells, not tasks.", "sub_question": "late wells"},
              "not an object"]}
            """);

        var rejections = AiAskService.Rejections(done.RootElement);

        rejections.Should().Equal(
            new AskDataRejection("validator", "SELECT x FROM dbo.t", "Not allowed: dbo.t", "late wells"),
            new AskDataRejection("verifier", "SELECT COUNT(*) FROM well.well_master", "Counts wells, not tasks.", "late wells"));
        // Stored camelCase, so SQL can read it: JSON_VALUE(r.value, '$.stage') = 'verifier'.
        JsonSerializer.Serialize(rejections[1], new JsonSerializerOptions(JsonSerializerDefaults.Web))
            .Should().Contain("\"stage\":\"verifier\"").And.Contain("\"subQuestion\":\"late wells\"");
    }

    [Fact]
    public void An_answer_with_no_rejections_has_none()
    {
        using var older = JsonDocument.Parse("""{"answer": "a"}""");
        AiAskService.Rejections(older.RootElement).Should().BeEmpty();
    }
}
