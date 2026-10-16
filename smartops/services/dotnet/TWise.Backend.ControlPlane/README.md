# SmartOps.ControlPlane

Multi-tenant control plane service for the SmartOps platform. Manages tenants, users, roles, feature flags, source system mappings, and operational audit trails.

---

## Quick Start

### Prerequisites

- .NET 8 SDK
- SQL Server (connection to `20.98.112.250,1433`)
- EF Core CLI tools (`dotnet tool install --global dotnet-ef`)

### Run the Service

```bash
cd smartops/services/dotnet/SmartOps.ControlPlane/src/SmartOps.ControlPlane.API
dotnet run
```

The API starts at **http://localhost:7007** with Swagger UI at **http://localhost:7007/swagger**

> In Development mode, the Admin auth policy is relaxed so you can test endpoints directly from Swagger without a JWT token.

---

## Project Structure

```
SmartOps.ControlPlane/
└── src/
    ├── SmartOps.ControlPlane.API/              ← Entry point, controllers, middleware
    │   ├── Controllers/                        ← One controller per entity (16 files)
    │   ├── Extensions/                         ← DI and middleware registration
    │   ├── Middleware/                         ← ValidationExceptionMiddleware
    │   ├── Program.cs                         ← App startup
    │   └── appsettings.json                   ← All configuration
    │
    ├── SmartOps.ControlPlane.Application/      ← Business logic (CQRS handlers)
    │   ├── Abstractions/                      ← IRepository<T> interface
    │   ├── Common/                            ← Result<T>, pipeline behaviors
    │   │   └── Behaviors/                     ← LoggingBehavior, ValidationBehavior
    │   └── Features/                          ← Organized by domain area
    │       ├── Tenants/                       ← Region, SchemaVersion, Tenant
    │       ├── Sources/                       ← SourceSystem, TenantSource, Canonical*, FieldMapping, CapabilityProfile
    │       ├── Access/                        ← AppUser, Role, UserTenantRole, Feature, TenantFeature
    │       └── Operations/                    ← IngestionRun, AuditEvent
    │
    ├── SmartOps.ControlPlane.Contracts/        ← DTO records (shared with consumers)
    │
    ├── SmartOps.ControlPlane.Domain/           ← Entity classes (one file per entity)
    │   └── Entities/
    │
    └── SmartOps.ControlPlane.Infrastructure/   ← EF Core, database access
        ├── Persistence/
        │   ├── ControlPlaneDbContext.cs        ← DbContext with DbSets
        │   ├── Configurations/                ← One IEntityTypeConfiguration per entity
        │   └── Migrations/                    ← EF Core migrations
        ├── Repositories/
        │   └── Repository.cs                  ← Generic CRUD repository
        └── DependencyInjection.cs             ← Infrastructure DI registration
```

### Dependency Flow

```
API → Application → Domain
API → Infrastructure → Application → Domain
API → Contracts
```

> The Domain layer has zero dependencies on infrastructure. The Application layer defines abstractions (interfaces) that Infrastructure implements.

---

## Database

| Setting  | Value                    |
| -------- | ------------------------ |
| Server   | `20.98.112.250,1433`     |
| Database | `smartops_control_plane` |
| Schema   | `control`                |
| Auth     | SQL Server (`SA`)        |

All tables live under the `control` schema. The `__EFMigrationsHistory` table tracks applied migrations in the `dbo` schema.

### Tables (16)

| Table               | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `Region`            | Deployment regions                       |
| `SchemaVersion`     | Canonical model versioning               |
| `Tenant`            | Registered tenants                       |
| `SourceSystem`      | External data source definitions         |
| `TenantSource`      | Tenant-to-source bindings                |
| `CanonicalEntity`   | Data model entity catalog                |
| `CanonicalField`    | Field definitions per entity             |
| `FieldMapping`      | Source-to-canonical field transforms     |
| `CapabilityProfile` | Field availability per tenant source     |
| `AppUser`           | Platform users                           |
| `Role`              | Role definitions (platform/tenant scope) |
| `UserTenantRole`    | User-tenant-role assignments             |
| `Feature`           | Feature flag definitions                 |
| `TenantFeature`     | Feature enablement per tenant            |
| `IngestionRun`      | Data ingestion execution logs            |
| `AuditEvent`        | Platform audit trail                     |

---

## EF Core Migrations

All migration commands run from the **API project directory**:

```bash
cd smartops/services/dotnet/SmartOps.ControlPlane/src/SmartOps.ControlPlane.API
```

### Create a New Migration

```bash
dotnet ef migrations add <MigartionName> --project ..\TWise.ControlPlane.Infrastructure\ --output-dir Persistence/Migrations
```

Example:

```bash
dotnet ef migrations add AddTenantMetadataColumn --project ..\TWise.ControlPlane.Infrastructure\ --output-dir Persistence/Migrations
```

### Apply Migrations to Database

```bash
dotnet ef database update --project ..\TWise.ControlPlane.Infrastructure\
```

### Other Useful Commands

```bash
# List all migrations and their applied status
dotnet ef migrations list --project ../SmartOps.ControlPlane.Infrastructure

# Remove the last unapplied migration (if you made a mistake)
dotnet ef migrations remove --project ../SmartOps.ControlPlane.Infrastructure

# Generate an idempotent SQL script (for review or manual deployment)
dotnet ef migrations script --project ../SmartOps.ControlPlane.Infrastructure --idempotent -o migration.sql
```

---

## Configuration

All config is in `appsettings.json`. Key sections:

### Connection String

```json
"ConnectionStrings": {
  "ControlPlane": "Server=20.98.112.250,1433;Database=smartops_control_plane;User ID=SA;Password=CHANGE_ME;TrustServerCertificate=True;"
}
```

### Serilog (Logging)

Logs go to both **console** and **file** (`logs/controlplane-{date}.log`).

```json
"Serilog": {
  "MinimumLevel": {
    "Default": "Information",
    "Override": {
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore": "Warning"
    }
  },
  "WriteTo": [
    { "Name": "Console", "Args": { ... } },
    { "Name": "File", "Args": { "path": "logs/controlplane-.log", "rollingInterval": "Day" } }
  ]
}
```

To change log level at runtime, just edit `appsettings.json` — Serilog picks up changes without restart.

### JWT / Auth

```json
"JwtSettings": {
  "SecretKey": "CHANGE_ME_to_a_long_random_secret_at_least_32_chars",
  "Issuer": "smartops.auth",
  "Audience": "smartops.api",
  "ExpiryMinutes": 480
}
```

### CORS

```json
"Cors": {
  "AllowedOrigins": "http://localhost:4200,http://localhost:4300,http://localhost:7000"
}
```

---

## API Endpoints

All endpoints require **Admin** policy (JWT with admin role). In Development mode, auth is bypassed for Swagger testing.

Base URL: `http://localhost:7007`  
Gateway URL: `http://localhost:7000/api/v1/controlplane/<resource>`

| Resource            | Route                  | Methods                                 |
| ------------------- | ---------------------- | --------------------------------------- |
| Regions             | `/regions`             | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Schema Versions     | `/schema-versions`     | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Tenants             | `/tenants`             | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Source Systems      | `/source-systems`      | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Tenant Sources      | `/tenant-sources`      | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Canonical Entities  | `/canonical-entities`  | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Canonical Fields    | `/canonical-fields`    | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Field Mappings      | `/field-mappings`      | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Capability Profiles | `/capability-profiles` | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Users               | `/users`               | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Roles               | `/roles`               | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| User Tenant Roles   | `/user-tenant-roles`   | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Features            | `/features`            | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Tenant Features     | `/tenant-features`     | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Ingestion Runs      | `/ingestion-runs`      | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Audit Events        | `/audit-events`        | GET, GET/:id, POST, PUT/:id, DELETE/:id |
| Health Check        | `/health/ready`        | GET (anonymous)                         |

---

## Architecture Patterns

### CQRS (Command Query Responsibility Segregation)

Every API request flows through MediatR:

```
Controller → ISender.Send(Query/Command) → Pipeline Behaviors → Handler → Repository
```

- **Queries** return DTOs (read-only, no side effects)
- **Commands** mutate data and return entities or `Result` status

### Pipeline Behaviors

Registered in order:

1. **LoggingBehavior** — Logs start/end/duration, warns on slow requests (>500ms), logs failures
2. **ValidationBehavior** — Runs FluentValidation rules before the handler executes

### Validation

FluentValidation validators auto-registered from the Application assembly. Invalid requests throw `ValidationException`, caught by `ValidationExceptionMiddleware` → returns 400:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "One or more validation errors occurred.",
    "details": {
      "RegionCode": ["RegionCode is required."]
    },
    "traceId": "0HN..."
  }
}
```

### Generic Repository

A single `Repository<T>` handles all CRUD for all 16 entities. Registered as open-generic:

```csharp
services.AddScoped(typeof(IRepository<>), typeof(Repository<>));
```

Features:

- `AsNoTracking()` for all reads
- Automatic `created_at`/`modified_at` stamping via `IControlAudited`
- Structured logging on Create/Update/Delete
- PK protection (route ID is authoritative, body PK is ignored on PUT)

---

## Adding a New Entity

1. **Domain** — Create entity class in `Domain/Entities/NewEntity.cs`
2. **Infrastructure** — Add `IEntityTypeConfiguration<NewEntity>` in `Persistence/Configurations/`
3. **Infrastructure** — Add `DbSet<NewEntity>` to `ControlPlaneDbContext`
4. **Application** — Add Query + Command + Validator in `Features/<Area>/`
5. **Contracts** — Add DTO record in `ControlPlaneContracts.cs`
6. **API** — Add controller in `Controllers/NewEntityController.cs`
7. **Migration** — Run `dotnet ef migrations add AddNewEntity ...`
8. **Apply** — Run `dotnet ef database update ...`

---

## Troubleshooting

| Issue                            | Fix                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Build fails with file lock error | Stop the running `dotnet run` process first                                          |
| Migration says "already exists"  | Tables already exist; baseline with `--no-transact` or check `__EFMigrationsHistory` |
| Swagger shows 401                | You're not in Development environment, or the token is missing                       |
| Logs not appearing in file       | Check `logs/` folder exists and app has write permission                             |
| Connection timeout               | Verify SQL Server at `20.98.112.250,1433` is reachable                               |
