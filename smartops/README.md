#Installations
cd c:\WMR\Web_repo\wellmonitoring\smartops
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install every service's deps into the same venv
pip install -r services\python\jenny_ai\requirements.txt
pip install -r services\python\predictive\requirements.txt
pip install -r services\python\anomaly\requirements.txt
pip install -r services\python\crew_optimizer\requirements.txt
pip install -r services\python\vision\requirements.txt

# Also needed for the runner script
pip install httpx

# SmartOps Platform — Hybrid .NET + Python Microservices

A production-shaped backend for the WMR oilfield-monitoring SPA, split along
the architecture you provided:

* **.NET 8 / ASP.NET Core** for enterprise concerns (auth, wells, finance,
  workflow, reports, integrations, SignalR alerts)
* **Python / FastAPI** for AI / ML workloads (Jenny AI, Prophet
  forecasting, Isolation-Forest anomaly detection, OR-Tools crew
  optimisation, YOLOv8 worker detection)

## Architecture

```
                         Angular SPA
                              │
                  ┌───────────▼──────────────┐
                  │   API Gateway  (YARP)    │   :7000  ← Azure APIM in prod
                  │   JWT + Entra · CORS     │
                  └─┬─────────────────────┬──┘
        ┌───────────┘                     └───────────┐
        ▼                                             ▼
┌──────────────────────────┐               ┌──────────────────────────┐
│        .NET layer         │               │       Python layer        │
├──────────────────────────┤               ├──────────────────────────┤
│ SmartOps.Auth        7001│               │ jenny_ai             8001 │
│ SmartOps.Wells       7002│               │ predictive (Prophet) 8002 │
│ SmartOps.Finance     7003│               │ anomaly (IF + heal)  8003 │
│ SmartOps.Workflow    7004│               │ crew_optimizer (OR)  8004 │
│ SmartOps.Reports     7005│ ◄─ SignalR ──┤ vision (YOLOv8)      8005 │
│ SmartOps.Integrations7006│               │                           │
└──────────┬───────────────┘               └────────────┬──────────────┘
           │                                            │
           ▼                                            ▼
       Microsoft SQL Server     Redis (pub/sub +      TimescaleDB
       (per-service DB)         SignalR backplane)    (time-series)
                                                       │
                                                Sensor readings,
                                                progress snapshots
```

## Services at a glance

| Port | Project                    | Owns |
| ---: | -------------------------- | ---- |
| 7000 | SmartOps.Gateway (YARP)    | Single entry point. Validates JWT, routes by URL prefix. |
| 7001 | SmartOps.Auth              | Local JWT + Azure Entra SSO. Users, roles, audit log. |
| 7002 | SmartOps.Wells             | Wells, clusters, milestones, watchlist, critical dates. |
| 7003 | SmartOps.Finance           | EVM, P&L, job-cost, incentives, penalties, CMR Excel export. |
| 7004 | SmartOps.Workflow          | Flow designer, AI agents, agent runs, forms, catalogue, requests. |
| 7005 | SmartOps.Reports           | Reports, schedules, briefings, **SignalR alerts hub** with Redis backplane. |
| 7006 | SmartOps.Integrations      | SAP / Salesforce / ServiceNow connectors + sync jobs. |
| 7007 | SmartOps.ControlPlane      | Multi-tenant **control plane**: tenant registry, source/field-mapping adapters, canonical-model catalogue, feature flags, ingestion runs, audit. Own `smartops_control_plain` DB. |
| 8001 | jenny_ai (Python)          | LangChain assistant + Whisper transcribe / translate. |
| 8002 | predictive (Python)        | Prophet forecasts: completion date + daily rate. |
| 8003 | anomaly (Python)           | Isolation Forest anomaly detection + heal-suggest. |
| 8004 | crew_optimizer (Python)    | OR-Tools CP-SAT crew→activity assignment optimiser. |
| 8005 | vision (Python)            | YOLOv8 person/PPE detection from site camera frames. |

## TWise feature branches

Features built on top of `dev`, each on its own branch so it can be reviewed and merged
independently. Every branch below already contains the latest `dev`. API docs for each feature
live in `docs/api/<Feature>-UserGuide.md` (for consumers) and `<Feature>-Internal.md` (for the team).

| Branch | Feature | What it adds | SQL to run |
|---|---|---|---|
| `balu_ramesh_feature` | **Data sources** | Google Drive (multi-file, shared drives), Google Sheets, REST/JSON APIs (any HTTP method) imported as datasets, with refresh scheduling. | `add-data-source-connections.sql`, `add-refresh-scheduling.sql` |
| `balu_ramesh_feature` | **Visual Marketplace** | Install chart visuals at runtime from a built-in catalog or user-managed remote catalogs (authenticated catalogs supported); import Power BI `.pbiviz` metadata. | `add-marketplace-catalogs.sql`, `add-marketplace-plugins.sql`, `add-custom-visuals.sql` |
| `balu_ramesh_feature` | **Power BI embedding** | Embed workspace reports with short-lived view-only tokens; the service principal secret never reaches the browser. | `add-powerbi-connections.sql` |
| `balu_ramesh_feature` | **Chart Builder fixes** | Conditional filters pushed into SQL, filter values bound as text, empty-preview explanation, numeric-only Value columns, WCAG 2.1 AA fixes. | — |
| `balu-connectors` | **Database connectors** | MariaDB, Amazon Redshift, ClickHouse (HTTP) and Trino/Presto (REST) alongside SQL Server, PostgreSQL and MySQL. Oracle/SQLite deferred (driver packages). | `add-database-connection-providers.sql` |
| `balu-security` | **Security hardening** | Security headers on both APIs, HSTS, login rate limiting (10/min per IP) and account lockout, PBKDF2 600k with transparent rehash, password policy, login audit events. | — |
| `balu-extra-chart` | **Extra chart types** | Seven more marketplace visuals for chart-type parity: word cloud, packed bubble, item, variable-radius pie, sunburst, column pyramid, pareto. | regenerated `add-marketplace-plugins.sql` |
| `balu-governance` | **Data governance** | Data dictionary (business names, descriptions, owners, sensitivity, tags per column of every import and view) and a lineage graph from source → dataset → chart → dashboard/report. Data quality rules already existed. | `add-governance.sql` (tenant), `add-governance-permission.sql` (control plane) |
| `balu-login-perf` | **Login performance** | Login makes 5 database round trips instead of 10; effective permissions come from one joined query. | — |
| `balu_bug_fixes` | **Learn videos** | Learn videos served from `core.LearnVideos` with an admin page to manage links; small dashboard cards keep their chart visible. | `add-learn-videos.sql` |
| `AI-features` | **AI assistant** | Per-tenant LLM providers (OpenAI-compatible, one active), ask-your-data with streaming answers, chart from an answer, explain chart/dashboard, suggested filters, edit a chart by chat, chart recommendations, dashboard from a prompt, metrics library, dataset notes with automatic rule extraction, feature grants per role. | `add-ai-*.sql` in order: settings, providers, conversations, knowledge, feature-roles, note-proposals, metrics |

Run the listed scripts from `infra/sql` against every tenant database (they are idempotent);
new tenants get the same tables from the control plane's `init-tenant-schema.sql`.

## Quick start (local dev)

### Option A — Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

Spins up MSSQL 2022, TimescaleDB, Redis, and all 12 service processes.

### Option B — Native (no Docker, .NET + Python on host)

```powershell
cp .env.example .env
# Start everything in separate windows
./scripts/run_all.ps1
# Verify
python scripts/health_check.py
```

Open:

* Gateway:     <http://localhost:7000>
* Swagger UI:  <http://localhost:7000/swagger>
* Per-service Swagger: `http://localhost:700<N>/swagger` (.NET) or `:800<N>/docs` (Python)

Default users (seeded on first boot):

| Email                                | Password | Role     |
| ------------------------------------ | -------- | -------- |
| `admin@smartops.local`               | `admin`  | admin    |
| `khalid.albalushi@smartops.local`    | `password` | manager |
| `viewer@smartops.local`              | `password` | viewer  |

## URL convention

Every route through the gateway:

```
/api/v1/<service-key>/<route>
```

`<service-key>` is one of:
`auth · wells · finance · workflow · reports · integrations · controlplane · jenny · predictive · anomaly · crew-opt · vision`

Examples:

```
GET  /api/v1/wells/wells              → SmartOps.Wells
GET  /api/v1/finance/jobcost/summary  → SmartOps.Finance EVM summary
GET  /api/v1/controlplane/tenants     → SmartOps.ControlPlane tenant registry
POST /api/v1/predictive/forecast/rate → Prophet rate forecast
POST /api/v1/crew-opt/optimize        → OR-Tools assignment
WS   /api/v1/hubs/alerts              → SignalR live alerts hub
```

## Wiring the Angular SPA

Add this to `proxy.conf.json`:

```json
{
  "/api/v1": {
    "target": "http://localhost:7000",
    "secure": false, "changeOrigin": true
  },
  "/hubs":  {
    "target": "http://localhost:7000",
    "secure": false, "ws": true
  }
}
```

Login flow:

```ts
this.http.post('/api/v1/auth/login',
               { email: 'admin@smartops.local', password: 'admin' })
  .subscribe(({ accessToken }) => localStorage.setItem('token', accessToken));
```

Live alerts via SignalR:

```ts
import { HubConnectionBuilder } from '@microsoft/signalr';

const conn = new HubConnectionBuilder()
  .withUrl('/hubs/alerts', {
    accessTokenFactory: () => localStorage.getItem('token') ?? ''
  })
  .withAutomaticReconnect()
  .build();

conn.on('alert', (a) => console.log('new alert', a));
await conn.start();
await conn.invoke('SubscribeWell', '31780');
```

## Seed data — taken from the existing SPA

Each .NET service seeds itself from the real arrays in `src/assets/app-globals.js`:

| Service              | Source variable             | Rows |
| -------------------- | --------------------------- | ---- |
| SmartOps.Auth        | (synthetic) 3 users + 3 roles |   |
| SmartOps.Wells       | `CC_WELL_DATA`, `CC_CLUSTERS`, `MILESTONES` | 27 wells, 5 clusters, 19 milestones |
| SmartOps.Finance     | `JC_WELL_PL` + derived penalties/incentives | 6 P&L rows |
| SmartOps.Workflow    | 2 flows, 3 connections, 2 agents, 2 forms, 4 catalogue items |   |
| SmartOps.Reports     | 3 reports, 2 schedules, 2 briefings, 3 alerts |   |
| SmartOps.Integrations | 3 endpoints (SAP / Salesforce / ServiceNow) |   |

## Cloud deployment — Azure

The `infra/azure/main.bicep` template provisions the full SmartOps platform on
Azure:

* **Azure Container Registry** — push images here
* **Azure Kubernetes Service (AKS)** — runs every service
* **Azure SQL** — managed MSSQL
* **Azure Cache for Redis** — SignalR backplane + alerts pub/sub
* **Azure Service Bus** — workflow & integrations messaging
* **Azure API Management (Consumption)** — production gateway in front of YARP
* **Azure Key Vault** — secrets

```bash
az group create -n smartops-rg -l westeurope
az deployment group create -g smartops-rg -f infra/azure/main.bicep \
   -p sqlAdminPassword='YourStrong!Pass1'
```

Then build + push images and apply k8s manifests:

```bash
az acr login -n smartopsacr
docker compose build && docker compose push   # pushes to ACR
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/configmap-shared.yaml
kubectl apply -f infra/k8s/redis.yaml
# Render the deployment template per service:
for svc in auth wells finance workflow reports integrations gateway \
           jenny predictive anomaly crew-optimizer vision; do
  port=$(grep -E "$svc.*:" infra/k8s/portmap.txt | cut -d: -f2)
  sed -e "s/{{NAME}}/$svc/g" -e "s|{{IMAGE}}|smartopsacr.azurecr.io/$svc:latest|g" \
      -e "s/{{PORT}}/$port/g" infra/k8s/deployment-template.yaml | kubectl apply -f -
done
kubectl apply -f infra/k8s/ingress.yaml
```

The APIM policy in [gateway/apim/policies.xml](gateway/apim/policies.xml) wires
Entra-ID JWT validation, CORS, and rate-limiting at the Azure edge.

## Project layout

```
smartops/
├── SmartOps.sln                       ← VS / dotnet build the whole solution
├── Directory.Build.props              ← shared .NET 8 settings
├── docker-compose.yml                 ← MSSQL + Timescale + Redis + 12 services
├── .env.example
│
├── gateway/                           ← YARP reverse proxy
│   ├── SmartOps.Gateway.csproj
│   ├── Program.cs · appsettings.json · Dockerfile
│   └── apim/policies.xml              ← Azure APIM template
│
├── shared/
│   ├── dotnet/SmartOps.Shared/        ← AddSmartOpsAuth, ExceptionMiddleware,
│   │   ├── Auth/                        AuditableEntity, JwtTokenService,
│   │   ├── Db/                          Serilog setup, …
│   │   ├── Errors/
│   │   ├── Middleware/
│   │   └── Telemetry/
│   └── python/smartops_shared/        ← FastAPI app factory + JWT verify
│
├── services/
│   ├── dotnet/
│   │   ├── SmartOps.Auth/             ← Identity + JWT + Entra ID
│   │   ├── SmartOps.Wells/            ← Wells / clusters / milestones
│   │   ├── SmartOps.Finance/          ← EVM / P&L / CMR Excel export
│   │   ├── SmartOps.Workflow/         ← Flow designer, AI agents
│   │   ├── SmartOps.Reports/          ← Reports + SignalR alerts hub
│   │   ├── SmartOps.Integrations/     ← SAP / Salesforce / ServiceNow
│   │   └── SmartOps.ControlPlane/     ← Multi-tenant control plane (:7007)
│   │
│   └── python/
│       ├── jenny_ai/                  ← LangChain + Whisper
│       ├── predictive/                ← Prophet forecasting
│       ├── anomaly/                   ← Isolation Forest + heal-suggest
│       ├── crew_optimizer/            ← OR-Tools CP-SAT
│       └── vision/                    ← YOLOv8 person/PPE detection
│
├── infra/
│   ├── k8s/                           ← AKS manifests
│   ├── sql/                           ← MSSQL + TimescaleDB init + control-plane (init-control-plane.sql, run-control-plane.ps1, controlplane.env)
│   └── azure/                         ← Bicep — APIM, AKS, SQL, Redis, KV
│
└── scripts/
    ├── run_all.ps1 / run_all.sh
    └── health_check.py
```

## Each .NET service — anatomy

```
SmartOps.X/
├── SmartOps.X.csproj                  ← project + NuGet refs
├── Program.cs                         ← composition root + EF Core + seed
├── appsettings.json                   ← JWT, ConnectionStrings, AzureAd
├── Properties/launchSettings.json
├── Dockerfile
├── Controllers/                       ← MVC controllers
├── Domain/
│   ├── Entities/                      ← EF Core entities, inherit AuditableEntity
│   └── Dtos/                          ← Request / response DTOs
├── Infrastructure/
│   ├── XDbContext.cs                  ← EF Core DbContext
│   └── XSeeder.cs                     ← real data from app-globals.js
└── Services/                          ← business logic
```

## Auth modes

`SmartOps.Shared.Auth.AddSmartOpsAuth` configures one of two modes:

* **Local JWT** — when `AzureAd:TenantId` is empty (dev default). Login at
  `/api/v1/auth/login` returns a JWT signed by `JwtSettings:SecretKey`.
* **Azure Entra ID** — when `AzureAd:TenantId` is set. Uses
  `Microsoft.Identity.Web` and trusts tokens minted by Entra. SmartOps.Auth
  still issues local profile/roles, but bearer validation accepts Entra tokens.

The APIM template in `gateway/apim/policies.xml` validates Entra tokens at the
edge in production, so internal services receive a pre-verified token.

## RBAC

Three baseline policies, configured in
`SmartOps.Shared.Auth.AuthExtensions.AddSmartOpsAuth`:

* `Admin` — admin role only
* `Manager` — admin + manager
* `Viewer` — admin + manager + viewer

Controllers/endpoints decorate with `[Authorize(Policy = "Manager")]` etc.

## Control Plane (multi-tenant platform)

SmartOps is multi-tenant: a single shared **control plane** database governs all
tenants, while each tenant's operational data lives in its own isolated data
plane. The control plane holds **no tenant business data** — only the metadata
that runs the platform. It is independent of the existing operational DB
(`AppMasterDB`).

**Database** — `smartops_control_plain` (its own database). 16 tables in the
`control` schema, in four groups:

* **Tenant registry** — `Region`, `SchemaVersion`, `Tenant`
* **Sources & canonical model** — `SourceSystem`, `TenantSource`, `CanonicalEntity`, `CanonicalField`, `FieldMapping` (the per-tenant adapter), `CapabilityProfile`
* **Access & features** — `AppUser`, `Role`, `UserTenantRole`, `Feature`, `TenantFeature`
* **Operations & audit** — `IngestionRun`, `AuditEvent`

Authoritative schema: [docs/smartops_control_plane (1).dbml](docs/smartops_control_plane%20(1).dbml).

### Create / update the control-plane database

The schema is owned by an idempotent SQL script (single source of truth — the
service never issues DDL). Connection details live in a dedicated, **gitignored**
config file, not in the SQL:

```powershell
cd infra/sql
cp controlplane.env.example controlplane.env   # then fill in server / db / user / password
./run-control-plane.ps1                         # creates DB + control schema + 16 tables + Phase-1 seed
```

`run-control-plane.ps1` reads `controlplane.env`, substitutes the DB name into
the `$(ControlPlaneDb)` variable, and runs `init-control-plane.sql` via the
built-in .NET SqlClient (no `sqlcmd` install required). It is re-runnable and
never references `AppMasterDB`.

### SmartOps.ControlPlane service (:7007)

`ControlPlaneDbContext` maps onto the **existing** `control.*` tables
(database-first — no EF migrations / `EnsureCreated`). It is bound to a separate
`ConnectionStrings:ControlPlane`, so the existing `Default` connection is
untouched. Full CRUD is exposed for all 16 tables.

Resources — `/api/v1/controlplane/<resource>` via the gateway, or `:7007/<resource>` direct:

`regions · schema-versions · tenants · source-systems · tenant-sources · canonical-entities · canonical-fields · field-mappings · capability-profiles · users · roles · user-tenant-roles · features · tenant-features · ingestion-runs · audit-events`

Each supports `GET /<resource>`, `GET /<resource>/{id}`, `POST`, `PUT /{id}`,
`DELETE /{id}`. All endpoints require the `Admin` policy.

### Run & test

```powershell
dotnet run --project services/dotnet/SmartOps.ControlPlane/SmartOps.ControlPlane.csproj
```

* **Swagger:** <http://localhost:7007/swagger> — has an **Authorize** button (paste a raw JWT).
* In **Development** the `Admin` policy is relaxed, so Swagger **Try it out** works
  without a token. In Docker / Production the `Admin` JWT is enforced automatically.

## Removing the legacy backends

This restructure does **not** delete `backend/` (Jenny voice API) or
`backend_py/` (earlier Python-only scaffold). Once you've verified SmartOps
boots, remove them:

```bash
rm -rf backend backend_py
```

The voice transcribe + databricks proxy from `backend/main.py` has been
ported into `services/python/jenny_ai/app/main.py`.
