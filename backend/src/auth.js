'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const TOKEN_TTL = '7d';

function login(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return null;
  }
  const payload = { sub: user.id, role: user.role, name: user.display_name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return {
    token,
    user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name }
  };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录或登录已失效', code: 'UNAUTHORIZED' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role, display_name FROM users WHERE id = ?')
      .get(payload.sub);
    if (!user) return res.status(401).json({ error: '账号不存在', code: 'UNAUTHORIZED' });
    req.user = { id: user.id, username: user.username, role: user.role, displayName: user.display_name };
    return next();
  } catch {
    return res.status(401).json({ error: '登录令牌无效或已过期', code: 'UNAUTHORIZED' });
  }
}

function roleRequired(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `无权操作：仅 ${roles.map(roleZh).join('、')}可执行此操作`,
        code: 'FORBIDDEN'
      });
    }
    return next();
  };
}

function roleZh(role) {
  return role === 'editor' ? '编辑者' : '审校者';
}

module.exports = { login, authRequired, roleRequired };
