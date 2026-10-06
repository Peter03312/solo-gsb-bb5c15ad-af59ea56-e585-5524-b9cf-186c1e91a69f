import React, { useState } from 'react';
import { api, setToken } from './api.js';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('editor');
  const [password, setPassword] = useState('editor123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token, user } = await api.login(username, password);
      setToken(token);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>字幕校订台</h1>
        <p className="subtitle">纪录片字幕协同校订系统</p>
        <label>
          用户名
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label>
          密码
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
        <div className="hint">
          <p>本地内置账号（首次启动时初始化）：</p>
          <p><code>editor / editor123</code> —— 编辑者：导入 SRT、提交修订</p>
          <p><code>reviewer / reviewer123</code> —— 审校者：接受 / 驳回提议</p>
        </div>
      </form>
    </div>
  );
}
