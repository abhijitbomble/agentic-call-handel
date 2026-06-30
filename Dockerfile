FROM node:20-bookworm-slim

ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv build-essential \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
  && pip install --no-cache-dir --upgrade pip setuptools wheel

COPY package*.json ./
RUN npm install

COPY apps/api/ ./apps/api/
COPY apps/web/ ./apps/web/
COPY docs/ ./docs/
COPY infra/ ./infra/
COPY README.md ./README.md
COPY scripts/ ./scripts/
COPY .env.example ./.env.example

RUN pip install --no-cache-dir --ignore-requires-python -e ./apps/api
RUN npm --prefix apps/web install
RUN npm --prefix apps/web run build

EXPOSE 3000
CMD ["node", "scripts/railway-start.mjs"]
