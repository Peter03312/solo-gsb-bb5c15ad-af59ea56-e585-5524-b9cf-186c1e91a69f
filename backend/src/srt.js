'use strict';

// Milliseconds <-> SRT timestamp ("HH:MM:SS,mmm", hours may exceed 2 digits)
function msToSrt(ms) {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const milli = v % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

const TS = /^(\d+):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/;

function parseTimestamp(raw) {
  const m = TS.exec(raw.trim());
  if (!m) throw new SrtError(`无法识别的时间戳："${raw.trim()}"，应为 HH:MM:SS,mmm`);
  const [, h, min, s, frac] = m;
  const ms = Number(h) * 3600000 + Number(min) * 60000 + Number(s) * 1000 +
    Number(frac.padEnd(3, '0'));
  return ms;
}

class SrtError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SrtError';
  }
}

/**
 * Parse SRT text into [{startMs,endMs,text}].
 * Throws SrtError with a human-readable Chinese reason on any malformed block.
 */
function parseSrt(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new SrtError('SRT 文件为空');
  }
  const content = input.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = content.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length);

  const cues = [];
  blocks.forEach((block, idx) => {
    const lines = block.split('\n');
    const hint = `第 ${idx + 1} 个字幕块`;
    let i = 0;

    // Optional numeric index line.
    if (i < lines.length && /^\d+$/.test(lines[i].trim())) i += 1;

    if (i >= lines.length) {
      throw new SrtError(`${hint}缺少时间轴行`);
    }
    const timeLine = lines[i].trim();
    const arrow = timeLine.includes('-->') ? timeLine.split('-->') : null;
    if (!arrow || arrow.length !== 2) {
      throw new SrtError(`${hint}时间轴格式错误，应形如 00:00:01,000 --> 00:00:03,000`);
    }
    let startMs, endMs;
    try {
      startMs = parseTimestamp(arrow[0]);
      endMs = parseTimestamp(arrow[1]);
    } catch (e) {
      throw new SrtError(`${hint}${e.message}`);
    }
    if (startMs < 0 || endMs < 0) {
      throw new SrtError(`${hint}起止时间不能为负`);
    }
    if (startMs >= endMs) {
      throw new SrtError(`${hint}起点必须早于终点（${msToSrt(startMs)} ≥ ${msToSrt(endMs)}）`);
    }

    i += 1;
    const textLines = lines.slice(i).map((l) => l.replace(/\s+$/, ''));
    const text = textLines.join('\n').trim();
    if (!text) {
      throw new SrtError(`${hint}缺少字幕文本`);
    }
    cues.push({ startMs, endMs, text });
  });

  if (cues.length === 0) {
    throw new SrtError('未从文件中解析出任何字幕');
  }

  // Import must not carry an overlapping timeline either.
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].startMs < sorted[i - 1].endMs) {
      throw new SrtError(
        `导入文件时间轴重叠：${msToSrt(sorted[i - 1].startMs)}–${msToSrt(sorted[i - 1].endMs)}` +
        ` 与 ${msToSrt(sorted[i].startMs)}–${msToSrt(sorted[i].endMs)}`
      );
    }
  }

  // Return in time order; seq is assigned by the importer.
  return sorted;
}

/** Serialize accepted cues (already validated/non-overlapping) to SRT text. */
function serializeSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${msToSrt(c.start_ms)} --> ${msToSrt(c.end_ms)}\n${c.text}`)
    .join('\n\n') + '\n';
}

module.exports = { SrtError, parseSrt, serializeSrt, msToSrt, parseTimestamp };
