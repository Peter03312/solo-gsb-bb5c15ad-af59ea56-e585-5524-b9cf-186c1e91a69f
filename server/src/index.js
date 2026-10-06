import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { initDb, seedUsersIfEmpty } from './db.js';
import { createApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 4000);
const DB_PATH = process.env.DB_PATH || resolve(__dirname, '..', 'data', 'app.db');

initDb(DB_PATH);

seedUsersIfEmpty({
  editor: {
    username: process.env.EDITOR_USERNAME || 'editor',
    password: process.env.EDITOR_PASSWORD || 'editor123',
    role: 'editor',
    displayName: process.env.EDITOR_DISPLAY_NAME || '编辑者',
  },
  reviewer: {
    username: process.env.REVIEWER_USERNAME || 'reviewer',
    password: process.env.REVIEWER_PASSWORD || 'reviewer123',
    role: 'reviewer',
    displayName: process.env.REVIEWER_DISPLAY_NAME || '审校者',
  },
});

const app = createApp();

// 生产环境托管前端构建产物；SPA 路由回退到 index.html。
const webDist = process.env.WEB_DIST || resolve(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(resolve(webDist, 'index.html')));
}

const server = process.env.NO_LISTEN
  ? null
  : app.listen(PORT, () => {
      const addr = server.address();
      const realPort = typeof addr === 'object' && addr ? addr.port : PORT;
      console.log(`[字幕校订] 服务已启动: http://localhost:${realPort}`);
      console.log(`[字幕校订] 数据库: ${DB_PATH}`);
    });

export { app, server };
