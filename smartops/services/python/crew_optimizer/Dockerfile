FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY shared/python /shared
COPY services/python/crew_optimizer/requirements.txt /app/
RUN pip install -r requirements.txt
COPY services/python/crew_optimizer/app /app/app
ENV PYTHONPATH=/shared:/app
EXPOSE 8004
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8004"]
