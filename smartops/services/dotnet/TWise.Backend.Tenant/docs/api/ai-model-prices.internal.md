# AI model prices — internal

* Table `core.AiModelPrices` (`AiModelPrice`: tenant_id, model, model_class, input_per_1m, output_per_1m decimal(18,6),
  updated_by/at; unique tenant + model). SQL in `infra/sql/add-ai-agents.sql`.
* `Features/Ai/ModelPrices/ModelPrices.cs`: `GetAiModelPricesQuery` (catalog + the active provider's model / fast
  model via `IAiProviderRepository.GetActiveAsync`), `SaveAiModelPricesCommand` (replace in one transaction:
  `ReplacePricesAsync` deletes and inserts), validator (classes, 0–10,000, unique names, ≤ 100).
* `AiController`: GET is open to any signed-in user of the tenant (the editor needs it); PUT goes through
  `AdminAsync`.
* Run usage: `AgentMapping.Usage(done)` adds the runtime's `done.usage` rows up per model; `TrackAsync` stores it in
  `core.AiAgentRuns.usage_json` and sends it with `done`; `AiAgentRunDto.Usage`.
* Estimates and cost are computed in the browser: `features/agentic-ai/analyzer/agent-analyzer.ts` (`analyzeAgent`,
  `costOfUsage`; specs next to it). Token profiles per tool are constants there (rough on purpose).
