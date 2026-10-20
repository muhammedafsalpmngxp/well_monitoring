# Agentic Features (agent runtime)

Three AI features run here, next to Ask Data. The Tenant API calls them; the Angular app shows them under
**Agentic AI > Agentic Features**:

| Feature | Package | Prompt-key prefix | What it does |
|---|---|---|---|
| Slippage | `app/features/slippage` | `slippage.` | Wells that missed contractual milestones, task delay per well, crew availability, and an AI recovery advisor (well and task level). |
| Daily Report | `app/features/dailyreport` | `dailyreport.` | Daily morning brief for a report date: per-well task validation, milestones, AI briefs (day / well / task) with a number-checking verifier, "ask the agent", Excel export. |
| Data Anomaly | `app/features/anomaly` | `anomaly.` | Plain-English data-quality rules compiled by AI into verified SQL probes, scored runs with an AI summary and Word / Excel reports, and AI-proposed new rules (Discover). |

## The rule: the runtime keeps nothing of a tenant's

Every request carries everything (`app/features/common/models.py` `FeatureRequest`):

| Field | From the Tenant API | Notes |
|---|---|---|
| `db` | the Ask Data database connection | never logged |
| `llm` | the tenant's active AI provider (null = none) | `common/llm.py` |
| `prompts` | `{key: text}`: every prompt of the feature, from `core.AiPrompt` (Settings > AI Prompts) | no prompt text in code; a missing key fails with `PromptMissing` naming it |
| `settings` | the feature's settings, all keys always present (Settings > AI Settings > the feature) | no limits / thresholds / domain values in code |
| `access` | tables the feature may read (`FeatureAccess`) | every statement is checked (`common/access.py`) |
| `queries` | `{key: FeatureQuery}`: the feature's verified SQL (`core.AiFeatureQuery`) | Slippage and Daily Report; no SQL in code |

Engine code (graphs, nodes, deterministic checks, scoring, report layout) stays in Python. What is *data* (prompt
texts, SQL, table names, thresholds, limits, vocabularies the tenant may tune) arrives with the request.

## Building blocks (`app/features/common`)

- `context.py`: `FeatureRun` + `run_context(run)` / `current()`. Set the context **inside** the generator or function
  that does the work. Thread pools must copy it: `pool.submit(contextvars.copy_context().run, fn, *args)`.
- `db.py`: `query(sql, params, feature_title=..., max_rows=..., timeout=...)` runs one guarded SELECT
  (SELECT-only gate + table allowlist) on a read-only connection; `connect(...)` / `connection(...)` for several
  statements (call `guard(sql, title)` yourself); `jsonable` / `jsonable_rows` for JSON-safe values.
- `access.py`: `referenced_tables(sql)`, `allowed(table, access)`, `check(sql, access, title)`.
- `llm.py`: `chat(system, user, agent=..., temperature=..., fast=..., max_tokens=..., json_mode=...)`; records usage
  in `current().usage` as `{"agent": "<prefix>.<agent>", "model", "calls", "input", "output"}`.
- `text.py`: `fill` / `fill_lines` (`{UPPER_CASE}` placeholders, single pass), `extract_json`, `extract_sql`,
  `extract_sql_blocks`, `strip_think`.
- `app/streaming.py`: `with_heartbeat`, `sse` for long runs.

## HTTP conventions

- Each feature exposes `router = APIRouter()` in `app/features/<feature>/api.py`; `app/main.py` mounts it at
  `/api/agent-runtime/features/<feature>` behind the runtime API key.
- Request bodies subclass `FeatureRequest` (camelCase JSON).
- Responses are JSON objects. When the model was called they include `"usage": [...]` (the Tenant API logs it).
- Long runs (Data Anomaly compile / run / discover) are server-sent events through `with_heartbeat`:
  `progress` `{stage, done, total, label}` (any number), then exactly one `result` or `error` `{message}`.
- Errors: refused SQL / table / bad input → 400 `{detail}`; database or AI provider unavailable → 503 `{detail}`.
  Messages are safe to show (no SQL text, no credentials, no stack traces).

## State

Stateless. Allowed: bounded in-process caches keyed by a content hash that includes the database identity, the SQL
or prompt text and the parameters (TTL and size from settings), and disk caches under
`app.askdata.settings.CACHE_ROOT / "features" / <feature>` keyed the same way. Nothing is written to the database.
