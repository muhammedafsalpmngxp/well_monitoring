"""Standard FastAPI app factory for SmartOps Python services."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def create_app(*, title: str, service_name: str, version: str = "1.0.0") -> FastAPI:
    app = FastAPI(title=title, version=version)

    origins = os.environ.get(
        "Cors__AllowedOrigins",
        "http://localhost:4200,http://localhost:4300,http://localhost:7000"
    ).split(",")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in origins if o.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok", "service": service_name, "version": version}

    return app
