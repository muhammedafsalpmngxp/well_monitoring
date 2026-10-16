"""
Jenny AI — Voice Recognition & Translation API
FastAPI + faster-whisper (4× faster than openai-whisper, INT8 quantized, CPU)

Endpoints:
  GET  /health      → health check
  POST /transcribe  → accepts audio file, returns transcript + English translation
"""

import os
import shutil
import tempfile
import asyncio
import subprocess
from concurrent.futures import ThreadPoolExecutor

import httpx

# Ensure ffmpeg is on PATH
_FFMPEG_DIR = r"C:\Users\SOUMYAB\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin"
if os.path.isdir(_FFMPEG_DIR) and _FFMPEG_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _FFMPEG_DIR + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel
from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

try:
    from groq import Groq
except ImportError:
    Groq = None

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="Jenny AI Voice API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://localhost:4300",
        "http://127.0.0.1:4200",
        "http://127.0.0.1:4300",
        "https://wmrdemo.prod-app.in",
        "https://wmr-demo-api.prod-app.in",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── Load faster-whisper model (INT8 quantized, 4× faster on CPU) ──────────────
# device="cpu", compute_type="int8" → best speed on machines without GPU
# Override the model with the WHISPER_MODEL env var (e.g. "base" for max speed,
# "medium" for higher accuracy).
_WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
print(f"[Jenny Voice API] Loading faster-whisper model ({_WHISPER_MODEL}, INT8)...")
_CPU_THREADS = os.cpu_count() or 4
model = WhisperModel(_WHISPER_MODEL, device="cpu", compute_type="int8", cpu_threads=_CPU_THREADS, num_workers=1)
_executor = ThreadPoolExecutor(max_workers=1)
print(f"[Jenny Voice API] Using {_CPU_THREADS} CPU threads.")
print("[Jenny Voice API] Model ready.")

# ── Optional Groq client (server-side Whisper at ~10× CPU speed) ──────────────
# When GROQ_API_KEY is set we route requests to Groq first and fall back to
# the local faster-whisper on any error (rate-limit, network, etc.).
_GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
_GROQ_MODEL   = os.environ.get("GROQ_MODEL", "whisper-large-v3")
_groq_client  = None
if _GROQ_API_KEY and Groq is not None:
    try:
        _groq_client = Groq(api_key=_GROQ_API_KEY)
        print(f"[Jenny Voice API] Groq enabled (model={_GROQ_MODEL}); local Whisper kept as fallback.")
    except Exception as _e:
        print(f"[Jenny Voice API] Groq init failed, using local Whisper only: {_e}")
else:
    print("[Jenny Voice API] GROQ_API_KEY not set — using local faster-whisper only.")


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status":   "ok",
        "provider": "groq+local-fallback" if _groq_client else "local",
        "groq":     _GROQ_MODEL if _groq_client else None,
        "local":    f"faster-whisper-{_WHISPER_MODEL}-int8",
    }


def _run_groq_translate(path: str, filename: str):
    """Translate any-language audio → English via Groq. Returns (text, lang)."""
    with open(path, "rb") as f:
        result = _groq_client.audio.translations.create(
            file=(filename, f.read()),
            model=_GROQ_MODEL,
            response_format="verbose_json",
        )
    text = (getattr(result, "text", "") or "").strip()
    lang = getattr(result, "language", None)
    return text, lang


def _run_local_whisper(path: str):
    """Local faster-whisper translate task with anti-hallucination guards."""
    segments, info = model.transcribe(
        path,
        task="translate",
        beam_size=1,
        temperature=0,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 200},
        no_speech_threshold=0.6,
        compression_ratio_threshold=1.8,   # lower = stricter anti-hallucination
        repetition_penalty=1.3,            # penalise repeated tokens (fixes "5,5,5,5..." loops)
        max_new_tokens=128,                # cap output length for short voice clips
    )
    text = " ".join(seg.text for seg in segments).strip()
    return text, info.language


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Accept an audio file (webm / wav / mp3 / ogg / m4a).
    Returns:
      - transcript:  English text
      - language:    detected ISO 639-1 code
      - english:     same as transcript
      - provider:    "groq" | "local"
    """
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    filename = audio.filename or f"audio{suffix}"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(audio.file, tmp)
            tmp_path = tmp.name

        loop = asyncio.get_event_loop()
        text          = ""
        lang          = None
        used_provider = "local"

        # 1) Try Groq first if configured
        if _groq_client is not None:
            try:
                text, lang = await loop.run_in_executor(
                    _executor, _run_groq_translate, tmp_path, filename
                )
                used_provider = "groq"
                print(f"[groq:{_GROQ_MODEL}] lang={lang!r}  english={text!r}")
            except Exception as groq_err:
                print(f"[groq] call failed, falling back to local: {groq_err}")

        # 2) Local faster-whisper (primary if no Groq, or fallback on error)
        if used_provider == "local":
            text, lang = await loop.run_in_executor(_executor, _run_local_whisper, tmp_path)
            print(f"[faster-whisper] lang={lang!r}  english={text!r}")

        return {
            "transcript": text,
            "language":   lang,
            "english":    text,
            "provider":   used_provider,
        }

    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── Databricks Proxy ──────────────────────────────────────────────────────────
# Proxies /api/databricks/* to Azure Databricks so the PAT stays server-side.
_DATABRICKS_HOST = os.environ.get(
    "DATABRICKS_HOST",
    "https://adb-7405604891058113.13.azuredatabricks.net"
)
_DATABRICKS_TOKEN = os.environ.get(
    "DATABRICKS_TOKEN",
    "CHANGE_ME"
)

_http_client = httpx.AsyncClient(timeout=120.0)


@app.api_route("/api/databricks/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def databricks_proxy(path: str, request: Request):
    """Forward requests to Azure Databricks, injecting the PAT server-side."""
    target_url = f"{_DATABRICKS_HOST}/{path}"

    # Forward headers (except Host) and inject auth
    headers = {
        "Authorization": f"Bearer {_DATABRICKS_TOKEN}",
        "Content-Type": request.headers.get("content-type", "application/json"),
    }

    body = await request.body()

    resp = await _http_client.request(
        method=request.method,
        url=target_url,
        headers=headers,
        content=body,
    )

    from fastapi.responses import Response
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers={"content-type": resp.headers.get("content-type", "application/json")},
    )

