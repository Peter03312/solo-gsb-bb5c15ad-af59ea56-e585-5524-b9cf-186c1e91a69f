// Timecode helpers: SRT "HH:MM:SS,mmm" <-> editable field values <-> milliseconds

export function msToSrt(ms) {
  const v = Math.max(0, Math.round(Number(ms) || 0));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const milli = v % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

// "HH:MM:SS,mmm" or "HH:MM:SS.mmm" -> ms; null when invalid
export function srtToMs(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d+):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/.exec(str.trim());
  if (!m) return null;
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 +
    Number(m[4].padEnd(3, '0'));
}

// Split a ms value into form fields {date:'HH:MM:SS', ms:'mmm'}
export function msToFields(ms) {
  const v = Math.max(0, Math.round(Number(ms) || 0));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${pad(h)}:${pad(m)}:${pad(s)}`, ms: String(v % 1000).padStart(3, '0') };
}

export function fieldsToMs(date, frac) {
  const m = /^(\d+):([0-5]?\d):([0-5]?\d)$/.exec((date || '').trim());
  if (!m || !/^\d{1,3}$/.test((frac || '').trim())) return null;
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 +
    Number(frac.trim().padEnd(3, '0'));
}

export function formatDateTime(sqlite) {
  return sqlite ? sqlite.replace('T', ' ').slice(0, 16) + ' (UTC)' : '';
}
