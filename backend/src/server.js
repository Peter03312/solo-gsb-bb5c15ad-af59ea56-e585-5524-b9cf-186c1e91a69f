'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const db = require('./db');
const { login, authRequired, roleRequired } = require('./auth');
const logic = require('./logic');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---- health ----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- auth ----
app.post('/api/login', (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const result = login(username, password);
    if (!result) {
      return res.status(401).json({ error: '用户名或密码错误', code: 'BAD_CREDENTIALS' });
    }
    return res.json(result);
  } catch (e) { next(e); }
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

// ---- full project state (cues + proposals) ----
app.get('/api/state', authRequired, (req, res, next) => {
  try { res.json(logic.getState()); } catch (e) { next(e); }
});

// ---- SRT import / export ----
app.post('/api/import', authRequired, roleRequired('editor', 'reviewer'), (req, res, next) => {
  try {
    const content = typeof req.body?.content === 'string'
      ? req.body.content
      : (typeof req.body === 'string' ? req.body : null);
    if (content === null) {
      return res.status(400).json({ error: '请求体需包含 SRT 文本字段 content', code: 'INVALID_SRT' });
    }
    return res.json(logic.importSrt(content));
  } catch (e) { next(e); }
});

app.get('/api/export', authRequired, roleRequired('editor', 'reviewer'), (req, res, next) => {
  try {
    const srt = logic.exportSrt();
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="accepted.srt"');
    return res.send(srt);
  } catch (e) { next(e); }
});

// ---- proposals ----
app.post('/api/cues/:cueId/proposals', authRequired, roleRequired('editor'), (req, res, next) => {
  try {
    const proposal = logic.createProposal(req.user, Number(req.params.cueId), req.body || {});
    return res.status(201).json({ proposal, state: logic.getState() });
  } catch (e) { next(e); }
});

app.post('/api/proposals/:id/accept', authRequired, roleRequired('reviewer'), (req, res, next) => {
  try {
    const state = logic.acceptProposal(req.user, Number(req.params.id));
    return res.json({ state });
  } catch (e) { next(e); }
});

app.post('/api/proposals/:id/reject', authRequired, roleRequired('reviewer'), (req, res, next) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const proposal = logic.rejectProposal(req.user, Number(req.params.id), reason);
    return res.json({ proposal, state: logic.getState() });
  } catch (e) { next(e); }
});

// ---- errors ----
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在', code: 'NOT_FOUND' });
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message || '服务器内部错误',
    code: err.code || 'INTERNAL'
  });
});

// ---- built React frontend (production / container) ----
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
}

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => {
  console.log(`subtitle-proof server listening on http://0.0.0.0:${PORT}`);
});
