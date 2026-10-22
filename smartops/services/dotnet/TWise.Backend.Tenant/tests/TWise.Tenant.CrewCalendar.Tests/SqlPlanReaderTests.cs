using TWise.Tenant.Infrastructure.Services;
using Xunit;

namespace TWise.Tenant.CrewCalendar.Tests;

public class SqlPlanReaderTests
{
    private const string Plan = """
        <ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
          <BatchSequence><Batch><Statements>
            <StmtSimple StatementSubTreeCost="12.5" StatementEstRows="45000">
              <QueryPlan>
                <MissingIndexes><MissingIndexGroup Impact="87.3"><MissingIndex Database="[db]" Schema="[dbo]" Table="[Jobs]">
                  <ColumnGroup Usage="EQUALITY"><Column Name="[Status]" /></ColumnGroup>
                  <ColumnGroup Usage="INCLUDE"><Column Name="[WellCode]" /><Column Name="[Hours]" /></ColumnGroup>
                </MissingIndex></MissingIndexGroup></MissingIndexes>
                <Warnings><PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT_IMPLICIT(int,[Code],0)" /></Warnings>
                <RelOp PhysicalOp="Clustered Index Scan" EstimateRows="45000">
                  <IndexScan><Object Schema="[dbo]" Table="[Jobs]" Index="[PK_Jobs]" /></IndexScan>
                </RelOp>
                <RelOp PhysicalOp="Index Seek" EstimateRows="10"><IndexScan><Object Schema="[dbo]" Table="[Wells]" Index="[IX_Wells]" /></IndexScan></RelOp>
              </QueryPlan>
            </StmtSimple>
          </Statements></Batch></BatchSequence>
        </ShowPlanXML>
        """;

    [Fact]
    public void Plan_is_reduced_to_scans_missing_indexes_warnings_and_cost()
    {
        var facts = SqlPlanReader.Summarise([Plan], 8);   // AiSqlReview:PlanMaxListed
        Assert.Equal(1, facts.Statements);
        Assert.Equal(12.5, facts.EstimatedCost);
        Assert.Equal(45000, facts.EstimatedRows);
        Assert.Single(facts.Scans);
        Assert.Contains("Clustered Index Scan on dbo.Jobs (PK_Jobs): ~45,000 rows", facts.Scans[0]);
        Assert.Equal("dbo.Jobs (Status) INCLUDE (WellCode, Hours) — estimated impact 87%", facts.MissingIndexes[0]);
        Assert.Contains("PlanAffectingConvert: CONVERT_IMPLICIT(int,[Code],0)", facts.Warnings[0]);
    }
}
