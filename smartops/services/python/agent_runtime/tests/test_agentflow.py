"""agentflow.json v1 export / import (AgenticUIFramework format)."""
import json
from pathlib import Path

import pytest

from app.agentflow.convert import from_agentflow, to_agentflow
from app.agentflow.schema import AgentFlow

FIXTURES = sorted((Path(__file__).parent / "fixtures" / "agentflow").glob("*.json"))

AGENT = {
    "name": "Wells", "description": "Counts wells", "role": "analyst", "goal": "Report wells", "systemPrompt": "Be brief.",
    "type": "supervisor", "maxIterations": 4,
    "steps": [{"text": "How many wells in {{cluster}}?", "id": "st-1", "x": 10, "y": 20},
              {"text": "Which wells slipped?", "tool": {"agent": "well_slippage", "action": "wells"}, "id": "st-2"}],
    "tools": [{"agent": "ask_data", "action": "deep"}, {"agent": "well_slippage", "action": "wells"}],
    "inputs": [{"name": "cluster", "type": "string", "required": True}],
    "outputs": [], "status": "published", "askData": {"businessRules": "R", "maxRows": 50},
}


def _clean(d):
    """Missing and null mean the same for the page."""
    if isinstance(d, dict):
        return {k: _clean(v) for k, v in d.items() if v is not None}
    if isinstance(d, list):
        return [_clean(v) for v in d]
    return d


def test_export_is_a_valid_agentflow_in_the_frameworks_shape():
    flow = to_agentflow(AGENT)
    AgentFlow.model_validate(flow)                       # the framework's own validation
    cfg = flow["config"]
    assert flow["framework"] == "langgraph" and flow["meta"]["name"] == "Wells"
    assert cfg["process"] == "supervisor" and cfg["max_iterations"] == 4
    assert cfg["agents"][0]["name"] == "supervisor"      # framework convention: agents[0] supervises
    assert [t["description"] for t in cfg["tasks"]] == ["How many wells in {{cluster}}?", "Which wells slipped?"]
    assert cfg["agents"][2]["tools"] == ["well_slippage_wells"]
    assert cfg["state_channels"][0]["name"] == "cluster"


def test_export_names_the_tenants_model_without_its_key():
    flow = to_agentflow({**AGENT, "llm": {"provider": "azure", "model": "gpt-5-deploy", "baseUrl": "https://az.example/v1"}})
    AgentFlow.model_validate(flow)
    spec = flow["config"]["llm_provider"]
    assert flow["provider"] == "azure-openai" and spec["model"] == "gpt-5-deploy" and spec["base_url"] == "https://az.example/v1"
    assert "api_key" not in spec and spec["api_key_env"] == "AZURE_OPENAI_API_KEY"   # the name of a variable, no key
    assert "gpt-4o-mini" not in json.dumps(flow)
    anthropic = to_agentflow({**AGENT, "llm": {"provider": "anthropic", "model": "claude", "baseUrl": "https://api.anthropic.com/v1"}})
    assert anthropic["config"]["llm_provider"]["api_key_env"] == "ANTHROPIC_API_KEY"


def test_org_name_replaces_only_its_placeholder():
    from app.askdata import prompts

    texts = {"askdata.sql_knowledge": "Column ORG_NAME_ID; ask about {{ORG_NAME}}"}
    assert prompts._load(texts, "sql_knowledge", "Acme") == "Column ORG_NAME_ID; ask about Acme"
    # A tenant that has not named its organisation (Settings > AI Settings) gets a neutral phrase, never a placeholder.
    assert prompts._load(texts, "sql_knowledge", "  ") == f"Column ORG_NAME_ID; ask about {prompts.NO_ORG_NAME}"


def test_round_trip_is_lossless():
    back, warnings = from_agentflow(json.loads(json.dumps(to_agentflow(AGENT))))
    assert warnings == []
    assert _clean(back) == _clean({**AGENT, "status": "draft"})   # an import is always a draft


@pytest.mark.parametrize("path", FIXTURES, ids=[p.stem for p in FIXTURES])
def test_every_framework_langgraph_template_imports(path):
    agent, warnings = from_agentflow(json.loads(path.read_text(encoding="utf-8")))
    assert agent["steps"] and agent["tools"] and agent["type"] in ("sequential", "parallel", "supervisor", "loop")


def test_template_types_map_to_agent_types():
    load = lambda n: from_agentflow(json.loads((FIXTURES[0].parent / f"{n}.json").read_text(encoding="utf-8")))[0]
    assert load("lg-supervisor")["type"] == "supervisor"
    assert load("lg-parallel-fanout")["type"] == "parallel"
    assert load("lg-debate-loop")["type"] == "loop"


def test_unsupported_parts_are_reported_not_dropped_silently():
    _, warnings = from_agentflow(json.loads((FIXTURES[0].parent / "lg-router-triage.json").read_text(encoding="utf-8")))
    assert any("routers" in w for w in warnings)
    _, warnings = from_agentflow(json.loads((FIXTURES[0].parent / "lg-multi-tool.json").read_text(encoding="utf-8")))
    assert any("get_weather" in w for w in warnings)


def test_other_frameworks_and_invalid_files_are_refused():
    with pytest.raises(ValueError, match="Only LangGraph"):
        from_agentflow({"schema_version": "1", "framework": "adk",
                        "config": {"framework": "adk", "agents": [{"name": "a"}], "tasks": []}})
    with pytest.raises(ValueError, match="Not a valid agentflow"):
        from_agentflow({"framework": "langgraph"})


def test_routers_export_as_agentflow_routers_and_round_trip():
    from tests.test_router import STEPS
    agent = {**AGENT, "type": "sequential", "steps": STEPS, "inputs": [{"name": "age", "type": "string", "required": True}]}
    flow = to_agentflow(agent)
    AgentFlow.model_validate(flow)
    cfg = flow["config"]
    assert [a["name"] for a in cfg["agents"]] == ["step_1", "step_3", "step_4", "step_5"]   # the router is an edge
    router = cfg["routers"][0]
    assert router["source"] == "step_1" and [r["target"] for r in router["routes"]] == ["step_3", "step_4"]
    assert router["routes"][0]["condition"] == "float(str(state.get('age') or '').strip().lower() or 0) < 12.0"
    assert router["default_target"] == "step_5"
    back, warnings = from_agentflow(json.loads(json.dumps(flow)))
    assert warnings == [] and _clean(back["steps"]) == _clean(STEPS)


def test_router_source_is_the_step_linked_to_it():
    steps = [{"id": "a", "text": "A", "next": "r"}, {"id": "b", "text": "B", "next": "answer"},
             {"id": "r", "text": "R", "kind": "router", "branches": [{"id": "x", "op": "else", "target": "b"}]}]
    flow = to_agentflow({**AGENT, "type": "sequential", "steps": steps})
    assert flow["config"]["routers"][0]["source"] == "step_1"


def test_step_agent_fields_map_to_agentflow_and_back_without_the_extra_block():
    step = {"text": "Summarise", "id": "s1", "expectedOutput": "Two sentences", "outputKey": "summary",
            "model": "gpt-x", "temperature": 0.3, "maxTokens": 200}
    flow = to_agentflow({**AGENT, "type": "sequential", "steps": [step]})
    cfg = flow["config"]
    assert cfg["tasks"][0]["expected_output"] == "Two sentences"
    assert cfg["agents"][0]["output_key"] == "summary"
    assert cfg["agents"][0]["llm_provider"]["model"] == "gpt-x" and cfg["agents"][0]["llm_provider"]["max_tokens"] == 200
    del cfg["wellmonitoring"]                       # as a flow made in the framework
    back, _ = from_agentflow(flow)
    s = back["steps"][0]
    assert (s["expectedOutput"], s["outputKey"], s["model"], s["temperature"], s["maxTokens"]) == \
        ("Two sentences", "summary", "gpt-x", 0.3, 200)
