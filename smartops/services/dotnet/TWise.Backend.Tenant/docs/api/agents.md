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
| `askData.allowedSchemas` | narrows the schemas Ask Data may read; names outside the tenant's list (AI Settings → Ask Data & Features) are ignored. Empty or null = the tenant's list |
| `maxIterations` | 1 to 20 (default 5): rounds for `supervisor` and `loop` |
| `steps[].id` | optional, up to 64 characters; needed by routers and links. `x` / `y` are the canvas position |
| `notes` | optional, up to 50 canvas sticky notes: `{ id, text (up to 2000), x, y, color: yellow \| blue \| green \| pink }`. Editor only; runs and agentflow exports ignore them |

### Step fields (agentflow Agent / Task)

| Field | Rules |
|---|---|
| `expectedOutput` | optional, up to 2000 characters: what the step should return; given to the model that writes the answer |
| `outputKey` | optional, letters / digits / `_`, unique and not an input name: later instructions can use this step's answer as `{{outputKey}}` |
| `model`, `temperature` (0–2), `maxTokens` (1–32000) | optional, for steps whose tool is `ask_ai` (it runs on the tenant's AI provider). Ask Data and the agent-service tools use their own models |

Built-in tools besides Ask Data (all run on the tenant's AI provider; `model`, `temperature`, `maxTokens` apply):

| Tool (`agent` / `action`) | What the step does |
|---|---|
| `ask_ai` / `answer` | The model answers the instruction from the earlier results |
| `url_context` / `read` | Reads up to 3 `https://` addresses written in the instruction and answers from their text. Private network addresses are refused; redirects are checked the same way |
| `load_memory` / `search` | Answers with the agent's memories that match the instruction (up to 5) |
| `preload_memory` / `all` | Answers with all of the agent's memories |
| `exit_loop` / `check` | **Loop agents only.** The instruction is the stop condition: the model judges whether the results meet it; if so the loop ends at this step and the answer is written. Its check is not part of the answer |

| `subagent` / `<agent id>` | Runs another **published** agent of the tenant as this step. Its inputs take the run's values (inputs and output keys) with the same name; the first input left gets the instruction. Its answer is the step's answer; `substeps` lists its steps. Sub-agents can be nested 2 levels; an agent that reaches itself is refused |

| `approval` / `review` | **Human Approval** (Sequential and Loop agents). The run pauses: the test stream ends with an `approval` event `{ runId, token, step, question, draft, steps }` and the run is saved with status `waiting`. A person then approves, edits or rejects (below) |

**Human Approval** works in Sequential, Loop and Supervisor agents (not Parallel). `POST /api/agents/runs/{runId}/resume`
with `{ token, decision: "approve" | "edit" | "reject", text }`
continues the run and streams the rest like `/test`. `approve` keeps the draft, `edit` replaces it with `text` (later
steps get that version), `reject` ends the run with `text` as the reason. The reviewer is recorded on the step
(`verdict`, `reviewer`). 400-style `error` events when the token is not this tenant's, the decision is unknown, or the
run is not waiting. A paused run is kept with the run (no secrets) and can be resumed any time, also after restarts;
the model, tool secrets and sub-agents are read again when it resumes.

| `evaluator` / `check` | **Sequential and Loop agents.** The instruction is the criteria; the model checks the latest answer (or the one named with `{{key}}`). Fail → the run goes back to `options.retryFrom` (a step id; default the step before) with the reason, at most `maxIterations` times, then carries on |
| `guardrail` / `check` | Checks `options.check` = `answer` (default; or the one named with `{{key}}`) or `inputs`: personal data (`options.pii`, default on: e-mail, phone, card numbers), `options.blocked` (comma-separated words) and `options.policy` (AI). `options.action` = `block` (default: the run stops, the answer says why) or `warn`. The instruction describes the check |
| `compute` / `run` | No AI. `options.mode` = `template` (the instruction with `{{keys}}` filled), `math` (the instruction as arithmetic over the first number of each `{{key}}`: `+ - * / % **`, brackets) or `pick` (`options.source` key + `options.path`, e.g. `data.items[0].status`) |
| `merge` / `join` | No AI. Joins the answers of `options.keys` (comma-separated output keys; default every earlier step) under headings; the instruction is the first line |

When a sequential or loop agent **ends** with Compute or Merge, that step's answer is the final answer (no model
call to combine). Checks (Evaluator, Guardrail, Exit Loop) are shown with the steps but are not part of the final
answer. Step ids `start`, `answer`, `supervisor`, `check` and `remember` are reserved.

**For Each.** A step with `forEach` (an input name or another step's `outputKey`) runs once per item of that list,
with `{{item}}` filled in: a JSON array is used as it is, otherwise the AI model picks the items out of the text (or
it is split by lines / commas). Up to 20 items, 5 at a time; the answers are joined (`items` on the step result).

**Memory.** An agent that uses `load_memory` or `preload_memory` remembers: after each successful test run of
the saved agent the model keeps up to 3 new short facts (the newest 200 are kept). An unsaved draft has no memory.

### Tools (REST calls)

`customTools` (up to 20) are REST APIs the AI model may call. A step uses one with the tool
`{ "agent": "api", "action": "<name>" }`: the model fills the parameters, the call is made and the model answers
from the response.

```json
"customTools": [{ "name": "well_status", "description": "Live status of one well", "method": "GET",
  "url": "https://api.example.com/wells/{well}", "parameters": [{ "name": "well", "type": "str", "description": "Well name", "required": true }],
  "headers": [], "body": null, "responsePath": "data.status", "authScheme": "bearer", "authSecret": "token…", "timeout": 30 }]
```

| Field | Rules |
|---|---|
| `name` | letters, digits, `_`, up to 64; unique on the agent. The model calls the tool by it |
| `method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `url` | absolute `https` URL (`http` only for localhost). Private network addresses are refused |
| `parameters[]` | up to 20; `type` is `str`, `int`, `float`, `bool`, `list` or `dict`. `{name}` in the URL, header values or body is filled in; unused parameters go in the query string (GET / DELETE) |
| `body` | JSON template for POST / PUT / PATCH, e.g. `{"well": {well}}` |
| `responsePath` | optional: `data.items[0].status` picks part of a JSON response |
| `authScheme` | `none`, `bearer`, `basic` (`authSecret` is `user:password`) or `api_key` (sent as `X-Api-Key`) |
| `authSecret` | write-only: stored encrypted, never returned (`hasAuthSecret` says one is stored). Empty or null on an update keeps the stored secret |
| `timeout` | 1 to 120 seconds |

`POST /api/agents/tools/try` with `{ tool, args, agentId }` makes one call with sample values (no AI) and
returns `{ status, result }`. `agentId` lets an empty `authSecret` use the saved one.

### Retries and conversations

* `steps[].retries` (0–5): when the step's tool fails it is tried again, 2, 4 then 8 seconds later; the step result
  has `tries` when it needed more than one.
* `threadId` on `POST /api/agents/test` (letters, digits, `-`, up to 64) continues a conversation: the thread's last
  10 answered runs are given to every step as earlier turns. The run is recorded with its `threadId`.

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

Routers and links are refused for `parallel` and `supervisor` agents, and targets must be existing step ids.
A router branch may go **back** to an earlier step (draft ↔ review); a step that has already run `maxIterations`
times is not gone back to again: the run carries on with the step after the router. Plain step links (`next`)
that go round in a circle are refused (on save and on test). **Saving** also refuses a step that no path from the
first step reaches, e.g. a router nothing links to: it would be saved but never run. A test may still try such a
half-built flow.

### Saved SQL steps, the setup step and questions

A step whose tool is the built-in **Saved SQL** (`{ "agent": "sql_query", "action": "table" | "summary" }`) runs
the SELECT in its `sql` instead of asking a model to write one; its `text` is a short label.

```json
"steps": [
  { "text": "Resolve well {{well_id}}", "kind": "setup",
    "sql": "SELECT wm.well_id FROM well.well_master AS wm WHERE wm.well_id = TRY_CONVERT(int, {{well_id}})" },
  { "text": "Task delay detail for well {{well_id}}", "sql": "SELECT ... WHERE td.well_id = {{well_id}}" }
],
"tools": [ { "agent": "sql_query", "action": "table" } ],
"inputs": [ { "name": "question", "required": false }, { "name": "well_id", "type": "number", "required": false } ]
```

| Field | Rules |
|---|---|
| `steps[].sql` | Saved SQL steps only, up to 20,000 characters: exactly one read-only `SELECT` (or `WITH … SELECT`). `{{name}}` (or `'{{name}}'`) is sent as a parameter, never pasted in; an empty input is NULL. A placeholder inside a longer quoted text or a comment is refused: write `LIKE '%' + {{name}} + '%'`. It reads only what Ask Data may read (AI Settings → Ask Data & Features, narrowed by `askData.allowedSchemas`; no `SELECT *`) and runs in a transaction that is always rolled back |
| `action` | `table`: the rows are the step's answer, no AI call. `summary`: the AI provider writes the answer from the rows (one call) |
| `kind: "setup"` | step 1 only, Saved SQL only, at least one step after it, no link to or from it. It runs before every other step; its first row's columns named like inputs set those inputs (e.g. a blank date becomes the latest report date). No row stops the run with a message. The other steps keep their numbers (they start at 2) |
| input `question` | an input with this name lets people ask in their own words: one call on the provider's fast model fills the agent's **blank** other inputs from it (typed values win; a number input given a non-number is left blank). No call when nothing is blank. Mark the inputs a question can supply as optional |

Responses add `id`, `createdBy`, `createdAt`, `updatedAt` and `stats` (`runs`, `successRate` %, `avgSeconds`, `lastRunAt`).

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/agents` | The tenant's agents, most recently changed first |
| GET | `/api/agents/{id}` | One agent (404 if it is not the tenant's) |
| GET | `/api/agents/tools` | `{ tools: [{ agent, title, description, capabilities, ready }], message }`. When the agent runtime is down, `tools` is empty and `message` says why; when only the twise agent service (port 8000) is down, `tools` holds the built-in Ask Data and Saved SQL and `message` says the extra tools are offline |
| POST | `/api/agents` | Save a new agent. 201 with the agent |
| PUT | `/api/agents/{id}` | Replace an agent (Save as Draft / Publish on an existing agent) |
| PUT | `/api/agents/{id}/state` | **Admins only.** Body `{ "agentState": "active" \| "inactive" }`. Switches the agent on or off and returns it. Saving or publishing never changes the state; `POST /api/agents/test` with the `agentId` of an inactive agent is refused. Needs `add-ai-agent-state.sql` |
| DELETE | `/api/agents/{id}` | Delete. 204. Past runs stay in the run history |
| GET | `/api/agents/{id}/runs?take=50` | The agent's latest test runs |
| GET | `/api/agents/{id}/memories` | The agent's memories, newest first: `[{ id, text, runId, createdAt }]`. 404 if it is not the tenant's |
| DELETE | `/api/agents/{id}/memories` | Forget all of them. 204 |
| DELETE | `/api/agents/{id}/memories/{memoryId}` | Forget one. 204, or 404 when there is no such memory |
| GET | `/api/agents/{id}/versions` | The agent's saved versions, newest first: `[{ versionNo, status, createdBy, createdAt }]`. 404 if it is not the tenant's |
| GET | `/api/agents/{id}/versions/{versionNo}` | One version as the agent object (no `id`, no tool secrets), to load into the editor. 404 when it does not exist |
| GET | `/api/agents/runs?take=50` | Latest test runs of all agents (at most 200); the Activity Log page shows these |
| POST | `/api/agents/test` | Run an agent and stream its progress (below) |
| POST | `/api/agents/runs/{runId}/resume` | Human Approval: approve / edit / reject a waiting run and stream the rest (above) |
| POST | `/api/agents/tools/try` | Call one Tool once with sample values: `{ status, result }` (above) |
| POST | `/api/agents/agentflow` | Body: the agent object. Returns it as an `agentflow.json` v1 document; `llm_provider` names the tenant's active provider and model (never its key) |
| GET | `/api/agents/{id}/agentflow` | Download a saved agent as `agentflow.json` |
| POST | `/api/agents/askdata/export` | Body: `{ token, format: "xlsx" \| "docx", question, answer, verified, askData }`. The data behind an Ask Data answer as a file: every row, re-read with that answer's SQL, no AI call. `token` is the step's `export_token`; 400 when it is not valid, expired or no longer allowed |
| POST | `/api/agents/agentflow/import` | Body: an `agentflow.json` (LangGraph). Returns `{ agent, warnings }`: the agent to load on the page (not saved) and what could not be used |

Validation errors return 400 with the messages.

## Analysis, tokens and cost

The editor's Canvas has an **Analysis** tab (computed in the browser from the agent on the page): counts, heuristic
scores (efficiency, reliability, complexity, LLM / human / frontier-model dependency), findings with what / why / fix,
token estimates per step and per run (expected and worst case: loops, loop-backs, For Each at 20 items, supervisor
rounds) by model class, cost from the model prices (see `ai-model-prices.md`) and an optional token budget. Runs return
their real usage per model: `done.usage` and `usage` on `GET /api/agents/{id}/runs`.

## Canvas editing

Canvas editing works in the browser only. No endpoint changes; the agent is saved with `PUT /api/agents/{id}` as usual.

- **Select several steps:** Shift+drag a box, or Ctrl+click steps. The "N steps selected" panel then offers duplicate, copy and delete.
- **Copy, duplicate and paste:** copies get new ids. Links between the copied steps point to the copies, and links to other steps stay as they were. Output keys get a new number (`title` → `title_2`, and a copy of `title_2` becomes `title_3`), and `{{key}}` in the copies is renamed to match.
- **Undo and redo:** up to 50 steps back. History starts again after a load or a save.
- **Shortcuts** (not active while typing in a field): Delete/Backspace to delete, Ctrl+D to duplicate, Ctrl+C to copy, Ctrl+V to paste, Ctrl+A to select all, Ctrl+Z to undo, Ctrl+Y or Ctrl+Shift+Z to redo, F to fit, +/- to zoom, A / Shift+A to add a step, Esc to clear the selection, Ctrl+K for the command palette, ? for help.
- **Sticky notes:** drag Sticky Note from the palette (Annotations) or press N. Drag a note by its bar; ● changes the colour and × deletes it. Notes are saved with the agent (`notes`), are part of undo and versions, and never run.
- **Loop-back links** show "back · up to N×", where N is the agent's max iterations.

## Evals (test cases)

Test cases check an agent before publishing or after a change. A case has a `name`, `inputs` (`{ name: value }`), and
what a good answer is: an `expectation` the tenant's AI model judges the answer against, and/or `rules`
(`{ op: "contains" | "not_contains" | "number", value }`; text checks ignore case, `number` looks for that number in
the answer). Up to 50 cases per agent, 10 rules per case.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/agents/{id}/evals` | `{ cases, runs }`: the test cases and the latest 20 eval runs (scores only) |
| POST | `/api/agents/{id}/evals/cases` | Add a case. 400 when it has no expectation and no rule, or the agent has 50 |
| PUT / DELETE | `/api/agents/{id}/evals/cases/{caseId}` | Change / delete a case |
| POST | `/api/agents/{id}/evals/run` | Body `{ agent, draft, caseIds }` (agent = the page's draft, null = the saved agent; draft = it has unsaved changes). Streams `case` (`phase: start`, then `end` with `passed`, `reasons`, `answer`, `runId`) and `done` (`evalRunId`, `passed`, `total`, `versionNo`, `draft`). At most 25 cases per run |
| GET | `/api/agents/{id}/evals/runs/{evalRunId}` | One eval run with every case's result |

A case passes when the run answers, every rule holds and the judge agrees. A case that pauses at Human Approval
fails (a test cannot approve; the paused run stays waiting). Each case is recorded as a run by "Eval · <user>".

## Triggers (schedules)

A trigger runs the **published** agent on a schedule with fixed inputs, records the run like a test run (run by
"Schedule · <creator>") and can mail the answer.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/agents/{id}/schedules` | The agent's triggers: `[{ id, cron, runOnceAt, timeZone, inputs, emailTo, isActive, nextRunAt, lastRunAt, lastRunId, lastStatus, createdBy, nextRuns }]` (`nextRuns`: the next five, UTC) |
| POST | `/api/agents/{id}/schedules` | Add one. Body `{ cron, runOnceAt, timeZone, inputs, emailTo, isActive }` |
| PUT | `/api/agents/{id}/schedules/{scheduleId}` | Change one (same body) |
| DELETE | `/api/agents/{id}/schedules/{scheduleId}` | Delete. 204 |
| POST | `/api/agents/{id}/schedules/{scheduleId}/run` | Make an active trigger due now: it runs within a minute. 202 |
| POST | `/api/agents/schedules/preview` | Body `{ cron, runOnceAt, timeZone }` → `{ problem, next }` |

| Field | Rules |
|---|---|
| `cron` | five fields (minute hour day month weekday), read in `timeZone`; null = once at `runOnceAt` (UTC) |
| `timeZone` | an IANA name, e.g. `Asia/Muscat` |
| `inputs` | `{ name: value }`; every required input of the agent must have a value |
| `emailTo` | up to 10 addresses; the answer is mailed after each run (needs the Mail settings) |

400 `{ message }` when an active trigger's agent is not published, has a Human Approval step (no one would be there
to approve) or misses an input. A once-trigger turns itself off after its run. Deleting the agent deletes its triggers.

## Structured output

When the agent lists `outputs` (`name`, `type`: `string`, `number`, `boolean`, `array` or `object`, `description`),
the run also returns the answer as those typed fields in `done.output`, filled by the AI model from the answer
(a field the answer does not give is `null`). The answer text is unchanged. It costs one extra model call per run.

## Versions

Every Save as Draft or Publish (POST or PUT) that changes the agent adds a version: `versionNo` counts up per
agent, `status` is the status it was saved with, `createdBy` the user who saved. Saving without a change adds
none. The newest 50 are kept; deleting the agent deletes its versions.

Restoring is done by the page: it loads a version into the editor, and Save as Draft or Publish makes it the
agent again (as a new version). Versions never hold tool secrets: on that save, an empty secret keeps the one
stored now for the tool with the same name.

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
| `decision` | approval `{ by: "approval", step, decision, reviewer, reason }`, exit loop `{ by: "exit_loop", done, reason, step }`, supervisor `{ by: "supervisor", next, task, round }`, loop `{ by: "loop", done, reason, round }`, router `{ by: "router", step, router, branch, next, reason }` |
| `inputs` | `{ by: "question" \| "setup", values: { name: value }, note }`: what the question or the setup step set (the page shows it as "Understood as") |
| `done` | `{ runId, ok, answer, steps: [...], seconds, output, usage, llm }`. `output` (only when the agent has `outputs`): the structured answer, one typed field per output. `usage`: tokens per model; `llm`: the run's calls and tokens on the tenant's provider |
| `error` | `{ message, runId? }`, e.g. a required input is empty, the agent service is not reachable, or Ask Data has no database configured |

A step that runs more than once (supervisor, loop) has `attempt` 1, 2, … in its `step` events.
An Ask Data step's `end` event also carries `route` (sql, clarify, chitchat), `verified`, `needs_analysis`,
`data` (columns and the rows shown), `chart` and `export_token` (for `POST /api/agents/askdata/export`).
A Saved SQL step's `end` event carries `data` (columns and rows, up to the row limit) and its SQL; the setup step's
events also carry `setup: true`.
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
