import React, { useRef, useState } from 'react';

export default function Toolbar({ user, count, loading, onImport, onExport, onRefresh }) {
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const isReviewer = user.role === 'reviewer';

  const pickFile = () => fileRef.current && fileRef.current.click();

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const ok = window.confirm(
      `导入「${file.name}」将整批替换当前原稿与全部提议，确定继续？`
    );
    if (!ok) return;
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-info">
        共 <strong>{count}</strong> 条已接受字幕
        {loading && <span className="muted"> · 加载中…</span>}
      </div>
      <div className="toolbar-actions">
        <button className="btn" onClick={onRefresh} disabled={loading}>刷新</button>
        {isReviewer && (
          <>
            <button className="btn" onClick={pickFile} disabled={importing}>
              {importing ? '导入中…' : '导入 SRT（整批替换）'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".srt,text/plain,application/x-subrip"
              hidden
              onChange={handleFile}
            />
          </>
        )}
        <button className="btn btn-primary" onClick={onExport}>导出已接受 SRT</button>
      </div>
    </div>
  );
}
