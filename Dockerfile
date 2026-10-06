# ---- stage 1: build React frontend ----
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- stage 2: backend with built frontend baked in ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app/backend

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/subtitles.db

# better-sqlite3 normally uses prebuilt binaries; build tools are installed only
# as a fallback for native compilation during npm install and removed afterwards.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

RUN apt-get update \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY backend/src ./src
COPY --from=frontend-build /app/frontend/dist ./public

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

# On first boot db.js creates tables and seeds accounts + optional sample SRT.
CMD ["node", "src/server.js"]
