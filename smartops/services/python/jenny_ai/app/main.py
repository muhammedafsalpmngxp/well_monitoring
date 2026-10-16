"""
Jenny AI — LangChain-powered voice assistant + Whisper transcription.

Endpoints:
  GET  /health
  POST /transcribe   — multipart audio file → transcript + English translation
  POST /chat         — text question → LangChain RAG answer
"""
import asyncio
import os
import shutil
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "python"))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared" / "python"))

from fastapi import File, HTTPException, UploadFile
from pydantic import BaseModel

from smartops_shared.app import create_app

# ── Optional ML deps (degrades gracefully) ────────────────────────────────────
try:
    from faster_whisper import WhisperModel
except Exception:
    WhisperModel = None  # type: ignore

try:
    from groq import Groq
except Exception:
    Groq = None  # type: ignore

try:
    from langchain_openai import ChatOpenAI
    from langchain.schema import HumanMessage, SystemMessage
except Exception:
    ChatOpenAI = None  # type: ignore

app = create_app(title="SmartOps · Jenny AI", service_name="jenny_ai")

_executor = ThreadPoolExecutor(max_workers=1)

_WHISPER = os.environ.get("WHISPER_MODEL", "small")
_whisper = None
if WhisperModel is not None:
    try:
        _whisper = WhisperModel(_WHISPER, device="cpu", compute_type="int8")
    except Exception as e:
        print(f"[jenny_ai] Whisper init failed: {e}")

_GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
_GROQ_MODEL = os.environ.get("GROQ_MODEL", "whisper-large-v3")
_groq = Groq(api_key=_GROQ_API_KEY) if (_GROQ_API_KEY and Groq is not None) else None

_OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
_llm = ChatOpenAI(model="gpt-4o-mini", api_key=_OPENAI_API_KEY) \
       if (_OPENAI_API_KEY and ChatOpenAI is not None) else None


class ChatRequest(BaseModel):
    question: str
    well_id: str | None = None


@app.post("/chat")
async def chat(body: ChatRequest):
    """Answer a question about the project. Uses GPT-4o-mini via LangChain."""
    if _llm is None:
        return {
            "answer": "Jenny is offline — set OPENAI_API_KEY to enable.",
            "well_id": body.well_id,
            "provider": "stub",
        }
    system = ("You are Jenny, the SmartOps assistant for the WMR oilfield-monitoring "
              "platform. Answer concisely. If you don't have data, say so.")
    msgs = [SystemMessage(content=system), HumanMessage(content=body.question)]
    result = await _llm.ainvoke(msgs)
    return {"answer": result.content, "well_id": body.well_id, "provider": "openai"}


def _groq_translate(path: str, filename: str):
    with open(path, "rb") as f:
        result = _groq.audio.translations.create(
            file=(filename, f.read()), model=_GROQ_MODEL, response_format="verbose_json")
    return (getattr(result, "text", "") or "").strip(), getattr(result, "language", None)


def _local_whisper(path: str):
    segments, info = _whisper.transcribe(
        path, task="translate", beam_size=1, temperature=0,
        condition_on_previous_text=False, vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 200},
        no_speech_threshold=0.6, compression_ratio_threshold=1.8,
        repetition_penalty=1.3, max_new_tokens=128,
    )
    return " ".join(seg.text for seg in segments).strip(), info.language


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    filename = audio.filename or f"audio{suffix}"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(audio.file, tmp)
            tmp_path = tmp.name

        loop = asyncio.get_event_loop()
        text, lang, provider = "", None, "local"

        if _groq is not None:
            try:
                text, lang = await loop.run_in_executor(_executor, _groq_translate, tmp_path, filename)
                provider = "groq"
            except Exception as e:
                print(f"[jenny_ai] Groq failed, falling back: {e}")

        if provider == "local":
            if _whisper is None:
                raise HTTPException(status_code=503, detail="No transcription backend available")
            text, lang = await loop.run_in_executor(_executor, _local_whisper, tmp_path)

        return {"transcript": text, "language": lang, "english": text, "provider": provider}

    except HTTPException:
        raise
    except Exception as exc:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=False)
