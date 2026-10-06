import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, clearToken, getToken } from './api.js';
import Login from './Login.jsx';
import CueCard from './CueCard.jsx';
import ImportModal from './ImportModal.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [state, setState] = useState({ cues: [] });
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter] = useState('all'); // all | pending | conflict
  const [query, setQuery] = useState('');
  const [toasts, setToasts] = useState([]);
  const [bootChecked, setBootChecked] = useState(false);
  const toastSeq = useRef(0);

  const pushToast = useCallback((message, kind = 'info') => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refresh = useCallback(async (silent = false) => {
    try {
      const s = await api.state();
      setState(s);
    } catch (e) {
      if (!silent) pushToast(e.message, 'error');
    }
  }, [pushToast]);

  // Restore session from stored token.
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const { user: u } = await api.me();
          setUser(u);
        } catch {
          clearToken();
        }
      }
      setBootChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    refresh(true);
    const timer = setInterval(() => refresh(true), 15000);
    return () => clearInterval(timer);
  }, [user, refresh]);

  useEffect(() => {
    const on401 = () => {
      setUser(null);
      pushToast('登录已失效，请重新登录', 'error');
    };
    window.addEventListener('sp:unauthorized', on401);
    return () => window.removeEventListener('sp:unauthorized', on401);
  }, [pushToast]);

  const stats = useMemo(() => {
    const all = state.cues.flatMap((c) => c.proposals);
    return {
      cues: state.cues.length,
      pending: all.filter((p) => p.status === 'pending').length,
      conflict: all.filter((p) => p.status === 'pending' && p.stale).length
    };
  }, [state]);

  const visibleCues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.cues.filter((c) => {
      if (filter === 'pending' && !c.proposals.some((p) => p.status === 'pending')) return false;
      if (filter === 'conflict' &&
          !c.proposals.some((p) => p.status === 'pending' && p.stale)) return false;
      if (q && !(`${c.text} ${c.orig_text} #${c.seq}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [state.cues, filter, query]);

  async function run(action, okMessage) {
    setBusy(true);
    try {
      await action();
      await refresh(true);
      if (okMessage) pushToast(okMessage, 'success');
      return true;
    } catch (e) {
      // Business failures (conflict / overlap / forbidden / invalid SRT) land here.
      pushToast(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const handleSubmitProposal = (cueId, payload) =>
    run(() => api.createProposal(cueId, payload), '修订提议已提交，等待审校');

  const handleAccept = (id) =>
    run(async () => {
      // Surface conflict/overlap reasons explicitly; accepted version stays unchanged.
      const res = await api.accept(id);
      if (res.state) setState(res.state);
    }, '已接受修订，版本号已更新；其他依据旧版本的提议将标记为冲突');

  const handleReject = (id, reason) =>
    run(() => api.reject(id, reason), '提议已驳回，记录已保留');

  const handleImport = (content) =>
    run(() => api.importSrt(content).then((s) => setState(s)), 'SRT 已导入并设为原稿');

  const handleExport = () =>
    run(() => api.exportSrt(), '已导出 SRT（仅包含当前已接受版本）');

  function logout() {
    clearToken();
    setUser(null);
    setState({ cues: [] });
  }

  if (!bootChecked) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div>
      <header className="topbar">
        <h1>🎬 字幕校订台</h1>
        <div className="stats">
          <span className="stat">字幕 <b>{stats.cues}</b></span>
          <span className="stat">待审提议 <b>{stats.pending}</b></span>
          {stats.conflict > 0 && <span className="stat">⚠ 冲突 <b>{stats.conflict}</b></span>}
        </div>
        <div className="spacer" />
        <div className="user-chip">
          <span className={`badge-role ${user.role}`}>
            {user.role === 'editor' ? '编辑者' : '审校者'}
          </span>
          <span>{user.displayName}</span>
          <button className="btn small" onClick={logout}>退出</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="filter-bar">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部
          </button>
          <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
            待审
          </button>
          <button className={filter === 'conflict' ? 'active' : ''} onClick={() => setFilter('conflict')}>
            版本冲突
          </button>
        </div>
        <input
          className="btn"
          style={{ padding: '7px 12px', width: 220 }}
          placeholder="搜索字幕文本 / 编号…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="grow" />
        <button className="btn" onClick={() => setShowImport(true)} disabled={busy}>导入 SRT</button>
        <button className="btn primary" onClick={handleExport} disabled={busy || stats.cues === 0}>
          导出已接受 SRT
        </button>
      </div>

      <main className="cue-list">
        {visibleCues.length === 0 ? (
          <div className="empty">
            {state.cues.length === 0
              ? '当前没有字幕，请使用右上角「导入 SRT」开始。'
              : '没有符合筛选条件的字幕。'}
          </div>
        ) : visibleCues.map((cue) => (
          <CueCard
            key={cue.id}
            cue={cue}
            role={user.role}
            busy={busy}
            onSubmit={handleSubmitProposal}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        ))}
      </main>

      {showImport && (
        <ImportModal
          busy={busy}
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}
