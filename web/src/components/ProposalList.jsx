import React, { useState } from 'react';
import { api } from '../api.js';
import { formatTime } from '../time.js';

const STATUS_LABEL = {
  pending: '待审',
  accepted: '已接受',
  rejected: '已驳回',
  conflicted: '版本冲突',
};

export default function ProposalList({ proposals, user, onChanged, onError, onOk }) {
  const isReviewer = user.role === 'reviewer';
  const [busyId, setBusyId] = useState(null);

  if (!proposals || proposals.length === 0) return null;

  const act = async (fn, okMsg) => {
    setBusyId('x');
    try {
      await fn();
      await onChanged();
      onOk(okMsg);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const accept = (p) => act(() => api.accept(p.id), '已接受该修订，已接受版本已更新');

  const reject = (p) => {
    const reason = window.prompt('驳回原因（可留空）：', p.conflictReason || '');
    if (reason === null) return;
    act(() => api.reject(p.id, reason), '已驳回该提议（记录保留）');
  };

  return (
    <ul className="proposals">
      {proposals.map((p) => {
        return (
          <li key={p.id} className={`proposal status-${p.status}${p.stale ? ' is-stale' : ''}`}>
            <div className="proposal-top">
              <span className={`proposal-status status-tag-${p.status}`}>
                {p.stale && p.status === 'pending' ? '待审 · 依据过期' : STATUS_LABEL[p.status]}
              </span>
              <span className="proposal-meta">
                {p.proposer.displayName}（{p.proposer.username}）依据 v{p.baseVersion} 提议
              </span>
            </div>
            <div className="proposal-text">{p.newText}</div>
            <div className="proposal-time">
              {formatTime(p.newStartMs)} <em>→</em> {formatTime(p.newEndMs)}
            </div>

            {p.stale && (
              <div className="conflict-box">
                ⚠️ 冲突：该提议依据 v{p.baseVersion}，但当前已接受版本已更新，
                此提议<strong>不能被接受</strong>；可驳回，记录将保留。
              </div>
            )}
            {p.status === 'conflicted' && p.conflictReason && (
              <div className="conflict-box">⚠️ {p.conflictReason}</div>
            )}
            {p.status === 'rejected' && p.conflictReason && (
              <div className="reject-box">驳回原因：{p.conflictReason}</div>
            )}
            {p.reviewedBy && (
              <div className="proposal-meta">
                审校：{p.reviewedBy.username} · {p.reviewedAt}
              </div>
            )}

            {isReviewer && p.status === 'pending' && (
              <div className="proposal-actions">
                <button
                  className="btn btn-accept"
                  disabled={busyId !== null || p.stale}
                  title={p.stale ? '依据版本已变化，不能接受' : '接受并更新已接受版本'}
                  onClick={() => accept(p)}
                >
                  接受
                </button>
                <button
                  className="btn btn-reject"
                  disabled={busyId !== null}
                  onClick={() => reject(p)}
                >
                  驳回
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
