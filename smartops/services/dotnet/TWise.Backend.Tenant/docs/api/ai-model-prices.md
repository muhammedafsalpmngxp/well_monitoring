# AI model prices

The price of each AI model the tenant uses, so the agent editor can estimate what an agent costs and show what
each run cost. Prices change often, so none are built in: an admin enters them under
**Settings → AI Providers → Model prices**.

## Endpoints

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/ai/model-prices` | any signed-in user | `{ activeModel, fastModel, prices: [{ model, modelClass, inputPer1M, outputPer1M }] }` |
| PUT | `/api/ai/model-prices` | admins | Body: the full list. The catalog becomes exactly these rows; returns the same shape as GET |

| Field | Rules |
|---|---|
| `model` | the model name as the provider calls it (e.g. `gpt-4o-mini`), up to 100 characters, each model once (any case) |
| `modelClass` | `frontier`, `standard` or `fast`: used for the "frontier-model share" and fast-model advice |
| `inputPer1M`, `outputPer1M` | USD per 1 million tokens, 0 to 10,000 |

`activeModel` / `fastModel` are the active provider's models (no key), the defaults the estimates use.

## Where the prices are used

* **Agent editor → Canvas → Analysis:** tokens and cost per run (expected and worst case), cost by model.
* **Test Agent:** after a run, its tokens and cost (from the run's real usage).
* Each agent run keeps its usage per model (`usage: [{ model, calls, input, output }]` on the runs endpoints).

A model without a price shows "no price"; its tokens are still counted.
