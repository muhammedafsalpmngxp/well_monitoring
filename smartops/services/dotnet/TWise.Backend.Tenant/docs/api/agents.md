# AI Agents API

Build agents on **Agentic AI → AI Agents → Create New Agent**, test them and publish them. An agent has a
role, a goal and step-by-step instructions; each instruction runs through a **tool**, an agent of the
agent service (for example **DB Assistant · chat**, which answers questions from the well-project data).

All endpoints need a signed-in user of the tenant and the **AI Agents** permission (`agentic-ai.agents`):
view to read, create to add or test, modify to change, test or delete.

Base path: `/api/agents`

## The agent object

```json
{
  "name": "Active Wells Analyst",
  "role": "Drilling data analyst",
  "description": "Counts active wells and finds the most delayed ones",
  "systemPrompt": "Answer in two sentences.",
  "goal": "Report active well status for a cluster",
  "steps": [
    { "text": "How many wells are there in {{cluster}} cluster?" },
    { "text": "Which 5 wells in {{cluster}} have the most delayed tasks?" }
  ],
  "tools": [ { "agent": "db_assistant", "action": "chat" } ],
  "inputs": [ { "name": "cluster", "type": "string", "required": true, "description": "Cluster name" } ],
  "outputs": [],
  "status": "draft",
  "type": "sequential",
  "maxIterations": 5
}
```

| Field | Rules |
|---|---|
| `name` | required, up to 200 characters |
| `steps` | 1 to 20 instructions, each up to 2000 characters. `{{name}}` is replaced by the input with that name |
| `tools` | at least one; `agent` and `action` come from `GET /api/agents/tools` |
| `inputs` | names use letters, digits and `_`, unique |
| `status` | `draft` or `published` |
| `type` | how the instructions run: `sequential` (one after another, the default), `parallel` (all at once, then one combined answer), `supervisor` (the AI picks which instruction runs next until the goal is answered; each instruction runs exactly as written, and none runs twice once it succeeded), `loop` (repeat until the AI judges the goal met) |
| `askData.allowedSchemas` | narrows the schemas Ask Data may read; names outside the server's list (`ASKDATA_ALLOWED_SCHEMAS`) are ignored. Empty or null = the server's list |
| `maxIterations` | 1 to 20 (default 5): rounds for `supervisor` and `loop` |
| `steps[].id` | optional, up to 64 characters; needed by routers and links. `x` / `y` are the canvas position |

### Routers and step links (sequential and loop agents)

A step with `"kind": "router"` runs no tool: it picks **one** of its branches and goes to that branch's
`target` (a step `id`, or `"answer"`). Steps that no branch reaches do not run. A plain step's `next`
(a step `id` or `"answer"`) replaces "the following step", so branches can join again.

```json
"steps": [
  { "id": "a", "text": "Which wells in {{cluster}} are behind plan?" },
  { "id": "r", "kind": "router", "text": "How bad is it?", "routeBy": "rules", "branches": [
      { "id": "b1", "label": "Many", "input": "last_answer", "op": "contains", "value": "critical", "target": "c" },
      { "id": "b2", "label": "Otherwise", "op": "else", "target": "answer" } ] },
  { "id": "c", "text": "List the 5 most delayed tasks for those wells." }
]
```

| Field | Rules |
|---|---|
| `routeBy` | `rules` (default): branches are checked in order, the first match wins. `ai`: the tenant's AI provider picks the branch whose `label` fits best; with no active provider the `else` branch is taken and the `decision` event says why |
| `branches` | 1 to 10. `input` is an input name or `last_answer` (the previous step's answer) |
| `op` | `equals`, `not_equals`, `contains`, `not_contains`, `gt`, `gte`, `lt`, `lte`, `empty`, `not_empty`, or `else` (the fallback). Text compares ignore case; two numbers compare as numbers |
| `target` | a step `id`, `"answer"`, or null (= the answer). With no match and no `else`, the run goes to the answer |

Routers and links are refused for `parallel` and `supervisor` agents, targets must be existing step ids,
and links that go round in a circle are refused (on save and on test). **Saving** also refuses a step that no
path from the first step reaches, e.g. a router nothing links to: it would be saved but never run. A test may
still try such a half-built flow.

Responses add `id`, `createdBy`, `createdAt`, `updatedAt` and `stats` (`runs`, `successRate` %, `avgSeconds`, `lastRunAt`).

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/agents` | The tenant's agents, most recently changed first |
| GET | `/api/agents/{id}` | One agent (404 if it is not the tenant's) |
| GET | `/api/agents/tools` | `{ tools: [{ agent, title, description, capabilities, ready }], message }`. When the agent runtime is down, `tools` is empty and `message` says why; when only the twise agent service (port 8000) is down, `tools` holds Ask Data and `message` says the extra tools are offline |
| POST | `/api/agents` | Save a new agent. 201 with the agent |
| PUT | `/api/agents/{id}` | Replace an agent (Save as Draft / Publish on an existing agent) |
| DELETE | `/api/agents/{id}` | Delete. 204. Past runs stay in the run history |
| GET | `/api/agents/{id}/runs?take=50` | The agent's latest test runs |
| GET | `/api/agents/runs?take=50` | Latest test runs of all agents (at most 200); the Activity Log page shows these |
| POST | `/api/agents/test` | Run an agent and stream its progress (below) |
| POST | `/api/agents/agentflow` | Body: the agent object. Returns it as an `agentflow.json` v1 document; `llm_provider` names the tenant's active provider and model (never its key) |
| GET | `/api/agents/{id}/agentflow` | Download a saved agent as `agentflow.json` |
| POST | `/api/agents/askdata/export` | Body: `{ token, format: "xlsx" \| "docx", question, answer, verified, askData }`. The data behind an Ask Data answer as a file: every row, re-read with that answer's SQL, no AI call. `token` is the step's `export_token`; 400 when it is not valid, expired or no longer allowed |
| POST | `/api/agents/agentflow/import` | Body: an `agentflow.json` (LangGraph). Returns `{ agent, warnings }`: the agent to load on the page (not saved) and what could not be used |

Validation errors return 400 with the messages.

## Test an agent

`POST /api/agents/test` runs the agent exactly as sent, saved or not, so the page can test a draft.

```json
{ "agent": { ...the agent object... }, "inputs": { "cluster": "Nimr" }, "agentId": 12 }
```

`agentId` is optional and links the run to a saved agent (its stats). The response is a stream of
server-sent events:

| Event | Data |
|---|---|
| `step` | `{ step, phase: "start", question, agent, action }`, later `{ step, phase: "end", answer, sql: [...], ok, error, seconds }` |
| `status` | `{ step, stage }`, e.g. "Fetching your data" |
| `node` | `{ step, node }`, the part of the tool that is running |
| `decision` | supervisor `{ by: "supervisor", next, reason, round }`, loop `{ by: "loop", done, reason, round }`, router `{ by: "router", step, router, branch, next, reason }` |
| `done` | `{ runId, ok, answer, steps: [...], seconds }` |
| `error` | `{ message, runId? }`, e.g. a required input is empty, the agent service is not reachable, or Ask Data has no database configured |

A step that runs more than once (supervisor, loop) has `attempt` 1, 2, … in its `step` events.
An Ask Data step's `end` event also carries `route` (sql, clarify, chitchat), `verified`, `needs_analysis`,
`data` (columns and the rows shown), `chart` and `export_token` (for `POST /api/agents/askdata/export`).
A `ping` event arrives every 15 s while a step is still working; ignore it.
With one instruction the answer is the tool's answer. With several, the tenant's active AI provider
(AI Settings → AI Providers) writes one answer from all of them, in the agent's role and goal; if AI is
off, the step answers are shown one after another; a supervisor agent then runs its instructions once, in
order. Every run is saved. When the page closes mid-run, the runtime stops at the next event (no further
steps start) and the run is saved as stopped.

```bash
curl -N -X POST https://<tenant-api>/api/agents/test \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"agent":{"name":"Wells","steps":[{"text":"How many wells are there in {{cluster}} cluster?"}],"tools":[{"agent":"db_assistant","action":"chat"}],"inputs":[{"name":"cluster"}],"status":"draft"},"inputs":{"cluster":"Nimr"}}'
```
