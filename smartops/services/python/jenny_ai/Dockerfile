FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY shared/python /shared
COPY services/python/jenny_ai/requirements.txt /app/
RUN pip install -r requirements.txt

COPY services/python/jenny_ai/app /app/app
ENV PYTHONPATH=/shared:/app
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
