FROM node:20-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
ARG BUILD_DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG BUILD_AUTH_SECRET=build-time-secret
ENV DATABASE_URL=${BUILD_DATABASE_URL}
ENV AUTH_SECRET=${BUILD_AUTH_SECRET}

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    gnupg \
  && wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    postgresql-client-16 \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --include=dev

COPY requirements.txt ./
RUN python3 -m venv .venv \
  && ./.venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build

RUN mkdir -p /app-defaults /data/storage /data/reports /data/report-runs \
  && cp -a /app/reports /app-defaults/reports \
  && rm -rf /app/storage /app/reports /app/.report-runs \
  && ln -s /data/storage /app/storage \
  && ln -s /data/reports /app/reports \
  && ln -s /data/report-runs /app/.report-runs

COPY docker/entrypoint.sh /usr/local/bin/report-studio-entrypoint
RUN chmod +x /usr/local/bin/report-studio-entrypoint

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["report-studio-entrypoint"]
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
