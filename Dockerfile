FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements-backend.txt ./requirements-backend.txt

RUN pip install --upgrade pip \
    && pip install -r requirements-backend.txt

COPY astramvp ./astramvp
COPY scripts ./scripts

EXPOSE 8000

CMD ["sh", "-c", "uvicorn astramvp.backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
