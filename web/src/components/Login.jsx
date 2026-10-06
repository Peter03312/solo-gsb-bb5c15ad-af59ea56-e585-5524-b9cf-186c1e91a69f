import React, { useState } from 'react';

export default function Login({ onLogin, onError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>🎬 纪录片字幕校订台</h1>
        <p className="login-sub">本地账号登录 · 编辑者提交修订 · 审校者接受或驳回</p>
        <label>
          用户名
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            placeholder="editor / reviewer"
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !username || !password}>
          {busy ? '登录中…' : '登 录'}
        </button>
        <div className="login-hint">
          默认账号见 README：<code>editor / editor123</code>、<code>reviewer / reviewer123</code>
        </div>
      </form>
    </div>
  );
}
