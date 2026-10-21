# AI Agents: internal notes

## Pieces

```
New Agent page (Angular) ──► Tenant API /api/agents (CQRS) ──► core.AiAgents, core.AiAgentRuns
                                   │
                                   └─► Agent runtime :8006 (services/python/agent_runtime, FastAPI + LangGraph)
                                          GET  /api/agent-runtime/tools  ─► twise supervisor GET /api/agents
                                          POST /api/agent-runtime/run    ─► twise supervisor POST /api/supervisor/execute
                                                                             (one call per step, agent pinned)
```

* **Agents are data, created at runtime.** Saving writes a row; nothing is generated or deployed.
  Each run, `app/graph.py: build_graph()` compiles a LangGraph graph from the definition, wired by `type`:
  sequential `START → step_1 → … → answer`; parallel fan-out then `answer`; supervisor hub (`supervisor` node
  returns `{next, reason}` JSON); loop chain then `check` (returns `{done, reason}`), back to step 1 or `answer`.
* **Supervisor only orders the steps.** Every step runs its own instruction (with `{{inputs}}`), never a task
  the model rewrote: letting it reword "rig on date" into "rig on the specified date" turned 188 wells into 0.
  A worker that already succeeded is not picked again (that ends the run); with no AI provider the steps run
  once, in order, and the `decision` events say so.
* **Routers (sequential, loop):** a router node writes `route` in the state; a conditional edge goes there.
  Rules are evaluated in Python (`graph.matches`), never `eval`; `ai` asks the tenant provider for
  `{branch, reason}` (no provider: the `else` branch, with that reason). A plain step's `next` sets its edge.
  Pydantic (`AgentConfig._check_routing`) and the .NET validator (`RoutesAreValid`) reject routers in
  parallel / supervisor agents and targets that are not step ids. In a loop, "answer" means the round's end (`check`).
* **One walk, three places:** circles (`graph._check_no_cycle`, .NET `CircleAt`, UI `agent-steps.util.ts circleAt`)
  are refused on save and test; steps nothing reaches (.NET `NeverReached` in the Create/Update validators,
  UI `neverReached`) only on save. The Canvas links the last step into a router dropped after it.
* **agentflow.json:** `app/agentflow/convert.py` (`to_agentflow` / `from_agentflow`) maps an agent to the
  portable v1 format (LangGraph flavour, `app/agentflow/schema.py`, MIT). Routers become `routers[]`
  (conditions written as readable Python expressions); everything without an agentflow field (Ask Data
  knowledge, layout, routers' full rules) goes in `config.wellmonitoring`, so export → import is lossless.
  Imported foreign routers, interrupts, subgraphs and map-reduce are reported as warnings. The Tenant API adds
  `llm` (the active provider's name, model and base URL, never the key) so `llm_provider` names the real model.
  An import in the UI is always a new agent (it no longer overwrites the agent that was open).
* **Step node:** fills `{{input}}` placeholders, calls the step's tool (or the agent's first tool) through
  the twise supervisor with the earlier steps as `history`, and relays `status` / `node` events through
  LangGraph's custom stream (`get_stream_writer`).
* **Answer node:** one step → its answer. Several steps → the tenant's provider writes one answer
  (`langchain_openai.ChatOpenAI` against `{baseUrl}/chat/completions`, Bearer key or Azure `api-key`,
  same as `OpenAiCompatibleChatClient`). No provider → step answers joined.
* **Twise agents use their own model and key.** Only the answer node uses the tenant's provider; its
  tokens are logged as an `AiUsageLog` row with purpose `agent` and count toward the daily quota.

## Step fields and Ask AI

* `expected_output`, `output_key`, `model`, `temperature`, `max_tokens` on each step (`app/models.py`). Answers of
  steps with an output key go into the state's `outputs`, filled into later instructions like inputs.
* `ask_ai` runs in `graph._ask_ai` (one call, the provider copied with the step's settings). agentflow export
  puts the model settings in the agent's
  `llm_provider`, the key in `output_key` and the expected output in the task; import reads them back.

## Sticky notes

* `notes` is stored as JSON in `core.AiAgents.notes_json` (default `[]`; added by `add-ai-agents.sql`). `AgentMapping`
  copies it both ways, and version snapshots include it.
* The runtime ignores the field (pydantic drops unknown fields), so runs and agentflow export never see notes.
* Validation: at most 50 notes, `id` 1–64 characters, `text` up to 2000, `color` from `NoteColors`.

## Tools (REST calls)

* Stored as JSON in `core.AiAgents.custom_tools_json`; `AgentMapping.Apply` encrypts `AuthSecret` with
  `IAiKeyProtector` and keeps the stored one when the request's is empty. `ToDto` never returns it.
  `WithSecrets()` decrypts them for test runs and `tools/try` (`TryAgentToolQueryHandler`, which uses the saved
  agent's secret when `agentId` is given).
* Runtime: `app/api_tool.py` (`call`, `check_url`, `as_langchain_tool`, `run_step`) and `app/tool_loop.py`
  (`answer_with_tools`, a tool-calling loop on the tenant's model). Step tool `api:<name>` in `graph.py`;
  `POST /api/agent-runtime/tools/try` in `main.py`.
* `check_url` refuses non-https (except localhost) and hosts that resolve to private, loopback, link-local,
  reserved or multicast addresses; redirects are not followed. `AGENT_RUNTIME_ALLOW_PRIVATE_URLS=true` lifts the
  address check (local testing only). Responses are cut to 8000 characters.
* agentflow export writes each tool as a ToolSpec with a `rest` block (never the secret).
* UI: the canvas palette's Tool creates `tool_N`; its Properties panel edits the REST call and has Try it.

## Built-ins: URL Context, Memory, Exit Loop

* `app/builtins.py` (tool list in `TOOLS`, served with Ask Data / Ask AI by `GET /api/agent-runtime/tools`).
  `url_context` uses `api_tool.check_url` on every hop (redirects followed by hand, at most 3), 2 MB per page,
  visible text only, 6000 characters per page.
* Memory: `core.AiAgentMemories` (`AiAgentMemory`). `TestAiAgentStreamHandler` sends the saved agent's newest 200
  (`MemoryKeep`) as `memories` in the run request when a step uses `load_memory` / `preload_memory`; the graph
  adds a `remember` node after `answer` (one model call, at most 3 facts not already known), returned as
  `done.memories` and saved with the run id after a successful run. `load_memory` ranks by shared words (no
  embeddings). FK cascade on agent delete.
* `exit_loop` is its own node (`graph._exit_node`, `builtins.judge_goal`): conditional edge to `answer` when
  `exit` is set, else the next step. Refused outside loop agents (runtime and `SaveAiAgentRequestValidator`).
  Its results are left out of the history and the answer (`graph._work`).
* Usage rows `agent_runtime.*` are logged as the tenant's AI usage.

## Agent Catalog and structured output

* UI only: `features/agentic-ai/catalog/` — `agent-templates.ts` (the templates, our agent format, checked against the
  runtime's `AgentConfig` + `build_graph`), `agent-catalog.component` (page at `/agentic-ai/catalog`, permission
  `agentic-ai.agents`; picker mode in the editor's Start from template). The editor reads `?template=<id>` and
  `?duplicate=<agentId>` (copy without tool secrets). No endpoint.
* Structured output: `AgentConfig.outputs`; `graph._answer_node` adds `output` via `_fields` (one model call,
  `_typed` coerces); `main.run_events` puts it in `done`; `TestAiAgentStreamHandler` passes it through (not stored
  on the run).

## Sub-agents and For Each

* `TestAiAgentStreamHandler.SubAgentsAsync` walks `subagent` tools breadth first (`AgentMapping.SubAgentIds`), loads
  each agent (tenant + published), adds its tool secrets (`WithSecrets`) and sends the flat map as `subagents` in
  the run request; refuses unknown / unpublished agents, cycles (the path includes the saved agent's own id) and
  depth > `AgentMapping.MaxSubAgentDepth` (2). The Ask Data database is attached when any of them uses ask_data.
* Runtime `graph._subagent` builds the sub-agent's graph (`depth + 1`, same model and database) and streams its step
  starts as status. Sub-agents do not load or keep memories.
* For Each: `Step.for_each`; `graph._step_node.for_each` runs `run_one` per item on a thread pool
  (`MAX_PARALLEL` 5, `MAX_ITEMS` 20, `contextvars` copied); `_items` reads the list.

## Evals

* Tables `core.AiAgentEvalCases`, `core.AiAgentEvalRuns` (cascade on agent delete). `Features/Agents/Evals/`:
  CRUD handlers, `AgentEvals.Check` (rules), `RunAiAgentEvalHandler` (each case through `TestAiAgentStream` via
  MediatR, then rules, then `IAgentRuntimeClient.JudgeAsync` → runtime `POST /api/agent-runtime/eval/judge`, the
  tenant's model at temperature 0). The eval run stores the latest version number and whether the page was dirty.
* UI: `new-agent/agent-evals/` (the Test panel's Evals tab).

## Triggers

* `core.AiAgentSchedules` (`AiAgentSchedule`), handlers in `Features/Agents/Schedules/`, recurrence from the delivery
  feature (`Recurrence`: Cronos + IANA zone). `AgentScheduleWorker` (Infrastructure/Services) polls every
  `AgentSchedules:PollSeconds` (60), claims one due trigger at a time with `ClaimDueSchedulesAsync` (UPDLOCK +
  READPAST, next_run_at moved to a 30-minute lease) and calls `AgentScheduleRunner`.
* `AgentScheduleRunner` sends a `TestAiAgentStream` through MediatR (same validation, sub-agents, memory, usage and
  run record; user id `schedule`), sets last_* and the next run (none left = off), then mails the answer with
  `IMailSender` (failures logged, the run stays recorded).
* `AgentSchedules:Enabled` false turns the worker off.

## Human Approval

* Runtime: `graph._approval_node` calls LangGraph `interrupt()`; agents with an approval step compile with an
  `InMemorySaver`. `main._drive` checks `get_state().tasks[*].interrupts` after the stream: if waiting it keeps the
  compiled graph in `PENDING[token]` (token = the run's session id `agent-<tenant>-<guid>`; at most 200, 24 h) and
  yields `approval`. `POST /api/agent-runtime/resume` pops it and streams `Command(resume={decision, text, by})`.
  The node runs again from the top on resume, so it writes its events after `interrupt()`.
* .NET: `TestAiAgentStreamHandler` handles both `TestAiAgentStream` and `ResumeAiAgentRunStream`; `TrackAsync` records
  either (approval → status `waiting`, steps so far; resume adds its seconds and saves the same row via
  `GetRunAsync` + `SaveAsync`). `ResumeAiAgentRunStreamValidator` binds the token to the tenant (`agent-<tenantId>-`).
* Durable: the approval event carries the checkpoint values (`state`) and the paused node; `TrackAsync` stores them in
  `AiAgentRuns.resume_json` with the agent as sent (tool secrets removed), inputs, thread and token. Resume rebuilds
  the run context (`PrepareAsync`: secrets, model, sub-agents, memories) and sends it with the state; the runtime
  builds a fresh graph, applies `approval_update` with `update_state(as_node=<approval node>)` and streams on.
  resume_json is cleared when the run ends.
* Threads: `AiAgentRuns.thread_id`; `ListThreadAsync` (last 10 successful runs) → `AgentThreadTurn`s → runtime
  `RunRequest.thread`, put before each step's history.
* Loop-backs: routers are left out of `_check_no_cycle`; `_router_node` caps going back with `_runs` vs
  `max_iterations`. Retries: `_step_node.run_one` → `call_once` with 2/4/8 s waits.

## Evaluator, Guardrail, Compute, Merge

* `app/nodes.py` (`judge`, `violations`, `policy`, `arithmetic` — an AST walk allowing numbers and arithmetic only —
  `compute`, `merge`). Graph: `_evaluator_node` (conditional edge like a router, left out of the cycle check, back
  capped with `_runs`), `_guardrail_node` (sets `exit` / `rejected` like Exit Loop / approval), Compute and Merge run
  inside `_step_node`. `CONTROL` = checks left out of the final answer.
* Step `Options` is free JSON (≤ 4,000 chars) in steps_json; .NET validates compute mode, evaluator type and
  `retryFrom`, and the reserved step ids (`SaveAiAgentRequestValidator.ReservedIds`).

## Versions and AutoSave

* `core.AiAgentVersions` (`AiAgentVersion`): `snapshot_json` is the `SaveAiAgentRequest` JSON built with
  `AgentMapping.ToRequest(ToDto(agent))`, so secrets are already gone (`hasAuthSecret` only).
  `AgentVersioning.RecordAsync` runs after Create / Update save: it compares with the latest snapshot (no change =
  no version), numbers the next one, and `AddVersionAsync` deletes versions older than the newest
  `AgentVersioning.Keep` (50). FK `agent_id` → `AiAgents` with ON DELETE CASCADE.
* `UpdateAiAgentCommand` now carries `UserName` (the version's `created_by`).
* AutoSave is browser-only (`new-agent.component.ts`): every 2 s, while the page differs from what was loaded or
  saved, the request (tool secrets nulled) is kept in localStorage `twise.agent-autosave.<id|new>`. Opening the
  page offers Restore / Dismiss; Save and Discard clear it. Not saving to the server on purpose: an autosave
  would change a published agent that people run.

## Ask Data = the twise DB Assistant

`app/askdata` is the DB Assistant ported unchanged (graphs, nodes, access and
SQL checks). What it may read and its limits are the tenant's: allowed schemas, hidden tables and columns, rows per
query, query time limit, queries per question, SQL rewrites, answer re-checks, conversation turns, organisation name
and export file prefix live in `core.AiSettings` (`askdata_*` columns, edited in AI Settings > Ask Data & Features) and the
Tenant API sends them with every Ask Data run as `askDataSettings`. The runtime has no schema, table or column names
of its own: a tenant with no allowed schemas is refused ("not set up"). LLM timeout 120 s with 2 retries and the
per-node reasoning table are in `llm.py`. Prompts come only from the tenant database: the Tenant API
reads `core.AiPrompt` (history in `core.AiPromptHistory`, edited in AI Settings > AI Prompts) and
sends the `askdata.*` and `agent.*` texts with every request as `prompts`; the runtime has no built-in text
and refuses a run that lacks one. The step prompts (`graph.STEP_KEYS`: Ask AI, REST tool, URL Context, memory,
Evaluator, Guardrail, For Each, structured output, remembering, the evals judge) are read only by the step that
needs them; Exit Loop uses `agent.loop_check` with the step's own instruction. A new key goes in
`Resources/ai-prompts.seed.json` and `AiPromptCatalog`, plus a scenario in the runtime's `tests/prompt_scenarios.py`
(regenerate `tests/fixtures/prompt_baseline.json` with `tests/capture_prompt_baseline.py`). Export (`tools/export.py`, `export_formats.py`) signs the answer's SQL with
`ASKDATA_EXPORT_SECRET` (set it outside local development; without it links stop working on restart).
Differences on purpose: the executor also refuses anything but one SELECT and opens read-only connections;
the model is the tenant's AI provider (twise used its own OPENAI_MODEL / OPENAI_FAST_MODEL); an agent's
`allowedSchemas` can only narrow the tenant's allowed schemas and its `maxRows` only lower the tenant's
(`runner.settings_for`); `sys` and `INFORMATION_SCHEMA` are never readable.

**Which database:** Ask Data reads `AgentRuntime:AskDataConnection`, else `ConnectionStrings:AlTasnimBI`
(the Tenant API sends it with each run). The twise agents (DB Assistant, Data Anomaly, Well Slippage,
Daily Report on ports 8001-8004) read the database in twise-agentic's own `backend/.env` (`DB_*`, AlTasnimBI
on QA) with their own OpenAI key.

## Code

| Layer | Files |
|---|---|
| Domain | `Entities/AiAgent.cs` (AiAgent, AiAgentRun), `DTOs/AiAgentDtos.cs` |
| Application | `Features/Agents/{Get,Post,Put,Delete}`, `AgentMapping.cs`, `Abstractions/IAiAgentRepository.cs`, `Abstractions/Services/IAgentRuntimeClient.cs`, `IAiService.ResolveProviderAsync` |
| Infrastructure | `Repositories/AiAgentRepository.cs`, `Services/AgentRuntimeClient.cs`, `Persistence/Configurations/AiAgentConfigurations.cs` |
| API | `Controllers/AgentsController.cs` |
| Python | `services/python/agent_runtime/app/{main,graph,twise,models}.py`, tests in `tests/` |
| SQL | `infra/sql/add-ai-agents.sql` (idempotent; change the `USE` line per tenant DB; includes AiAgentVersions) |
| UI | `features/agentic-ai/agents.service.ts`, `agent-steps.util.ts` (+ spec), `new-agent/`, `ai-agents/` (Edit / Delete menu), `activity-log/` (`GET /api/agents/runs`) |

* `TestAiAgentStreamHandler` validates itself: MediatR's `ValidationBehavior` only wraps `IRequest`, not
  stream requests. It always saves the run (fresh token), success or failure.
* A `TaskCanceledException` or `HttpRequestException` from the runtime, an `InvalidOperationException`
  raised before the first event (no Ask Data connection string) and a `JsonException` (unreadable stream)
  become an `error` event and a failed run, not a 500.
* The runtime's `with_heartbeat` stops the run at its next event once the caller stops reading.
* Stats are computed per request from `AiAgentRuns` (count, success %, average seconds).

## Configuration

| Where | Key | Default | Meaning |
|---|---|---|---|
| Tenant API | `AgentRuntime:BaseUrl` | `http://localhost:8006` | the agent runtime |
| Tenant API | `AgentRuntime:ApiKey` | empty | sent as `X-API-Key`; must match the runtime's key |
| Runtime env | `AGENT_RUNTIME_API_KEY` | empty | required `X-API-Key` when set |
| Runtime env | `AGENT_RUNTIME_TWISE_URL` | empty | twise supervisor (e.g. `http://localhost:8000`); empty = its agents are not offered and never called |
| Runtime env | `AGENT_RUNTIME_TWISE_API_KEY` | empty | twise `X-API-Key` |
| Runtime env | `AGENT_RUNTIME_STEP_TIMEOUT` | `180` | seconds per step |
| Runtime env | `AGENT_RUNTIME_ALLOW_PRIVATE_URLS` | `false` | let Tools call private network addresses |

Set both keys outside local development: the runtime receives the tenant's decrypted AI key in the
request body, so it must only be reachable from the Tenant API.

## Run locally

```bash
cd smartops/services/python/agent_runtime
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m pytest -q                       # offline tests
.venv/Scripts/python -m uvicorn app.main:app --port 8006
```

Docker: the `agent-runtime` service in `smartops/docker-compose.yml`.

## Limits / next

* Triggers are not built: the page says so and saves nothing. Knowledge Source covers Ask Data only (RAG / MCP
  on the Canvas are "Coming soon").
* The Activity Log reads the latest 200 runs and filters them in the browser.
* On a PC with Windows Smart App Control on, newly built .NET DLLs can be blocked ("An Application Control
  policy has blocked this file"): the Tenant API and its tests then do not start.
* No per-step tool picker in the UI yet (the API accepts `steps[].tool`).
* Routers decide on inputs and the previous answer; they cannot read a named field out of a step's result.
* twise reads one database (`AlTasnimBI`) for every tenant.
