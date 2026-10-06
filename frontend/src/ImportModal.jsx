import React, { useState } from 'react';

export default function ImportModal({ onClose, onImport, busy }) {
  const [content, setContent] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    const ok = await onImport(content);
    if (ok) onClose();
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div className="modal-mask" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>导入 SRT（替换当前全部字幕）</header>
        <div className="modal-body">
          <div className="warn-box">
            导入将<strong>替换</strong>当前所有字幕，并清空既有修订记录（从原稿重新校订）。
            请先导出需要保留的已接受版本。SRT 必须格式合法、起止时间为正序且整体不重叠，否则导入会被拒绝。
          </div>
          <label className="btn small" style={{ display: 'inline-block', marginBottom: 10 }}>
            选择 .srt 文件…
            <input type="file" accept=".srt,text/plain" style={{ display: 'none' }} onChange={onFile} />
          </label>
          <textarea
            placeholder={"1\n00:00:01,000 --> 00:00:03,500\n在此粘贴或读入 SRT 内容…"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          {err && <div className="error-box">{err}</div>}
        </div>
        <footer>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={submit} disabled={busy || !content.trim()}>
            {busy ? '导入中…' : '导入'}
          </button>
        </footer>
      </div>
    </div>
  );
}
