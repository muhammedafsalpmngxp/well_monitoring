"""askdata.llm.invoke with on_delta: the reply streamed piece by piece, still returned whole; a provider that refuses
streaming is asked again the ordinary way (and remembered); without on_delta nothing streams."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

from app.askdata import llm

LLM = SimpleNamespace(provider="openai", base_url="http://x", model="main-model", fast_model="fast-model", api_key="k")


class FakeChat:
    def __init__(self, pieces, refuse_stream=False):
        self.pieces, self.refuse_stream = pieces, refuse_stream
        self.streamed = self.invoked = 0

    def stream(self, messages):
        self.streamed += 1
        if self.refuse_stream:
            raise RuntimeError("Error code: 400 - stream is not supported for this model")
        for piece in self.pieces:
            yield AIMessageChunk(content=piece)

    def invoke(self, messages):
        self.invoked += 1
        return AIMessage(content="".join(self.pieces))


@pytest.fixture
def fake(monkeypatch):
    holder = {}

    def chat_model(*args, **kwargs):
        return holder["chat"]

    monkeypatch.setattr(llm, "chat_model", chat_model)
    monkeypatch.setattr(llm, "_REJECTED", set())
    return holder


def test_a_streamed_reply_arrives_in_pieces_and_whole(fake):
    fake["chat"] = FakeChat(["Well 101 ", "reported ", "1 task."])
    pieces = []
    model, reply = llm.invoke(LLM, [("user", "q")], 0.2, on_delta=pieces.append)
    assert model == "main-model" and pieces == ["Well 101 ", "reported ", "1 task."]
    assert reply.content == "Well 101 reported 1 task."
    assert fake["chat"].streamed == 1 and fake["chat"].invoked == 0


def test_a_provider_that_refuses_streaming_is_asked_the_ordinary_way_and_remembered(fake):
    fake["chat"] = FakeChat(["Whole answer."], refuse_stream=True)
    pieces = []
    _, reply = llm.invoke(LLM, [("user", "q")], 0.2, on_delta=pieces.append)
    assert reply.content == "Whole answer." and pieces == []
    _, again = llm.invoke(LLM, [("user", "q")], 0.2, on_delta=pieces.append)
    assert again.content == "Whole answer." and fake["chat"].streamed == 1 and fake["chat"].invoked == 2


def test_without_on_delta_nothing_streams(fake):
    fake["chat"] = FakeChat(["Plain."])
    _, reply = llm.invoke(LLM, [("user", "q")], 0.2)
    assert reply.content == "Plain." and fake["chat"].streamed == 0
