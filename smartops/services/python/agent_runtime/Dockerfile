FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# Microsoft ODBC Driver 18 for SQL Server: Ask Data, agent SQL steps and the Agentic Features (pyodbc) need it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg2 ca-certificates unixodbc \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
 && curl -fsSL https://packages.microsoft.com/config/debian/12/prod.list -o /etc/apt/sources.list.d/mssql-release.list \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
 && apt-get purge -y --auto-remove curl gnupg2 \
 && rm -rf /var/lib/apt/lists/*

COPY shared/python /shared
COPY services/python/agent_runtime/requirements.txt /app/
RUN pip install -r requirements.txt

COPY services/python/agent_runtime/app /app/app
ENV PYTHONPATH=/shared:/app
EXPOSE 8006
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8006"]
