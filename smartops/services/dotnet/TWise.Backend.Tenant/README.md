# TWise.Backend.Tenant

Per-tenant data plane service for the SmartOps platform.

## Architecture

```
TWise.Tenant.API            → Controllers, Program.cs, DI registration (port 7008)
TWise.Tenant.Application    → Abstractions (IRepository, service interfaces)
TWise.Tenant.Contracts      → DTOs shared with other services
TWise.Tenant.Domain         → Entity classes (star schema: ref.*, core.*, ml.*)
TWise.Tenant.Infrastructure → GenericRepository, TenantDbContext, service implementations
```

## Build

```bash
cd src/TWise.Tenant.API
dotnet build
dotnet run
```
