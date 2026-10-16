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
  returns `{next, task}` JSON); loop chain then `check` (returns `{done, reason}`), back to step 1 or `answer`.
* **Routers (sequential, loop):** a router node writes `route` in the state; a conditional edge goes there.
  Rules are evaluated in Python (`graph.matches`), never `eval`; `ai` asks the tenant provider for
  `{branch, reason}`. A plain step's `next` sets its edge; `_check_no_cycle` rejects circles at build time.
  Pydantic (`AgentConfig._check_routing`) and the .NET validator (`RoutesAreValid`) reject routers in
  parallel / supervisor agents and targets that are not step ids. In a loop, "answer" means the round's end (`check`).
* **agentflow.json:** `app/agentflow/convert.py` (`to_agentflow` / `from_agentflow`) maps an agent to the
  portable v1 format (LangGraph flavour, `app/agentflow/schema.py`, MIT). Routers become `routers[]`
  (conditions written as readable Python expressions); everything without an agentflow field (Ask Data
  knowledge, layout, routers' full rules) goes in `config.wellmonitoring`, so export → import is lossless.
  Imported foreign routers, interrupts, subgraphs and map-reduce are reported as warnings.
* **Step node:** fills `{{input}}` placeholders, calls the step's tool (or the agent's first tool) through
  the twise supervisor with the earlier steps as `history`, and relays `status` / `node` events through
  LangGraph's custom stream (`get_stream_writer`).
* **Answer node:** one step → its answer. Several steps → the tenant's provider writes one answer
  (`langchain_openai.ChatOpenAI` against `{baseUrl}/chat/completions`, Bearer key or Azure `api-key`,
  same as `OpenAiCompatibleChatClient`). No provider → step answers joined.
* **Twise agents use their own model and key.** Only the answer node uses the tenant's provider; its
  tokens are logged as an `AiUsageLog` row with purpose `agent` and count toward the daily quota.

## Ask Data = the twise DB Assistant

`app/askdata` is the DB Assistant ported unchanged (graphs, nodes, prompts, knowledge files, access and
SQL checks). It runs with twise's `backend/.env` values: MAX_ROWS 500, MAX_SQL_RETRIES 2, QUERY_TIMEOUT 60,
MAX_QUERIES 3, VERIFY_RETRIES 1, HISTORY_TURNS 3, ALLOWED_SCHEMAS well,project,ref,bridge,dbo, the 15
EXCLUDED_TABLES and EXCLUDED_COLUMNS (`settings.py`, env `ASKDATA_*` overrides), LLM timeout 120 s with 2
retries and the per-node reasoning table (`llm.py`). Prompts come from the files, or with
`ASKDATA_PROMPT_STORE=db` from `<ASKDATA_PROMPT_SCHEMA>.prompt` (default `twise.prompt`), as twise's
prompt_service. Export (`tools/export.py`, `export_formats.py`) signs the answer's SQL with
`ASKDATA_EXPORT_SECRET` (set it outside local development; without it links stop working on restart).
Differences on purpose: the executor also refuses anything but one SELECT and opens read-only connections;
the model is the tenant's AI provider (twise used its own OPENAI_MODEL / OPENAI_FAST_MODEL).

## Code

| Layer | Files |
|---|---|
| Domain | `Entities/AiAgent.cs` (AiAgent, AiAgentRun), `DTOs/AiAgentDtos.cs` |
| Application | `Features/Agents/{Get,Post,Put,Delete}`, `AgentMapping.cs`, `Abstractions/IAiAgentRepository.cs`, `Abstractions/Services/IAgentRuntimeClient.cs`, `IAiService.ResolveProviderAsync` |
| Infrastructure | `Repositories/AiAgentRepository.cs`, `Services/AgentRuntimeClient.cs`, `Persistence/Configurations/AiAgentConfigurations.cs` |
| API | `Controllers/AgentsController.cs` |
| Python | `services/python/agent_runtime/app/{main,graph,twise,models}.py`, tests in `tests/` |
| SQL | `infra/sql/add-ai-agents.sql` (idempotent; change the `USE` line per tenant DB) |
| UI | `features/agentic-ai/agents.service.ts`, `new-agent/`, `ai-agents/` |

* `TestAiAgentStreamHandler` validates itself: MediatR's `ValidationBehavior` only wraps `IRequest`, not
  stream requests. It always saves the run (fresh token), success or failure.
* A `TaskCanceledException` or `HttpRequestException` from the runtime becomes an `error` event and a
  failed run, not a 500.
* Stats are computed per request from `AiAgentRuns` (count, success %, average seconds).

## Configuration

| Where | Key | Default | Meaning |
|---|---|---|---|
| Tenant API | `AgentRuntime:BaseUrl` | `http://localhost:8006` | the agent runtime |
| Tenant API | `AgentRuntime:ApiKey` | empty | sent as `X-API-Key`; must match the runtime's key |
| Runtime env | `AGENT_RUNTIME_API_KEY` | empty | required `X-API-Key` when set |
| Runtime env | `AGENT_RUNTIME_TWISE_URL` | `http://localhost:8000` | twise supervisor |
| Runtime env | `AGENT_RUNTIME_TWISE_API_KEY` | empty | twise `X-API-Key` |
| Runtime env | `AGENT_RUNTIME_STEP_TIMEOUT` | `180` | seconds per step |

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

* Knowledge Sources and Triggers are on the page but not saved yet.
* No per-step tool picker in the UI yet (the API accepts `steps[].tool`).
* Routers decide on inputs and the previous answer; they cannot read a named field out of a step's result.
* twise reads one database (`AlTasnimBI`) for every tenant.
