FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir lxml

COPY frontend ./frontend
COPY scripts ./scripts

ARG HF_REPO=hreyulog/spb-researcher-openalex
ARG HF_REVISION=main

RUN python scripts/download_openalex_hf.py --repo "${HF_REPO}" --revision "${HF_REVISION}" --out data_openalex \
    && python scripts/build_openalex_frontend_data.py

FROM nginx:1.27-alpine

COPY --from=builder /app/frontend /usr/share/nginx/html

EXPOSE 80
