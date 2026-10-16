using System.Data;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.UnitTests.Features.Model;

public sealed class ModelQueryServiceTests
{
    [Fact]
    public void Date_parameters_are_sent_as_datetime2_so_early_years_and_milliseconds_survive()
    {
        var value = new DateTime(1700, 1, 1, 23, 59, 59, 999);

        var parameter = ModelQueryService.Parameter("@p0", value);

        parameter.ParameterName.Should().Be("@p0");
        parameter.SqlDbType.Should().Be(SqlDbType.DateTime2);
        parameter.Value.Should().Be(value);
    }

    [Theory]
    [InlineData("Done", SqlDbType.NVarChar)]
    [InlineData(7, SqlDbType.Int)]
    public void Other_parameters_keep_the_type_of_their_value(object value, SqlDbType type)
        => ModelQueryService.Parameter("@p0", value).SqlDbType.Should().Be(type);

    [Fact]
    public void Decimal_parameters_stay_decimal()
        => ModelQueryService.Parameter("@p0", 2.5m).SqlDbType.Should().Be(SqlDbType.Decimal);
}
