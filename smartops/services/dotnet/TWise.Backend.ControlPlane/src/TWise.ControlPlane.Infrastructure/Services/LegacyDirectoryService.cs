using Microsoft.EntityFrameworkCore;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities.Legacy;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class LegacyDirectoryService(LegacyDirectoryDbContext db, ICacheService cache) : ILegacyDirectoryService
{
    private const string ContactsCacheKey = "legacy:employee_contacts";
    private const string PlantsCacheKey = "legacy:plant_descriptions";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(30);

    public async Task<IReadOnlyList<EmployeeSearchResult>> SearchEmployeesAsync(string term, CancellationToken ct)
    {
        var employees = await db.Employees
            .AsNoTracking()
            .Where(e => e.EmpStatus && e.EmpName.Contains(term))
            .OrderBy(e => e.EmpName)
            .Take(20)
            .ToListAsync(ct);

        if (employees.Count == 0)
            return [];

        var contacts = await GetCachedContactsAsync(ct);
        var plants = await GetCachedPlantsAsync(ct);

        var contactsByEmpUid = contacts
            .GroupBy(c => c.PersonnelNumber)
            .ToDictionary(g => g.Key, g => g.ToList());

        return employees.Select(emp =>
        {
            if (!int.TryParse(emp.EmpUid, out var empUidInt))
                return new EmployeeSearchResult(emp.EmpUid, emp.EmpName, emp.Email, []);

            var empPlants = contactsByEmpUid.GetValueOrDefault(empUidInt, [])
                .Where(c => plants.ContainsKey(c.ClusterId))
                .Select(c =>
                {
                    var p = plants[c.ClusterId];
                    return new EmployeePlantAccess(p.PlantCode, p.PlantDesc, p.Cluster, p.Division, p.BusinessUnit, p.Sector, p.Country);
                })
                .DistinctBy(pa => pa.PlantCode)
                .ToList();

            return new EmployeeSearchResult(emp.EmpUid, emp.EmpName, emp.Email, empPlants);
        }).ToList();
    }

    private async Task<List<LegacyEmployeeContact>> GetCachedContactsAsync(CancellationToken ct)
    {
        var cached = await cache.GetAsync<List<LegacyEmployeeContact>>(ContactsCacheKey, ct);
        if (cached is not null) return cached;

        var contacts = await db.EmployeeContacts.AsNoTracking().ToListAsync(ct);
        await cache.SetAsync(ContactsCacheKey, contacts, CacheTtl, ct: ct);
        return contacts;
    }

    private async Task<Dictionary<int, LegacyPlantDescription>> GetCachedPlantsAsync(CancellationToken ct)
    {
        var cached = await cache.GetAsync<Dictionary<int, LegacyPlantDescription>>(PlantsCacheKey, ct);
        if (cached is not null) return cached;

        var list = await db.PlantDescriptions.AsNoTracking().ToListAsync(ct);
        var plants = list.GroupBy(p => p.PlantCode).ToDictionary(g => g.Key, g => g.First());
        await cache.SetAsync(PlantsCacheKey, plants, CacheTtl, ct: ct);
        return plants;
    }

    public async Task<IReadOnlyList<EmployeePlantAccess>> ListPlantsAsync(CancellationToken ct)
    {
        var plants = await GetCachedPlantsAsync(ct);
        return plants.Values
            .OrderBy(p => p.PlantCode)
            .Select(p => new EmployeePlantAccess(p.PlantCode, p.PlantDesc, p.Cluster, p.Division, p.BusinessUnit, p.Sector, p.Country))
            .ToList();
    }
}
