# ---- 阶段 1：构建前端静态产物 ----
FROM node:20-bookworm-slim AS web-build

WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# ---- 阶段 2：后端运行时（含前端静态文件） ----
FROM node:20-bookworm-slim AS runtime

# better-sqlite3 使用预编译二进制；若需源码编译可取消下一行注释
# RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/app/server/data/app.db \
    WEB_DIST=/app/web/dist

COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server/ ./
COPY --from=web-build /app/web/dist /app/web/dist

# 数据目录由 volume 持久化；首次启动自动建表并初始化默认账号
RUN mkdir -p /app/server/data
VOLUME ["/app/server/data"]

EXPOSE 4000

CMD ["node", "src/index.js"]
