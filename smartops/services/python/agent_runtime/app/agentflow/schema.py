# Copied unchanged from the AgenticUIFramework (multi-agent-generator/multi_agent_generator/schema.py, MIT)
# so agents export to / import from agentflow.json v1 with the framework's own validation.
# multi_agent_generator/schema.py
"""
Portable workflow schema (`agentflow.json` v1).

Wraps mag's per-framework config dict in a typed, versioned envelope so the
artifact round-trips cleanly through the CLI and survives between invocations.

Round-trip example:

    flow = AgentFlow.from_legacy("adk", config_dict, with_tracing=True)
    flow.save("team.agentflow.json")
    same = AgentFlow.load("team.agentflow.json")
    assert same.to_legacy_config() == config_dict

Generators continue to accept Dict[str, Any]. The schema is a typed envelope
on top — `to_legacy_config()` produces the bare dict generators expect.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ---- Reusable atoms ---------------------------------------------------------

class CallbackSpec(BaseModel):
    """One ADK lifecycle callback (crash-course example 9-callbacks).

    `body` is the free-form Python body emitted into a top-level
    `def {name}(...):`. The signature is fixed per callback kind — see
    `_callback_signature()` in `frameworks/adk_generator.py` for the exact
    param/return shape per kind.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    body: str = ""


class CallbacksSpec(BaseModel):
    """All six ADK lifecycle callback hooks an LlmAgent can carry.

    Each is at most one callback — ADK's API takes a single callable per hook,
    not a list. Mirrors crash-course example 9-callbacks
    (3 sub-examples: agent / model / tool).
    """

    model_config = ConfigDict(extra="allow")

    before_agent: Optional[CallbackSpec] = None
    after_agent: Optional[CallbackSpec] = None
    before_model: Optional[CallbackSpec] = None
    after_model: Optional[CallbackSpec] = None
    before_tool: Optional[CallbackSpec] = None
    after_tool: Optional[CallbackSpec] = None


class LlmProviderSpec(BaseModel):
    """Where the model lives and how to talk to it.

    One spec covers every backend mag can target, including a self-hosted
    vLLM server (which speaks the OpenAI wire protocol):

        LlmProviderSpec(provider="vllm", model="Qwen/Qwen2.5-7B-Instruct",
                        base_url="http://localhost:8000/v1",
                        api_key_env="OPENAI_API_KEY")

    Declared once on the framework config (`llm_provider`) and optionally
    overridden per agent (`AgentSpec.llm_provider`). Generators resolve the
    effective spec per agent via `resolve_llm_provider()`.

    `base_url`/`api_key_env` are emitted as `os.getenv(...)` lookups in the
    generated code — never the literal secret.
    """

    model_config = ConfigDict(extra="allow")

    # "openai"      -> api.openai.com (or whatever base_url says)
    # "vllm"        -> OpenAI-compatible self-hosted server; base_url required
    # "azure-openai"-> Azure deployment; base_url = endpoint, model = deployment
    # "gemini"      -> Google AI Studio / Vertex
    # "anthropic"   -> Anthropic API
    # "litellm"     -> route through LiteLLM's provider bridge
    # "ollama"      -> local Ollama's OpenAI-compatible endpoint
    provider: Literal[
        "openai", "vllm", "azure-openai", "gemini", "anthropic", "litellm", "ollama"
    ] = "openai"
    # Model / deployment identifier passed to the client verbatim.
    model: str = "gpt-4o-mini"
    # OpenAI-compatible base URL. Required for provider="vllm"; optional
    # elsewhere (None means "use the SDK default endpoint"). Emitted as a
    # runtime env lookup with this value as the fallback default.
    base_url: Optional[str] = None
    # Env var holding the API key. vLLM servers usually ignore the key but
    # the OpenAI client still requires a non-empty one — generated .env files
    # ship a dummy default for that case.
    api_key_env: str = "OPENAI_API_KEY"
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    # Extra HTTP headers (e.g. a gateway auth header) passed to the client.
    extra_headers: Dict[str, str] = Field(default_factory=dict)
    # Free-form kwargs forwarded to the underlying chat-client constructor.
    extra_body: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_base_url(self) -> "LlmProviderSpec":
        if self.provider == "vllm" and not self.base_url:
            raise ValueError(
                "provider='vllm' requires base_url (e.g. http://localhost:8000/v1)"
            )
        return self

    @property
    def is_openai_compatible(self) -> bool:
        """True when the OpenAI SDK/client can drive this provider directly."""
        return self.provider in ("openai", "vllm", "ollama", "azure-openai")


DEFAULT_LLM_PROVIDER = LlmProviderSpec()


def resolve_llm_provider(
    agent: Any,
    config_default: Optional[LlmProviderSpec] = None,
) -> LlmProviderSpec:
    """Effective provider for one agent: per-agent override > config default.

    Accepts agents as dicts (legacy config path) or AgentSpec instances. A
    bare `llm` string on the agent overrides only the model name, keeping the
    endpoint/credentials from the config-level spec — that's the common case
    where every agent hits the same vLLM server with a different model.
    """
    base = config_default or DEFAULT_LLM_PROVIDER
    raw = (
        agent.get("llm_provider") if isinstance(agent, dict)
        else getattr(agent, "llm_provider", None)
    )
    if raw is not None:
        spec = raw if isinstance(raw, LlmProviderSpec) else LlmProviderSpec.model_validate(raw)
        return spec
    llm = agent.get("llm") if isinstance(agent, dict) else getattr(agent, "llm", None)
    if llm:
        return base.model_copy(update={"model": llm})
    return base


class AgentSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    role: str = ""
    goal: str = ""
    backstory: str = ""
    # Optional override: when set, the generator uses this verbatim as the
    # agent's instruction= / system prompt instead of concatenating role/goal/
    # backstory + assigned-task descriptions.
    system_prompt: Optional[str] = None
    tools: List[str] = Field(default_factory=list)
    # Other agents (by name) exposed to this agent as `AgentTool(agent=...)`.
    # Wraps each named agent in an AgentTool and adds it to the LlmAgent's
    # `tools=[...]` list. Sample 05 (nested_agent). NOT the same as ADK's
    # `LlmAgent.sub_agents=` parameter — see `sub_agents` below.
    agent_tools: List[str] = Field(default_factory=list)
    # ADK's `LlmAgent.sub_agents=` parameter — LLM-driven delegation. The
    # model picks one of the listed sub-agents to delegate to, distinct from
    # calling them as a tool. Crash-course example 7-multi-agent.
    sub_agents: List[str] = Field(default_factory=list)
    # Model wrapper choice. "gemini" (default) keeps the existing direct-string
    # path; "litellm" wraps `llm` in `LiteLlm(model=..., api_key=os.getenv(api_key_env))`
    # so non-Gemini providers (OpenRouter, OpenAI, Anthropic, etc.) work via the
    # LiteLLM bridge. Mirrors crash-course example 3-litellm-agent.
    model_provider: Optional[Literal["gemini", "litellm"]] = None
    # Env var that holds the API key for the LiteLlm wrapper — passed to
    # os.getenv() at runtime. Ignored when model_provider != "litellm".
    api_key_env: Optional[str] = None
    # Per-agent endpoint/model override. Wins over the framework config's
    # `llm_provider`; see `resolve_llm_provider()`.
    llm_provider: Optional[LlmProviderSpec] = None
    # Name of a Pydantic output schema defined in ADKConfig.output_schemas.
    # When set, the generator emits `output_schema=<ClassName>` on the LlmAgent.
    # ADK requires output_schema agents to have NO tools — the runtime errors
    # otherwise. Mirrors crash-course example 4-structured-outputs.
    output_schema: Optional[str] = None
    # ADK lifecycle callbacks (crash-course example 9-callbacks).
    callbacks: Optional[CallbacksSpec] = None
    verbose: bool = True
    allow_delegation: bool = False
    llm: Optional[str] = None  # langgraph / react use this
    output_key: Optional[str] = None
    # When true, codegen emits `code_executor=BuiltInCodeExecutor()` on the
    # LlmAgent. ADK forbids combining this with tools — the UI validator
    # catches that pre-Generate.
    code_executor: Optional[bool] = None  # ADK: stash final response in session state under this key


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    description: str
    tools: List[str] = Field(default_factory=list)
    agent: Optional[str] = None
    expected_output: str = ""


class NodeSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    description: str
    agent: str


class EdgeSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str
    target: str
    condition: Optional[str] = None


class ToolParameterSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    # `tool_context` is an ADK-only marker — when used, the generator emits the
    # parameter as `tool_context: ToolContext` and adds the import. It is
    # intentionally NOT permitted as a `return_type`.
    type: Literal[
        "str", "int", "float", "bool", "list", "dict", "tool_context"
    ] = "str"
    description: str = ""


class OutputSchemaFieldSpec(BaseModel):
    """One field on a Pydantic output schema (sample 4-structured-outputs).

    Maps to: `name: type = Field(description="...")`. Field defaults are not
    modelled — every field is required, matching the sample.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    type: Literal["str", "int", "float", "bool", "list", "dict"] = "str"
    description: str = ""


class OutputSchemaSpec(BaseModel):
    """A Pydantic BaseModel definition an agent can reference via
    `output_schema: <name>`. Generates `class <name>(BaseModel): ...`
    in the rendered Python. Mirrors crash-course example 4-structured-outputs.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    fields: List[OutputSchemaFieldSpec] = Field(default_factory=list)


class ToolSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    parameters: List[ToolParameterSpec] = []
    return_type: Literal["str", "int", "float", "bool", "list", "dict"] = "str"
    implementation: str = ""
    # When set, this tool is treated as a built-in: the generator does NOT
    # emit a `def name(...)` block; instead it adds `from {import_from} import {name}`
    # and references the bare name in `tools=[...]`. Use for ADK built-ins like
    # `google_search` (`import_from="google.adk.tools"`). Mirrors crash-course
    # example 2-tool-agent.
    import_from: Optional[str] = None


# ---- RAG primitives (Tier 2 nodes) -----------------------------------------
# A vector store is rendered as a module-level singleton; a retriever becomes
# a tool function the agent can call.


class VectorStoreSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    backend: Literal["chroma"] = "chroma"
    collection: str = "kb"
    embedding_model: str = "default"
    # Optional inline corpus — one document per line. When non-empty the
    # generator seeds the collection on first init.
    initial_documents: str = ""


class RetrieverSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    # Name of the VectorStoreSpec this retriever queries. Resolved from the
    # canvas Retriever→VectorStore edge by the UI serializer.
    vector_store: str
    k: int = 3


class ConditionalSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    # Python boolean expression evaluated against `state = context.session.state`
    # at runtime. Truthy → true_agent, falsy → false_agent.
    expression: str = "False"
    true_label: str = "true"
    false_label: str = "false"
    # Names of two existing agents — empty string means "branch not wired"
    # (codegen will refuse to render the conditional in that case).
    true_agent: str = ""
    false_agent: str = ""


# ---- RAG ingestion (Tier 3) ------------------------------------------------
# Document loaders / text splitters / embedders. Codegen walks each
# VectorStore's upstream chain to emit a real load → split → store ingest
# block instead of using the legacy `initial_documents` field.


class DocumentLoaderSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    source_type: Literal["text", "web", "file", "pdf", "csv", "markdown"] = "text"
    source: str = ""
    # Resolved at serialize-time on the UI side from the canvas edges. Empty
    # string when unwired.
    target_splitter: str = ""
    target_vector_store: str = ""


class TextSplitterSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    strategy: Literal["recursive", "fixed", "header", "csv"] = "recursive"
    chunk_size: int = 800
    chunk_overlap: int = 100
    separator: str = " "
    target_vector_store: str = ""


class EmbedderSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    provider: Literal["default", "sentence-transformers", "openai"] = "default"
    model: str = "default"
    target_vector_store: str = ""


# ---- Vertex AI tools -------------------------------------------------------


class VertexSearchSpec(BaseModel):
    """Vertex AI Search tool — wraps a Vertex AI Search data store as an ADK
    tool. Codegen emits `<name> = VertexAiSearchTool(data_store_id="...")`
    at module scope and references the var in any wired agent's tools list.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    # Full Vertex AI Search resource ID — e.g.
    # projects/<PROJECT>/locations/<LOC>/collections/<COL>/dataStores/<ID>
    data_store_id: str


class VertexRagSpec(BaseModel):
    """Vertex AI RAG retrieval tool — queries a Vertex RAG corpus. Codegen
    emits a `<name> = VertexAiRagRetrieval(...)` call at module scope wrapping
    a `rag.RagResource(rag_corpus="...")` plus retrieval knobs.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    # Full Vertex RAG corpus resource ID — e.g.
    # projects/<PROJECT>/locations/<LOC>/ragCorpora/<ID>
    rag_corpus: str
    similarity_top_k: int = 10
    vector_distance_threshold: float = 0.6


# ---- MCP (Model Context Protocol) toolsets ---------------------------------


class McpEnvVarSpec(BaseModel):
    """One environment variable forwarded to a stdio MCP subprocess."""

    model_config = ConfigDict(extra="allow")

    key: str
    value: str = ""


class McpToolsetSpec(BaseModel):
    """An MCPToolset entry. Codegen emits

        <name> = MCPToolset(
            connection_params=<StdioServerParameters | SseServerParams>(...),
            tool_filter=[...],   # optional, only when non-empty
        )

    at module scope and references the var in any wired agent's tools list.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    # stdio = subprocess (StdioServerParameters); sse = remote endpoint.
    transport: Literal["stdio", "sse"] = "stdio"
    # stdio-only fields. command e.g. "npx", args e.g.
    # ["-y", "@modelcontextprotocol/server-filesystem", "/path"].
    command: str = ""
    args: List[str] = Field(default_factory=list)
    env: List[McpEnvVarSpec] = Field(default_factory=list)
    # sse-only field — remote MCP server URL.
    url: str = ""
    # When non-empty, restricts the exposed MCP tools to this allowlist.
    tool_filter: List[str] = Field(default_factory=list)


# ---- Per-framework configs (each carries its own `framework` discriminator) -

# ---- LangGraph-native primitives -------------------------------------------
# These have no ADK analogue; they exist so LangGraph flows can express the
# patterns LangGraph is actually known for rather than a translated ADK graph.

class StateChannelSpec(BaseModel):
    """One extra field on the graph's state `TypedDict`.

    `reducer` controls how concurrent writes merge — the thing that makes
    LangGraph state different from a plain dict:

      * "last"    -> plain field; last writer wins
      * "append"  -> `Annotated[list, operator.add]`; branches concatenate
      * "merge"   -> `Annotated[dict, lambda a, b: {**a, **b}]`

    "append" is what makes a fan-out safe: two parallel nodes writing the
    same channel would otherwise raise `InvalidUpdateError`.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    type: Literal["str", "int", "float", "bool", "list", "dict"] = "str"
    reducer: Literal["last", "append", "merge"] = "last"
    description: str = ""


class RouteSpec(BaseModel):
    """One branch of a conditional edge."""

    model_config = ConfigDict(extra="allow")

    # Python expression evaluated against `state`. Empty marks the fallback.
    condition: str = ""
    # Node to route to, or "END".
    target: str


class RouterSpec(BaseModel):
    """A conditional edge: `add_conditional_edges(source, <router fn>)`.

    The generator emits a router function that evaluates each route's
    condition in order and returns the first match, falling back to
    `default_target`. This is LangGraph's core branching primitive.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    source: str
    routes: List[RouteSpec] = Field(default_factory=list)
    default_target: str = "END"


class InterruptSpec(BaseModel):
    """Human-in-the-loop pause.

    "static" compiles the graph with `interrupt_before=[node]`, so execution
    halts before that node and resumes when the caller invokes the graph
    again with the same `thread_id`. "dynamic" emits a `interrupt()` call
    inside the node, which surfaces a payload for the human to answer.

    Both require a checkpointer — there is nowhere to resume from without
    one, so the generator forces `checkpointer="memory"` when interrupts
    are present.
    """

    model_config = ConfigDict(extra="allow")

    node: str
    kind: Literal["static", "dynamic"] = "static"
    # Prompt shown to the human when kind == "dynamic".
    message: str = "Approve this step?"
    # State key the human's answer is written to on resume.
    resume_key: str = "approval"


class MapReduceSpec(BaseModel):
    """Fan-out over a runtime-sized list via LangGraph's `Send` API.

    Unlike a static parallel fan-out, the number of branches is decided while
    the graph runs: the mapper reads `over` from state and emits one `Send`
    per item, each landing on `worker`. `reducer_node` then aggregates.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    # State channel holding the list to fan out over.
    over: str
    # Agent invoked once per item.
    worker: str
    # State channel each worker appends its result to (needs an "append"
    # reducer, or concurrent writes collide).
    collect_into: str = "results"
    # Agent that runs after all branches finish.
    reducer_node: str = ""


class SubgraphSpec(BaseModel):
    """A nested graph compiled and added as a single node.

    Subgraphs are how LangGraph composes teams: the parent sees one node,
    the child keeps its own internal wiring. The child shares the parent's
    state schema, so no translation layer is needed.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    # Agents (by name) that make up the child graph, in order.
    agents: List[str] = Field(default_factory=list)
    process: Literal["sequential", "parallel"] = "sequential"


class LangGraphConfig(BaseModel):
    """LangGraph flow config.

    `nodes`/`edges` stay optional so pre-existing v1 flows keep validating.
    When they are empty the generator derives the graph from `process` +
    `agents` (the shape the UI designer produces); when they are present the
    explicit wiring wins.
    """

    model_config = ConfigDict(extra="allow")

    framework: Literal["langgraph"] = "langgraph"
    # Endpoint/model used by every agent unless it overrides `llm_provider`.
    llm_provider: LlmProviderSpec = Field(default_factory=LlmProviderSpec)
    # How the graph is wired when `nodes`/`edges` are not given explicitly:
    #   sequential  -> a -> b -> c -> END
    #   parallel    -> fan-out from START to every agent, fan-in to an
    #                  aggregator node that concatenates the branch outputs
    #   supervisor  -> agents[0] routes to the remaining agents and loops
    #                  back until it emits FINISH (LangGraph's canonical
    #                  supervisor pattern)
    #   loop        -> single agent cycled until `loop_condition` is truthy
    #                  or `max_iterations` is hit
    process: Literal["sequential", "parallel", "supervisor", "loop"] = "sequential"
    # Loop/supervisor guard rail — also caps the compiled graph's recursion.
    max_iterations: int = 10
    # Python expression evaluated against `state` inside the loop's
    # conditional edge. Empty means "run exactly max_iterations times".
    loop_condition: str = ""
    # Checkpointer for conversational memory across turns. "memory" renders
    # an InMemorySaver; "none" compiles without one.
    # Persistence. "memory" -> InMemorySaver, "sqlite" -> SqliteSaver (survives
    # restarts, enables time-travel across sessions), "none" -> no checkpointer.
    # Interrupts force this away from "none" — there is nothing to resume from
    # without saved state.
    checkpointer: Literal["memory", "sqlite", "none"] = "memory"
    # Hard cap on super-steps. LangGraph raises GraphRecursionError past this,
    # which is the backstop for a router that never reaches END.
    recursion_limit: int = 25
    # Default stream mode for the generated server: "updates" (one event per
    # node completion), "values" (whole state per step), or "messages"
    # (token-level streaming from the LLM).
    stream_mode: Literal["updates", "values", "messages"] = "updates"
    # Retries for nodes that touch the network. Mirrors the production
    # reference's RetryPolicy(max_attempts=3) on its tool node: a transient
    # API failure retries instead of killing the run. 0 disables.
    retry_attempts: int = 0
    # Bind tools through a ToolNode + tools_condition loop instead of a single
    # bind_tools call. This is LangGraph's ReAct cycle: agent -> tools ->
    # agent -> ... until the model stops requesting tools.
    tool_loop: bool = False
    # Extra state channels with explicit reducers.
    state_channels: List[StateChannelSpec] = Field(default_factory=list)
    # Conditional edges.
    routers: List[RouterSpec] = Field(default_factory=list)
    # Human-in-the-loop pauses.
    interrupts: List[InterruptSpec] = Field(default_factory=list)
    # Dynamic fan-out via Send.
    map_reduce: Optional[MapReduceSpec] = None
    # Nested graphs added as single nodes.
    subgraphs: List[SubgraphSpec] = Field(default_factory=list)
    agents: List[AgentSpec]
    tasks: List[TaskSpec] = Field(default_factory=list)
    tools: List[ToolSpec] = Field(default_factory=list)
    output_schemas: List[OutputSchemaSpec] = Field(default_factory=list)
    conditionals: List[ConditionalSpec] = Field(default_factory=list)
    # RAG primitives — same specs ADK uses, rendered as LangChain retrievers.
    vector_stores: List[VectorStoreSpec] = Field(default_factory=list)
    retrievers: List[RetrieverSpec] = Field(default_factory=list)
    document_loaders: List[DocumentLoaderSpec] = Field(default_factory=list)
    text_splitters: List[TextSplitterSpec] = Field(default_factory=list)
    embedders: List[EmbedderSpec] = Field(default_factory=list)
    # Explicit graph wiring (optional — see class docstring).
    nodes: List[NodeSpec] = Field(default_factory=list)
    edges: List[EdgeSpec] = Field(default_factory=list)


class MAFConfig(BaseModel):
    """Microsoft Agent Framework (`agent-framework`) flow config.

    MAF composes `ChatAgent`s over a chat client and orchestrates them with
    `WorkflowBuilder` / the built-in orchestration patterns. Model access goes
    through `OpenAIChatClient`, which accepts a `base_url` — that is the vLLM
    path.
    """

    model_config = ConfigDict(extra="allow")

    framework: Literal["maf"] = "maf"
    llm_provider: LlmProviderSpec = Field(default_factory=LlmProviderSpec)
    # Orchestration pattern, mapped onto MAF's workflow builders:
    #   sequential -> SequentialBuilder: each agent refines the shared thread
    #   concurrent -> ConcurrentBuilder: fan-out/fan-in over all agents
    #   handoff    -> HandoffBuilder: agents[0] triages and hands off
    #   group-chat -> round-robin group chat over all agents
    #   loop       -> single agent re-invoked until the condition holds
    process: Literal["sequential", "concurrent", "handoff", "group-chat", "loop"] = "sequential"
    max_iterations: int = 5
    loop_condition: str = ""
    # Persist conversation threads between turns (MAF's thread/store concept).
    thread_store: Literal["memory", "none"] = "memory"
    agents: List[AgentSpec]
    tasks: List[TaskSpec] = Field(default_factory=list)
    tools: List[ToolSpec] = Field(default_factory=list)
    output_schemas: List[OutputSchemaSpec] = Field(default_factory=list)
    conditionals: List[ConditionalSpec] = Field(default_factory=list)
    vector_stores: List[VectorStoreSpec] = Field(default_factory=list)
    retrievers: List[RetrieverSpec] = Field(default_factory=list)
    document_loaders: List[DocumentLoaderSpec] = Field(default_factory=list)
    text_splitters: List[TextSplitterSpec] = Field(default_factory=list)
    embedders: List[EmbedderSpec] = Field(default_factory=list)
    mcp_toolsets: List[McpToolsetSpec] = Field(default_factory=list)


class ADKConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    framework: Literal["adk"] = "adk"
    model_id: str = "gemini-2.5-flash"
    # Optional shared endpoint/model spec. When present with a non-gemini
    # provider, codegen routes agents through LiteLlm(model=..., api_base=...)
    # so ADK can also target a vLLM server.
    llm_provider: Optional[LlmProviderSpec] = None
    process: Literal["sequential", "parallel", "hierarchical", "loop"] = "sequential"
    # Loop-only fields (ignored when process != "loop"). The checker is emitted
    # as a small `BaseAgent` subclass whose `_run_async_impl` body is taken
    # from `loop_checker_body` verbatim. Mirrors ADK sample 04_loop_agent.
    max_iterations: int = 5
    loop_checker_name: str = "checker"
    loop_checker_description: str = ""
    loop_checker_body: str = ""
    # Optional fan-out stage for nested ParallelAgent inside the outer
    # SequentialAgent. Only honored when process == "sequential" + non-hierarchical.
    # The named agents are wrapped in `ParallelAgent(name=..., sub_agents=[...])`
    # and that ParallelAgent replaces them as a single sub-agent of the outer
    # SequentialAgent (in the position of the first member). Mirrors ADK
    # sample 10_research_pipeline.
    parallel_group: Optional[Dict[str, Any]] = None
    # Optional iterative-refinement stage — analogous to parallel_group but
    # wraps the named agents in `LoopAgent(...)` and inserts that loop into
    # the outer SequentialAgent. Only honored on flat sequential pipelines.
    # Mirrors crash-course example 12 (LinkedIn post generator).
    loop_group: Optional[Dict[str, Any]] = None
    # Pydantic BaseModel definitions an agent can reference via
    # `output_schema: <name>`. Generated as `class <name>(BaseModel): ...`
    # blocks before the agents. Mirrors crash-course example 4-structured-outputs.
    output_schemas: List[OutputSchemaSpec] = Field(default_factory=list)
    # RAG primitives. Each vector store renders a Chroma singleton at module
    # scope; each retriever renders a tool function that queries its
    # referenced store.
    vector_stores: List[VectorStoreSpec] = Field(default_factory=list)
    retrievers: List[RetrieverSpec] = Field(default_factory=list)
    # Tier 3 RAG ingestion — document loaders, text splitters, embedders.
    # Codegen walks each store's upstream chain to emit a real load → split →
    # add ingest block.
    document_loaders: List[DocumentLoaderSpec] = Field(default_factory=list)
    text_splitters: List[TextSplitterSpec] = Field(default_factory=list)
    embedders: List[EmbedderSpec] = Field(default_factory=list)
    # Conditional/branching nodes. Each renders a small BaseAgent subclass
    # whose `_run_async_impl` evaluates `expression` and yields events from
    # either `true_agent` or `false_agent`.
    conditionals: List[ConditionalSpec] = Field(default_factory=list)
    # Vertex AI Search tools. Each renders one VertexAiSearchTool
    # instantiation at module scope; agents reference them by var name.
    vertex_search_tools: List[VertexSearchSpec] = Field(default_factory=list)
    # Vertex AI RAG retrieval tools — same shape but bound to a RAG corpus.
    vertex_rag_tools: List[VertexRagSpec] = Field(default_factory=list)
    # MCP Toolsets — each renders one MCPToolset(...) instantiation at module
    # scope; agents reference them by name in their tools=[...] list.
    mcp_toolsets: List[McpToolsetSpec] = Field(default_factory=list)
    agents: List[AgentSpec]
    tasks: List[TaskSpec]
    tools: List[ToolSpec] = []


FrameworkConfig = Annotated[
    Union[
        LangGraphConfig,
        ADKConfig,
        MAFConfig,
    ],
    Field(discriminator="framework"),
]


# Map framework string -> Pydantic config class. Used by from_legacy / coerce_to.
_FRAMEWORK_TO_CONFIG_CLS = {
    "langgraph": LangGraphConfig,
    "adk": ADKConfig,
    "maf": MAFConfig,
}


def supported_frameworks() -> List[str]:
    return list(_FRAMEWORK_TO_CONFIG_CLS)


# ---- Top-level envelope -----------------------------------------------------

class Meta(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    generator_version: Optional[str] = None


SCHEMA_VERSION = "1"


class AgentFlow(BaseModel):
    """
    Top-level envelope for a portable agent workflow definition.

    The `framework` field at the top level is a denormalized mirror of
    `config.framework` — kept for fast routing without having to introspect
    the discriminated union. The `_check_framework_matches` validator
    ensures the two never drift.
    """

    model_config = ConfigDict(extra="allow")

    schema_version: Literal["1"] = SCHEMA_VERSION
    framework: Literal[
        "adk", "langgraph", "maf"
    ]
    provider: Optional[str] = "openai"
    with_tracing: bool = False
    meta: Meta = Field(default_factory=Meta)
    config: FrameworkConfig

    @model_validator(mode="after")
    def _check_framework_matches(self) -> "AgentFlow":
        if self.framework != self.config.framework:
            raise ValueError(
                f"Top-level framework={self.framework!r} disagrees with "
                f"config.framework={self.config.framework!r}"
            )
        return self

    # ---- Construction helpers ----

    @classmethod
    def from_legacy(
        cls,
        framework: str,
        config: Dict[str, Any],
        *,
        provider: str = "openai",
        with_tracing: bool = False,
        description: Optional[str] = None,
        name: Optional[str] = None,
        generator_version: Optional[str] = None,
    ) -> "AgentFlow":
        """Wrap a legacy dict config in the typed envelope.

        The legacy generators don't include the `framework` discriminator in
        their dicts — we add it here so the discriminated union resolves.
        """
        if framework not in _FRAMEWORK_TO_CONFIG_CLS:
            raise ValueError(
                f"Unknown framework {framework!r}. Supported: {supported_frameworks()}"
            )
        cfg_cls = _FRAMEWORK_TO_CONFIG_CLS[framework]
        merged = {**config, "framework": framework}
        cfg = cfg_cls.model_validate(merged)
        return cls(
            framework=framework,
            provider=provider,
            with_tracing=with_tracing,
            meta=Meta(
                name=name,
                description=description,
                created_at=datetime.now(timezone.utc),
                generator_version=generator_version,
            ),
            config=cfg,
        )

    # ---- I/O ----

    @classmethod
    def load(cls, path: Union[str, Path]) -> "AgentFlow":
        return cls.model_validate_json(Path(path).read_text(encoding="utf-8"))

    def save(self, path: Union[str, Path]) -> None:
        Path(path).write_text(
            self.model_dump_json(indent=2, exclude_none=True),
            encoding="utf-8",
        )

    # ---- Bridges to legacy code path ----

    def to_legacy_config(self) -> Dict[str, Any]:
        """Return the bare dict mag's existing generators expect.

        Strips the `framework` discriminator so the dict matches today's shape.
        """
        d = self.config.model_dump(exclude_none=True)
        d.pop("framework", None)
        return d

    def coerce_to(self, framework: str) -> "AgentFlow":
        """Re-validate this flow's config against a different framework's schema.

        Used when the user passes --config with a different --framework. Raises
        a Pydantic ValidationError with field-level detail if the existing
        config doesn't match the target framework's required fields.
        """
        if framework == self.framework:
            return self
        if framework not in _FRAMEWORK_TO_CONFIG_CLS:
            raise ValueError(
                f"Unknown framework {framework!r}. Supported: {supported_frameworks()}"
            )
        cfg_cls = _FRAMEWORK_TO_CONFIG_CLS[framework]
        legacy = self.to_legacy_config()
        legacy["framework"] = framework
        new_cfg = cfg_cls.model_validate(legacy)
        return AgentFlow(
            framework=framework,
            provider=self.provider,
            with_tracing=self.with_tracing,
            meta=self.meta,
            config=new_cfg,
        )


# Resolve forward refs introduced by `from __future__ import annotations`.
# Required for Pydantic v2 to walk the discriminated union when generating
# JSON Schema or validating from JSON.
for _cls in (
    AgentSpec, TaskSpec, NodeSpec, EdgeSpec, ToolParameterSpec, ToolSpec,
    OutputSchemaFieldSpec, OutputSchemaSpec,
    CallbackSpec, CallbacksSpec,
    LangGraphConfig, ADKConfig, MAFConfig,
    StateChannelSpec, RouteSpec, RouterSpec, InterruptSpec,
    MapReduceSpec, SubgraphSpec, LlmProviderSpec,
    Meta, AgentFlow,
):
    _cls.model_rebuild()


# ---- JSON Schema export -----------------------------------------------------

def export_json_schema() -> Dict[str, Any]:
    """Return the JSON Schema for AgentFlow, suitable for non-Python tooling."""
    return AgentFlow.model_json_schema()


__all__ = [
    "AgentSpec",
    "TaskSpec",
    "NodeSpec",
    "EdgeSpec",
    "ToolParameterSpec",
    "ToolSpec",
    "LangGraphConfig",
    "ADKConfig",
    "MAFConfig",
    "Meta",
    "AgentFlow",
    "SCHEMA_VERSION",
    "supported_frameworks",
    "export_json_schema",
]
