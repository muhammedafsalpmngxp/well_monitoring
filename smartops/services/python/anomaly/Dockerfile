FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY shared/python /shared
COPY services/python/anomaly/requirements.txt /app/
RUN pip install -r requirements.txt
COPY services/python/anomaly/app /app/app
ENV PYTHONPATH=/shared:/app
EXPOSE 8003
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
