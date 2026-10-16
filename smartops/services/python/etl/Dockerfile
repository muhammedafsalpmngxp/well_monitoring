# syntax=docker/dockerfile:1
# Build context is the `smartops/` directory:
#   docker build -f services/python/etl/Dockerfile .

FROM python:3.11-slim AS builder
ENV PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential gcc unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY services/python/etl/requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg2 unixodbc \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && apt-get purge -y gnupg2 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY shared/python           /shared/python
COPY services/python/etl/app /app/app

# ETL_LOG_DIR must exist and be writable: main.py calls LOG_DIR.mkdir() at import time.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin etl \
 && mkdir -p /app/logs /app/dead_letter /app/preload \
 && chown -R etl:etl /app

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/shared/python:/app \
    ETL_LOG_DIR=/app/logs \
    ETL_ENVIRONMENT=production \
    ETL_ODBC_DRIVER="ODBC Driver 18 for SQL Server"

EXPOSE 8006
USER etl
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8006"]
