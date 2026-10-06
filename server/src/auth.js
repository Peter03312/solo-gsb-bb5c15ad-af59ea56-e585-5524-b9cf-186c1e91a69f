import jwt from 'jsonwebtoken';

export function signToken(user, secret) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.display_name },
    secret,
    { expiresIn: '12h' }
  );
}

/** 校验 Bearer Token，注入 req.user */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录或缺少令牌' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      displayName: payload.name,
    };
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

/** 要求特定角色之一 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `无权操作：当前操作需要 ${roles.join(' 或 ')} 角色` });
    }
    next();
  };
}
