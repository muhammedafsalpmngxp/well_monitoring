"""Custom Tool as a REST call: placeholders, auth, response path, URL safety, the step and agentflow."""
import json

import httpx
import pytest

from app import api_tool
from app.agentflow.convert import from_agentflow, to_agentflow
from app.main import run_events
from app.models import CustomTool, RunRequest

pytestmark = pytest.mark.usefixtures("seeded_prompts")

TOOL = CustomTool.model_validate({
    "name": "well_status", "description": "Status of one well",
    "parameters": [{"name": "well", "type": "str", "description": "Well id"}, {"name": "days", "type": "int", "required": False}],
    "method": "GET", "url": "https://api.example.test/wells/{well}", "headers": [{"name": "X-Team", "value": "ops"}],
    "responsePath": "data.status", "authScheme": "bearer", "authSecret": "s3cret",
})


def handler(seen):
    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"data": {"status": "drilling", "well": request.url.path.rsplit("/", 1)[-1]}})
    return httpx.MockTransport(respond)


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    monkeypatch.setattr(api_tool.socket, "getaddrinfo", lambda host, port: [(None, None, None, None, ("93.184.216.34", port))])


def test_call_fills_the_url_auth_query_and_picks_the_response_path():
    seen = []
    out = api_tool.call(TOOL, {"well": "A 1/2", "days": 7}, transport=handler(seen))
    r = seen[0]
    assert out == {"status": 200, "result": "drilling"}
    assert r.url.raw_path.split(b"?")[0] == b"/wells/A%201%2F2" and r.url.params["days"] == "7"
    assert r.headers["Authorization"] == "Bearer s3cret" and r.headers["X-Team"] == "ops"


def test_post_body_placeholders_are_json_encoded():
    seen = []
    tool = TOOL.model_copy(update={"method": "POST", "url": "https://api.example.test/search", "body": '{"q": {well}, "n": {days}}',
                                   "response_path": None})
    api_tool.call(tool, {"well": 'say "hi"', "days": 3}, transport=handler(seen))
    assert json.loads(seen[0].content) == {"q": 'say "hi"', "n": 3}


def test_private_and_plain_http_urls_are_refused(monkeypatch):
    monkeypatch.setattr(api_tool.socket, "getaddrinfo", lambda host, port: [(None, None, None, None, ("10.0.0.5", port))])
    with pytest.raises(ValueError, match="private network"):
        api_tool.check_url("https://intranet.example.test/x")
    with pytest.raises(ValueError, match="https"):
        api_tool.check_url("http://api.example.test/x")
    monkeypatch.setenv("AGENT_RUNTIME_ALLOW_PRIVATE_URLS", "true")
    api_tool.check_url("https://intranet.example.test/x")


def test_the_model_sees_typed_parameters():
    schema = api_tool.as_langchain_tool(TOOL).args_schema.model_json_schema()
    assert schema["required"] == ["well"] and schema["properties"]["days"]["anyOf"][0]["type"] == "integer"


def test_a_tool_step_runs_with_the_agents_tool(monkeypatch):
    seen = {}

    def run_step(tool, text, history, llm, system):
        seen.update(tool=tool.name, secret=tool.auth_secret, model=llm.model)
        yield {"event": "done", "data": {"answer": "drilling", "tools_used": ["well_status"]}}
    monkeypatch.setattr(api_tool, "run_step", run_step)
    req = RunRequest.model_validate({
        "agent": {"name": "T", "steps": [{"text": "Status of well 7?", "tool": {"agent": "api", "action": "well_status"}}],
                  "tools": [{"agent": "api", "action": "well_status"}],
                  "customTools": [json.loads(TOOL.model_dump_json(by_alias=True))]},
        "llm": {"baseUrl": "http://llm", "model": "m"},
    })
    done = [d for n, d in run_events(req) if n == "done"][0]
    assert seen == {"tool": "well_status", "secret": "s3cret", "model": "m"} and done["steps"][0]["tools_used"] == ["well_status"]


def test_custom_tools_export_as_toolspecs_without_the_secret_and_import_back():
    agent = {"name": "T", "type": "sequential", "steps": [{"text": "x", "id": "s"}], "tools": [{"agent": "api", "action": "well_status"}],
             "customTools": [json.loads(TOOL.model_dump_json(by_alias=True))]}
    flow = to_agentflow(agent)
    spec = flow["config"]["tools"][0]
    assert spec["name"] == "well_status" and [p["name"] for p in spec["parameters"]] == ["well", "days"]
    assert "s3cret" not in json.dumps(flow)
    del flow["config"]["wellmonitoring"]                     # as a flow from the framework
    back, warnings = from_agentflow(flow)
    assert back["customTools"][0]["url"] == TOOL.url and back["tools"] == [{"agent": "api", "action": "well_status"}]
