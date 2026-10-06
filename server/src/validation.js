import { getDb } from './db.js';
import { parseSrt } from './srt.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * 接受整数毫秒，或 SRT 时间码字符串（hh:mm:ss,mmm）。
 * 非法输入返回 ApiError(400)。
 */
export function normalizeMs(value, field) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value < 0) throw new ApiError(400, `${field}不能为负数`);
    return value;
  }
  if (typeof value === 'string') {
    const m = value
      .trim()
      .match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
    if (m) {
      return (
        Number(m[1]) * 3600_000 +
        Number(m[2]) * 60_000 +
        Number(m[3]) * 1_000 +
        Number(m[4].padEnd(3, '0'))
      );
    }
  }
  throw new ApiError(400, `${field}格式非法：需为毫秒整数或 hh:mm:ss,mmm 时间码`);
}

/** 校验一条字幕的文本与起止时间，返回规整后的值 */
export function validateCue({ text, startMs, endMs }) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) throw new ApiError(400, '字幕文本不能为空');
  if (t.length > 2000) throw new ApiError(400, '字幕文本过长（上限 2000 字）');
  if (!Number.isInteger(startMs)) throw new ApiError(400, '起点时间必须为整数毫秒');
  if (!Number.isInteger(endMs)) throw new ApiError(400, '终点时间必须为整数毫秒');
  if (startMs < 0 || endMs < 0) throw new ApiError(400, '起止时间必须非负');
  if (startMs >= endMs) {
    throw new ApiError(400, `起点必须早于终点（当前 ${startMs} >= ${endMs}）`);
  }
  return { text: t, startMs, endMs };
}

/**
 * 检查 [startMs, endMs) 是否与其它已接受字幕重叠（端点相接不算重叠）。
 * @param {number} excludeId 编辑某条时排除该条
 * @returns 重叠的字幕行，或 null
 */
export function findOverlap(startMs, endMs, excludeId = null) {
  const db = getDb();
  const sql = `
    SELECT id, seq, text, start_ms, end_ms FROM subtitles
    WHERE start_ms < ? AND end_ms > ?
      AND (? IS NULL OR id != ?)
    ORDER BY start_ms
  `;
  return db.prepare(sql).get(endMs, startMs, excludeId, excludeId) || null;
}

/** 仅用于导入：复用 SRT 解析器的全部严格规则 */
export function parseImport(raw) {
  try {
    return parseSrt(raw);
  } catch (err) {
    throw new ApiError(400, `非法 SRT：${err.message}`);
  }
}
