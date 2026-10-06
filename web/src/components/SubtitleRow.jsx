import React, { useState } from 'react';
import { api } from '../api.js';
import { formatTime, parseTimecode } from '../time.js';
import ProposalList from './ProposalList.jsx';

export default function SubtitleRow({ sub, user, onChanged, onError, onOk }) {
  const isEditor = user.role === 'editor';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(sub.text);
  const [start, setStart] = useState(formatTime(sub.startMs));
  const [end, setEnd] = useState(formatTime(sub.endMs));
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const patch = {};
    if (text.trim() !== sub.text) patch.text = text;
    const s = parseTimecode(start);
    const e = parseTimecode(end);
    if (s === null || e === null) {
      onError('时间码格式应为 hh:mm:ss,mmm（例如 00:00:01,500）');
      return;
    }
    if (s !== sub.startMs) patch.startMs = s;
    if (e !== sub.endMs) patch.endMs = e;
    if (Object.keys(patch).length === 0) {
      onError('没有任何改动（文本与时间码均与当前版本相同）');
      return;
    }
    setSubmitting(true);
    try {
      await api.propose(sub.id, patch);
      await onChanged();
      onOk('修订提议已提交，等待审校');
    } catch (err) {
      onError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="cue">
      <div className="cue-head">
        <span className="cue-seq">#{sub.seq}</span>
        <span className="cue-time">
          {formatTime(sub.startMs)} <em>→</em> {formatTime(sub.endMs)}
        </span>
        <span className="cue-version">v{sub.version}</span>
      </div>
      <div className="cue-text">{sub.text.split('\n').map((line, i) => (
        <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>
      ))}</div>

      <ProposalList
        proposals={sub.proposals}
        user={user}
        onChanged={onChanged}
        onError={onError}
        onOk={onOk}
      />

      {isEditor && (
        <div className="propose-toggle">
          <button className="btn btn-link" onClick={() => setOpen((v) => !v)}>
            {open ? '收起修订表单' : '✏️ 提议修订本条'}
          </button>
        </div>
      )}

      {isEditor && open && (
        <div className="propose-form">
          <label>
            修订后文本（依据当前 v{sub.version}）
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="time-row">
            <label>
              起点
              <input value={start} onChange={(e) => setStart(e.target.value)} spellCheck={false} />
            </label>
            <label>
              终点
              <input value={end} onChange={(e) => setEnd(e.target.value)} spellCheck={false} />
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? '提交中…' : '提交修订提议'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setText(sub.text);
                setStart(formatTime(sub.startMs));
                setEnd(formatTime(sub.endMs));
              }}
            >
              重置
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
