"""Request shapes the Tenant API sends. Field names are camelCase on the wire (the .NET side's JSON)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Tool(_Camel):
    agent: str                 # "ask_data" (built in) or a twise agent name, e.g. "db_assistant"
    action: str = ""           # ask_data: "deep" | "normal"; twise: one of the agent's capabilities


# Router rule operators; "else" is the fallback branch. Text compares ignore case; numbers compare as numbers.
RuleOp = Literal["equals", "not_equals", "contains", "not_contains", "gt", "gte", "lt", "lte", "empty", "not_empty", "else"]


class Branch(_Camel):
    """One way out of a router. Rules: `input` (an input name, or "last_answer") `op` `value`. AI: the label."""
    id: str
    label: str | None = None
    input: str | None = None
    op: RuleOp = "equals"
    value: str | None = None
    target: str | None = None  # the step id to run next, "answer", or None (not wired: the answer)


class Step(_Camel):
    text: str                  # the instruction; {{input}} placeholders are filled from the run's inputs
    tool: Tool | None = None   # defaults to the agent's first tool
    id: str | None = None      # canvas node id; routers and `next` refer to steps by it
    # A router runs no tool: it picks one branch, by rules in order or by the model, and goes to its target.
    kind: Literal["step", "router"] = "step"
    route_by: Literal["rules", "ai"] = "rules"
    branches: list[Branch] | None = None   # the Tenant API sends null for plain steps
    next: str | None = None    # the step id to run after this one, or "answer"; None = the following step


class AgentInput(_Camel):
    name: str
    required: bool = True


class AskDataOptions(_Camel):
    """Knowledge Source and limits for the built-in Ask Data tool. Blank knowledge = the deployment's default files."""
    business_rules: str | None = None
    examples: str | None = None
    allowed_schemas: list[str] | None = None   # the Tenant API allows null: treated as "all the deployment allows"
    max_rows: int = 500


# Agent types: the AgenticUIFramework's LangGraph `process` values (agentflow.json v1).
#   sequential  steps one after another
#   parallel    every step at once, then one combined answer
#   supervisor  the model picks the next step (and its task) until FINISH or max_iterations
#   loop        the steps repeat until the model judges the goal met or max_iterations
AgentType = Literal["sequential", "parallel", "supervisor", "loop"]


class AgentConfig(_Camel):
    name: str = "Agent"
    type: AgentType = "sequential"
    max_iterations: int = Field(default=5, ge=1, le=20)
    # The Tenant API sends null for blank fields.
    role: str | None = None
    system_prompt: str | None = None
    goal: str | None = None
    steps: list[Step] = Field(min_length=1)
    tools: list[Tool] = Field(min_length=1)
    inputs: list[AgentInput] = []
    ask_data: AskDataOptions | None = None

    @model_validator(mode="after")
    def _check_routing(self) -> "AgentConfig":
        routers = [s for s in self.steps if s.kind == "router"]
        if not routers and not any(s.next for s in self.steps):
            return self
        if self.type not in ("sequential", "loop"):
            raise ValueError("Routers and step links work in sequential and loop agents only.")
        ids = {s.id for s in self.steps if s.id}
        for s in self.steps:
            if (s.kind == "router" or s.next) and not s.id:
                raise ValueError("A routed step needs an id.")
            targets = [b.target for b in s.branches or []] + [s.next]
            bad = [t for t in targets if t and t != "answer" and t not in ids]
            if bad:
                raise ValueError(f"'{s.text[:40]}' goes to a step that does not exist ({bad[0]}).")
        for r in routers:
            if not r.branches:
                raise ValueError(f"Router '{r.text[:40]}' has no branches.")
        return self


class Llm(_Camel):
    """The tenant's active AI provider (OpenAI chat shape), used to write the final answer."""
    provider: str = "openai"
    base_url: str
    model: str
    api_key: str | None = None
    fast_model: str | None = None


class Db(_Camel):
    """SQL Server database for Ask Data, sent by the Tenant API per run (never logged)."""
    server: str
    name: str
    user: str
    password: str
    port: int = 1433
    encrypt: str = "yes"
    trust_cert: str = "yes"


class RunRequest(_Camel):
    agent: AgentConfig
    inputs: dict[str, str] = {}
    llm: Llm | None = None
    db: Db | None = None
    session_id: str = "agent-runtime"


class AskDataExportRequest(_Camel):
    """Download the data behind an Ask Data answer (twise ExportRequest), plus where to read it from."""
    token: str = Field(min_length=1)
    format: Literal["xlsx", "docx"] = "xlsx"
    question: str = ""
    answer: str = ""
    verified: bool = True
    db: Db
    ask_data: AskDataOptions | None = None
