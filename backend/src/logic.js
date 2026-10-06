'use strict';

const db = require('./db');
const { parseSrt, serializeSrt, msToSrt } = require('./srt');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CUE_COLS =
  'id, seq, start_ms, end_ms, text, version, orig_start_ms, orig_end_ms, orig_text, updated_at';
const PROPOSAL_COLS =
  `id, cue_id, author_id, author_name, based_on_version, new_text, new_start_ms, new_end_ms,
   status, review_reason, reviewer_name, created_at, reviewed_at`;

function getState() {
  const cues = db.prepare(`SELECT ${CUE_COLS} FROM cues ORDER BY start_ms, id`).all();
  const cueVersionById = new Map(cues.map((c) => [c.id, c.version]));
  const proposals = db.prepare(`SELECT ${PROPOSAL_COLS} FROM proposals ORDER BY id`).all();
  const byCue = new Map(cues.map((c) => [c.id, []]));
  for (const p of proposals) {
    if (byCue.has(p.cue_id)) {
      byCue.get(p.cue_id).push({
        ...p,
        stale: p.status === 'pending' && p.based_on_version !== cueVersionById.get(p.cue_id)
      });
    }
  }
  return {
    cues: cues.map((c) => ({
      ...c,
      proposals: byCue.get(c.id) || []
    }))
  };
}

function importSrt(content) {
  let parsed;
  try {
    parsed = parseSrt(content);
  } catch (e) {
    throw new ApiError(400, 'INVALID_SRT', e.message);
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM cues').run();
    const stmt = db.prepare(
      `INSERT INTO cues
         (seq, start_ms, end_ms, text, version, orig_start_ms, orig_end_ms, orig_text)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    );
    parsed.forEach((c, i) => stmt.run(i + 1, c.startMs, c.endMs, c.text, c.startMs, c.endMs, c.text));
  });
  tx();
  return getState();
}

function exportSrt() {
  const cues = db.prepare(
    `SELECT start_ms, end_ms, text FROM cues ORDER BY start_ms, id`
  ).all();
  return serializeSrt(cues);
}

function createProposal(user, cueId, body) {
  const cue = db.prepare(`SELECT ${CUE_COLS} FROM cues WHERE id = ?`).get(cueId);
  if (!cue) throw new ApiError(404, 'NOT_FOUND', '字幕条目不存在');

  const newText = typeof body.text === 'string' ? body.text.replace(/\s+$/g, '').replace(/^\s+/g, '') : null;
  const newStart = toInt(body.start_ms);
  const newEnd = toInt(body.end_ms);

  if (!newText) throw new ApiError(400, 'VALIDATION', '修订后的字幕文本不能为空');
  if (newStart === null || newEnd === null) {
    throw new ApiError(400, 'VALIDATION', '起止时间必须为整数毫秒');
  }
  if (newStart < 0 || newEnd < 0) {
    throw new ApiError(400, 'VALIDATION', '起止时间不能为负');
  }
  if (newStart >= newEnd) {
    throw new ApiError(400, 'VALIDATION', `起点必须早于终点（${msToSrt(newStart)} ≥ ${msToSrt(newEnd)}）`);
  }
  if (
    newText === cue.text &&
    newStart === cue.start_ms &&
    newEnd === cue.end_ms
  ) {
    throw new ApiError(400, 'NO_CHANGE', '修订内容与当前已接受版本完全相同');
  }

  const info = db.prepare(
    `INSERT INTO proposals
       (cue_id, author_id, author_name, based_on_version, new_text, new_start_ms, new_end_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(cue.id, user.id, user.displayName, cue.version, newText, newStart, newEnd);

  return db.prepare(`SELECT ${PROPOSAL_COLS} FROM proposals WHERE id = ?`).get(info.lastInsertRowid);
}

function rejectProposal(user, proposalId, reason) {
  const p = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalId);
  if (!p) throw new ApiError(404, 'NOT_FOUND', '修订提议不存在');
  if (p.status !== 'pending') {
    throw new ApiError(409, 'ALREADY_DECIDED', `该提议已被${p.status === 'accepted' ? '接受' : '驳回'}，不能重复处理`);
  }
  db.prepare(
    `UPDATE proposals
       SET status = 'rejected', review_reason = ?, reviewer_id = ?, reviewer_name = ?,
           reviewed_at = datetime('now')
     WHERE id = ?`
  ).run(reason || null, user.id, user.displayName, proposalId);
  return db.prepare(`SELECT ${PROPOSAL_COLS} FROM proposals WHERE id = ?`).get(proposalId);
}

function acceptProposal(user, proposalId) {
  const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  if (!p) throw new ApiError(404, 'NOT_FOUND', '修订提议不存在');
  if (p.status !== 'pending') {
    throw new ApiError(409, 'ALREADY_DECIDED',
      `该提议已于此前被${p.status === 'accepted' ? '接受' : '驳回'}，不能再接受`);
  }
  const cue = db.prepare(`SELECT ${CUE_COLS} FROM cues WHERE id = ?`).get(p.cue_id);
  if (!cue) throw new ApiError(404, 'NOT_FOUND', '提议对应的字幕条目已不存在');

  if (p.based_on_version !== cue.version) {
    throw new ApiError(409, 'VERSION_CONFLICT',
      `冲突：该提议依据第 ${p.based_on_version} 版，而当前已接受版本为第 ${cue.version} 版。` +
      `条目已在本提议之后被其他修订更新，不能接受；提议记录已保留，可驳回后由编辑者依据最新版本重新提交。`);
  }

  // Re-validate timing at acceptance time.
  if (p.new_start_ms < 0 || p.new_end_ms < 0) {
    throw new ApiError(400, 'VALIDATION', '起止时间不能为负（拒绝接受，已接受版本不变）');
  }
  if (p.new_start_ms >= p.new_end_ms) {
    throw new ApiError(400, 'VALIDATION',
      `起点必须早于终点（${msToSrt(p.new_start_ms)} ≥ ${msToSrt(p.new_end_ms)}）；已接受版本不变`);
  }

  // Overlap check against every other accepted cue.
  const others = db.prepare(
    'SELECT id, seq, start_ms, end_ms FROM cues WHERE id != ?'
  ).all(cue.id);
  for (const o of others) {
    if (p.new_start_ms < o.end_ms && o.start_ms < p.new_end_ms) {
      throw new ApiError(409, 'OVERLAP',
        `时间轴重叠：修订后的 ${msToSrt(p.new_start_ms)}–${msToSrt(p.new_end_ms)}` +
        ` 与第 #${o.seq} 条 ${msToSrt(o.start_ms)}–${msToSrt(o.end_ms)} 相交；已接受版本不变`);
    }
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE cues
         SET start_ms = ?, end_ms = ?, text = ?, version = version + 1,
             updated_at = datetime('now')
       WHERE id = ?`
    ).run(p.new_start_ms, p.new_end_ms, p.new_text, cue.id);
    db.prepare(
      `UPDATE proposals
         SET status = 'accepted', reviewer_id = ?, reviewer_name = ?,
             review_reason = NULL, reviewed_at = datetime('now')
       WHERE id = ?`
    ).run(user.id, user.displayName, p.id);
  });
  tx();

  // Other pending proposals on the same cue are now stale (records retained).
  return getState();
}

function toInt(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v);
  return null;
}

module.exports = {
  ApiError,
  getState,
  importSrt,
  exportSrt,
  createProposal,
  acceptProposal,
  rejectProposal
};
