// SRT 解析与序列化。
// 解析严格校验：非法时间码、负时间、起点不早于终点、同批字幕时间轴重叠都会报错。

const TIME_RE =
  /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*(.*)$/;

const MAX_MS = 99 * 3600_000 + 59 * 60_000 + 59_000 + 999;

function parseTime(value) {
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  const toMs = (h, mi, s, ms) =>
    Number(h) * 3600_000 +
    Number(mi) * 60_000 +
    Number(s) * 1_000 +
    Number(ms.padEnd(3, '0'));
  const tail = m[9] ?? '';
  return { startMs: toMs(m[1], m[2], m[3], m[4]), endMs: toMs(m[5], m[6], m[7], m[8]), tail };
}

/**
 * 解析 SRT 文本。
 * @returns {{index:number|null, startMs:number, endMs:number, text:string}[]}
 * @throws {Error} message 为面向用户的中文原因
 */
export function parseSrt(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('SRT 内容为空');
  }
  const content = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = content.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) throw new Error('SRT 内容为空或没有有效字幕块');

  const cues = [];
  blocks.forEach((block, i) => {
    const blockNo = i + 1;
    const lines = block.split('\n').map((l) => l.trimEnd());
    const rawFirst = (lines[0] ?? '').trim();

    let timingLine;
    let parsed;
    let textLines;
    let index = null;

    if (parseTime(rawFirst)) {
      timingLine = rawFirst;
      parsed = parseTime(rawFirst);
      textLines = lines.slice(1);
    } else {
      // 标准 SRT：首行序号、第二行时间码。
      if (!/^\d+$/.test(rawFirst)) {
        throw new Error(`第 ${blockNo} 块缺少时间码行（格式应为 hh:mm:ss,mmm --> hh:mm:ss,mmm）`);
      }
      timingLine = (lines[1] ?? '').trim();
      parsed = parseTime(timingLine);
      if (!parsed) {
        throw new Error(`第 ${blockNo} 块时间码非法："${timingLine || '(空)'}"`);
      }
      index = Number(rawFirst);
      textLines = lines.slice(2);
    }

    if (parsed.tail !== '') {
      throw new Error(`第 ${blockNo} 块时间码含无法识别的设置："${parsed.tail}"`);
    }
    if (parsed.startMs > MAX_MS || parsed.endMs > MAX_MS) {
      throw new Error(`第 ${blockNo} 块时间超出 SRT 范围（最大 99:59:59,999）`);
    }
    if (parsed.startMs >= parsed.endMs) {
      throw new Error(`第 ${blockNo} 块起点必须早于终点（当前 ${formatTime(parsed.startMs)} --> ${formatTime(parsed.endMs)}）`);
    }
    const text = textLines.join('\n').trim();
    if (!text) throw new Error(`第 ${blockNo} 块没有字幕文本`);

    cues.push({ index, startMs: parsed.startMs, endMs: parsed.endMs, text });
  });

  // 重叠检测（同批导入按起点排序后相邻区间不得相交；端点相接允许）。
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMs < sorted[i - 1].endMs) {
      throw new Error(
        `导入的时间轴存在重叠："${sorted[i - 1].text.slice(0, 20)}" 与 "${sorted[i].text.slice(0, 20)}"`
      );
    }
  }
  return cues;
}

/** 毫秒 -> SRT 时间码（逗号分隔毫秒，零补齐） */
export function formatTime(ms) {
  const clamped = Math.max(0, Math.min(MAX_MS, Math.trunc(Number(ms))));
  const h = Math.floor(clamped / 3600_000);
  const m = Math.floor((clamped % 3600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const milli = clamped % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** cues -> 可下载的 SRT 文本；序号一律按顺序重排 */
export function serializeSrt(cues) {
  const body = [...cues]
    .sort((a, b) => a.startMs - b.startMs)
    .map((c, i) => `${i + 1}\n${formatTime(c.startMs)} --> ${formatTime(c.endMs)}\n${c.text}`)
    .join('\n\n');
  return `${body}\n`;
}
