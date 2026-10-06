import React, { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, clearToken, downloadAcceptedSrt } from './api.js';
import Login from './components/Login.jsx';
import Toolbar from './components/Toolbar.jsx';
import SubtitleRow from './components/SubtitleRow.jsx';

function decodeUser(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { id: payload.sub, username: payload.username, role: payload.role, displayName: payload.name };
  } catch {
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState(() => {
    const t = getToken();
    return t ? decodeUser(t) : null;
  });
  const [data, setData] = useState({ count: 0, subtitles: [] });
  const [notice, setNotice] = useState(null); // {type:'error'|'ok', text}
  const [loading, setLoading] = useState(false);

  const flash = useCallback((type, text) => {
    setNotice({ type, text });
    if (type === 'ok') setTimeout(() => setNotice(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.list();
      setData(d);
    } catch (err) {
      flash('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      flash('error', '登录已过期，请重新登录');
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [flash]);

  const handleLogin = async (username, password) => {
    const r = await api.login(username, password);
    setToken(r.token);
    setUser(r.user);
    setNotice(null);
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
    setData({ count: 0, subtitles: [] });
  };

  if (!user) return <Login onLogin={handleLogin} onError={(m) => flash('error', m)} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🎬 纪录片字幕校订台</div>
        <div className="userbox">
          <span className={`role-badge role-${user.role}`}>
            {user.role === 'reviewer' ? '审校者' : '编辑者'}
          </span>
          <span className="username">{user.displayName}（{user.username}）</span>
          <button className="btn btn-ghost" onClick={handleLogout}>退出登录</button>
        </div>
      </header>

      <Toolbar
        user={user}
        count={data.count}
        loading={loading}
        onImport={async (file) => {
          const fd = new FormData();
          fd.append('file', file);
          try {
            const r = await api.importSrt(fd);
            await refresh();
            flash('ok', `已导入 ${r.imported} 条字幕（旧稿及全部提议已替换）`);
          } catch (err) {
            flash('error', err.message);
          }
        }}
        onExport={async () => {
          try {
            await downloadAcceptedSrt();
          } catch (err) {
            flash('error', err.message);
          }
        }}
        onRefresh={refresh}
      />

      {notice && (
        <div className={`notice notice-${notice.type}`} onClick={() => setNotice(null)}>
          {notice.type === 'error' ? '⛔ ' : '✅ '}{notice.text}
        </div>
      )}

      <main className="list">
        {!loading && data.subtitles.length === 0 && (
          <div className="empty">
            尚无字幕{user.role === 'reviewer' ? '，请在上方导入 SRT 文件。' : '，请等待审校者导入 SRT。'}
          </div>
        )}
        {data.subtitles.map((s) => (
          <SubtitleRow
            key={s.id}
            sub={s}
            user={user}
            onChanged={refresh}
            onError={(m) => flash('error', m)}
            onOk={(m) => flash('ok', m)}
          />
        ))}
      </main>

      <footer className="footer">
        导出的 SRT 仅包含当前已接受版本；依据版本已变化的提议不能接受。
      </footer>
    </div>
  );
}
