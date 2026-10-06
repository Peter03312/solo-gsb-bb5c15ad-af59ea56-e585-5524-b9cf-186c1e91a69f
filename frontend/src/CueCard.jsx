import React, { useState } from 'react';
import { msToSrt, msToFields, fieldsToMs, formatDateTime } from './time.js';

function ProposalView({ p, role, onAccept, onReject, busy }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const pill =
    p.status === 'accepted' ? <span className="pill accepted">已接受</span> :
    p.status === 'rejected' ? <span className="pill rejected">已驳回</span> :
    p.stale ? <span className="pill stale">版本冲突 · 不可接受</span> :
    <span className="pill pending">待审</span>;

  return (
    <div className={`proposal ${p.status}${p.stale ? ' stale' : ''}`}>
      <div className="proposal-head">
        {pill}
        <span>作者：{p.author_name}</span>
        <span>依据版本 v{p.based_on_version}</span>
        <span>提议 #{p.id} · {formatDateTime(p.created_at)}</span>
      </div>
      <div className="proposal-body">{p.new_text}</div>
      <div className="proposal-time">
        {msToSrt(p.new_start_ms)} → {msToSrt(p.new_end_ms)}
      </div>

      {p.status === 'pending' && p.stale && (
        <div className="conflict-banner">
          ⚠ 冲突：该提议依据的第 {p.based_on_version} 版已不是最新（该条目后来已被接受的修订更新），
          因此不能被接受。可驳回并请编辑者依据当前版本重新提交；本提议记录会完整保留。
        </div>
      )}
      {p.status === 'rejected' && p.review_reason && (
        <div className="conflict-banner">驳回原因：{p.review_reason}</div>
      )}
      {p.status !== 'pending' && p.reviewer_name && (
        <div className="proposal-time" style={{ marginTop: 6 }}>
          {p.status === 'accepted' ? '接受' : '驳回'}人：{p.reviewer_name}
          {p.reviewed_at ? ` · ${formatDateTime(p.reviewed_at)}` : ''}
        </div>
      )}

      {role === 'reviewer' && p.status === 'pending' && (
        <div className="proposal-actions">
          {!rejecting ? (
            <>
              <button
                className="btn success small"
                disabled={busy || p.stale}
                title={p.stale ? '依据版本已变化，不能接受' : '接受该修订'}
                onClick={() => onAccept(p.id)}
              >
                接受
              </button>
              <button className="btn small" disabled={busy} onClick={() => setRejecting(true)}>
                驳回
              </button>
            </>
          ) : (
            <>
              <input
                style={{ flex: 1, minWidth: 180 }}
                placeholder="驳回原因（可留空）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                className="btn danger small"
                disabled={busy}
                onClick={() => onReject(p.id, reason).then((ok) => {
                  if (ok) { setRejecting(false); setReason(''); }
                })}
              >
                确认驳回
              </button>
              <button className="btn small" disabled={busy} onClick={() => setRejecting(false)}>
                取消
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function CueCard({ cue, role, busy, onSubmit, onAccept, onReject }) {
  const startFields = msToFields(cue.start_ms);
  const endFields = msToFields(cue.end_ms);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  const changedFromOriginal =
    cue.version > 1 ||
    cue.text !== cue.orig_text ||
    cue.start_ms !== cue.orig_start_ms ||
    cue.end_ms !== cue.orig_end_ms;

  async function submit(e) {
    e.preventDefault();
    setErr('');
    const fd = new FormData(e.target);
    const startMs = fieldsToMs(fd.get('startDate'), fd.get('startMs'));
    const endMs = fieldsToMs(fd.get('endDate'), fd.get('endMs'));
    const text = String(fd.get('text') || '').trim();

    if (!text) return setErr('字幕文本不能为空');
    if (startMs === null || endMs === null) {
      return setErr('时间格式应为 HH:MM:SS 与 0–999 的毫秒数');
    }
    if (startMs < 0 || endMs < 0) return setErr('起止时间不能为负');
    if (startMs >= endMs) {
      return setErr(`起点必须早于终点（${msToSrt(startMs)} 晚于或等于 ${msToSrt(endMs)}）`);
    }
    if (text === cue.text && startMs === cue.start_ms && endMs === cue.end_ms) {
      return setErr('与当前已接受版本完全相同，无需提交修订');
    }
    try {
      const ok = await onSubmit(cue.id, { text, start_ms: startMs, end_ms: endMs });
      if (ok) setOpen(false);
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <div className="cue">
      <div className="cue-main">
        <div className="cue-seq">#{cue.seq}</div>
        <div className="cue-time">
          {msToSrt(cue.start_ms)}<br />→ {msToSrt(cue.end_ms)}
          <span className="ver">当前版本 v{cue.version}{cue.version === 1 ? '（原稿）' : ''}</span>
        </div>
        <div className="cue-text">
          {cue.text}
          {changedFromOriginal && (
            <div className="original">
              <span className="tag">原稿</span>
              <code>{msToSrt(cue.orig_start_ms)} → {msToSrt(cue.orig_end_ms)}</code>
              {' '}
              <span>{cue.orig_text}</span>
            </div>
          )}
        </div>
      </div>

      {cue.proposals.length > 0 && (
        <div className="proposal-section">
          {cue.proposals.map((p) => (
            <ProposalView
              key={p.id}
              p={p}
              role={role}
              busy={busy}
              onAccept={onAccept}
              onReject={onReject}
            />
          ))}
        </div>
      )}

      {role === 'editor' && (
        <>
          {!open ? (
            <div className="proposal-section" style={{ flexDirection: 'row' }}>
              <button className="btn small" onClick={() => setOpen(true)}>
                提交修订提议
              </button>
            </div>
          ) : (
            <form className="edit-form" onSubmit={submit}>
              <div>
                <label>起点（时:分:秒 + 毫秒）</label>
                <div className="time-inputs">
                  <input className="date" name="startDate" defaultValue={startFields.date} />
                  <input className="ms" name="startMs" defaultValue={startFields.ms} maxLength={3} />
                </div>
              </div>
              <div>
                <label>终点（时:分:秒 + 毫秒）</label>
                <div className="time-inputs">
                  <input className="date" name="endDate" defaultValue={endFields.date} />
                  <input className="ms" name="endMs" defaultValue={endFields.ms} maxLength={3} />
                </div>
              </div>
              <div className="full">
                <label>修订文本（依据当前 v{cue.version}）</label>
                <textarea name="text" defaultValue={cue.text} />
              </div>
              {err && <div className="full error-box">{err}</div>}
              <div className="full" style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary small" type="submit" disabled={busy}>
                  提交提议
                </button>
                <button className="btn small" type="button" onClick={() => { setOpen(false); setErr(''); }}>
                  取消
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
