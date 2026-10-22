# Agentic AI release — database run order (UAT)

For the `dev-2.0` release: Agentic Features, AI Prompts, Ask Data settings, the agent builder (catalog, approvals,
schedules, evals, cost, notes) and the AI Settings menu.

| Database | UAT name |
|---|---|
| Tenant | `smartops_tenant_TNT-1000-new` (DBeaver "master" connection) |
| Control plane | the UAT control-plane database |

Every script below is idempotent: it creates or adds only what is missing, so running one that is already applied
does nothing.

> **Change the `USE` line first.** Steps 1–9 say `USE [smartops_tenant_TNT-1000]`, the **QA** name. A database with
> that name also exists on the UAT server, but the UAT app does not use it: run unchanged, a script changes the wrong
> database without any error. Change it to `USE [smartops_tenant_TNT-1000-new];`. Step 10 (`add-ai-agent-state.sql`)
> has no `USE` line: select `smartops_tenant_TNT-1000-new` in DBeaver before running it.

## 0. Before you start (read-only)

1. Back up the UAT tenant database.
2. Run `check-agentic-release.sql` on the tenant database (its `USE` line already points to UAT). Every
   `MISSING` row names the script to run. `ok` rows need nothing.
3. Run the control-plane query at the end of `check-agentic-release.sql` on the control-plane database.

## 1. Before deploying the new code: tenant database, in this order

| # | Script | Adds | Note |
|---|---|---|---|
| 1 | `add-ai-settings.sql` | `core.AiSettings`, `core.AiUsageLog` | Base for everything below |
| 2 | `add-ai-providers.sql` | `core.AiProviders` (+ `fast_model`, `daily_quota`) | If the old single-provider columns are still on `AiSettings`, it moves that provider here, then drops those columns |
| 3 | `add-ai-conversations.sql`, `add-ai-trace.sql`, `add-ai-feature-roles.sql`, `add-ai-knowledge.sql`, `add-ai-note-proposals.sql`, `add-ai-metrics.sql`, `add-ai-alerts.sql` | AI assistant tables | Only the ones the check reports MISSING (usually none on UAT) |
| 4 | `add-ai-prompts.sql` | `AiSettings.prompts_json` | Needed by step 5 to carry old custom prompts over |
| 5 | `add-ai-prompt-history.sql` | `core.AiPromptHistory`, `AiSettings.row_ver` | Prompt versions; needs steps 1 and 4 |
| 6 | `add-ai-prompt-table.sql` | `core.AiPrompt` | AI Prompts; copies any custom prompts from `prompts_json`; needs step 5 |
| 7 | `add-ai-askdata-settings.sql` | Ask Data settings on `AiSettings` | **Fills tenants with no settings yet** with the Al-Tasnim schemas and limits (correct for UAT) |
| 8 | `add-agentic-features.sql` | Agentic Features tables, `AiFeatureJob`, feature settings | Slippage, Daily Report, Data Anomaly |
| 9 | `add-ai-agents.sql` | Agent builder tables and columns | Agents, runs (usage, tokens, threads, approvals), versions, memories, schedules, evals, model prices, notes |
| 10 | `add-ai-agent-state.sql` | `AiAgents.agent_state` | Active / inactive agents; after step 9 |

## 2. Control-plane database

| # | Script | Adds |
|---|---|---|
| 11 | `add-agentic-features-permission.sql` | Modules `agentic-ai.features`, `.slippage`, `.daily-report`, `.data-anomaly`, `.crew-management` and their role permissions |

Users see the new menu items after their next login.

## 3. Deploy

Deploy the Tenant API, the agent runtime and the frontend **together**. The Tenant API sends the new prompt keys to the
runtime, and an older Tenant API would make the new runtime stop agent steps with "prompt not configured".
New prompt keys are copied into `core.AiPrompt` automatically the first time a tenant needs them, so no script is needed for them.

## 4. After the deploy

| # | Script / action | Note |
|---|---|---|
| 12 | `remove-ai-providers-soft-delete.sql` | **Only after the new Tenant API runs**: deletes providers that were only marked deleted, then drops `AiProviders.is_deleted`. An older Tenant API fails on AI Providers once the column is gone |
| 13 | AI Settings → Ask Data & Features: hide `well.well_status` | Same as QA (21 Oct): the table is not linked to any well |
| 14 | AI Settings → AI Prompts → Ask Data business rules, section 8: add "in progress ⇔ `eng_completion_date IS NULL`; never use `well.well_status`" | Same as QA; saved as a new version |
| 15 | Run `check-agentic-release.sql` again | Every row `ok`, including the last one |

## 5. Smoke test (UAT)

1. Log in. The sidebar shows **AI Settings** (Providers, Features, Ask Data & Features, AI Prompts, Activity, Relationships) and **Agentic AI → Agentic Features**.
2. Agentic AI → AI Agents: the list loads (no "Could not load the agents").
3. Agent Catalog: open a template, Save as Draft, reload. It comes back.
4. Ask AI: "how many wells are in progress" twice. Same number both times.
5. AI Settings → AI Providers: open the provider list (no error after step 12).
