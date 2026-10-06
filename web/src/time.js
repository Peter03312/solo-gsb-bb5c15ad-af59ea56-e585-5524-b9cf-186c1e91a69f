// 毫秒 <-> SRT 时间码 hh:mm:ss,mmm

export function formatTime(ms) {
  const v = Math.max(0, Math.trunc(Number(ms) || 0));
  const h = Math.floor(v / 3600_000);
  const m = Math.floor((v % 3600_000) / 60_000);
  const s = Math.floor((v % 60_000) / 1000);
  const milli = v % 1000;
  const p2 = (n) => String(n).padStart(2, '0');
  const p3 = (n) => String(n).padStart(3, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${p3(milli)}`;
}

export function parseTimecode(str) {
  const m = String(str || '')
    .trim()
    .match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return null;
  return (
    Number(m[1]) * 3600_000 +
    Number(m[2]) * 60_000 +
    Number(m[3]) * 1000 +
    Number(m[4].padEnd(3, '0'))
  );
}
