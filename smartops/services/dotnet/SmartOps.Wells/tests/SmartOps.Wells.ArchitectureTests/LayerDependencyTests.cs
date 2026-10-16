using System.Reflection;
using FluentAssertions;
using NetArchTest.Rules;

namespace SmartOps.Wells.ArchitectureTests;

/// <summary>
/// Enforces Clean Architecture dependency rules across SmartOps.Wells layers.
/// </summary>
public class LayerDependencyTests
{
    private static readonly Assembly DomainAssembly = typeof(Domain.Entities.Well).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(Application.DependencyInjection).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(Infrastructure.DependencyInjection).Assembly;
    private static readonly Assembly ApiAssembly = typeof(API.Extensions.PresentationExtensions).Assembly;
    private static readonly Assembly ContractsAssembly = typeof(Contracts.WellDto).Assembly;

    [Fact]
    public void Domain_Should_Not_Depend_On_Application()
    {
        Types.InAssembly(DomainAssembly)
            .ShouldNot()
            .HaveDependencyOn("SmartOps.Wells.Application")
            .GetResult()
            .IsSuccessful
            .Should().BeTrue();
    }

    [Fact]
    public void Domain_Should_Not_Depend_On_Infrastructure()
    {
        Types.InAssembly(DomainAssembly)
            .ShouldNot()
            .HaveDependencyOn("SmartOps.Wells.Infrastructure")
            .GetResult()
            .IsSuccessful
            .Should().BeTrue();
    }

    [Fact]
    public void Domain_Should_Not_Depend_On_API()
    {
        Types.InAssembly(DomainAssembly)
            .ShouldNot()
            .HaveDependencyOn("SmartOps.Wells.API")
            .GetResult()
            .IsSuccessful
            .Should().BeTrue();
    }

    [Fact]
    public void Application_Should_Not_Depend_On_Infrastructure()
    {
        Types.InAssembly(ApplicationAssembly)
            .ShouldNot()
            .HaveDependencyOn("SmartOps.Wells.Infrastructure")
            .GetResult()
            .IsSuccessful
            .Should().BeTrue();
    }

    [Fact]
    public void Application_Should_Not_Depend_On_API()
    {
        Types.InAssembly(ApplicationAssembly)
            .ShouldNot()
            .HaveDependencyOn("SmartOps.Wells.API")
            .GetResult()
            .IsSuccessful
            .Should().BeTrue();
    }

    [Fact]
    public void Contracts_Should_Not_Depend_On_Any_Layer()
    {
        Types.InAssembly(ContractsAssembly)
            .ShouldNot()
            .HaveDependencyOnAny(
                "SmartOps.Wells.Domain",
                "SmartOps.Wells.Application",
                "SmartOps.Wells.Infrastructure",
                "SmartOps.Wells.API")
            .GetResult()
            .IsSuccessful
            .Should().BeTrue();
    }
}
