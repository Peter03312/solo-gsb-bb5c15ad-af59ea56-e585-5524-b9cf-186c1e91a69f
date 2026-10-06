import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { getDb } from './db.js';
import { signToken, requireAuth, requireRole } from './auth.js';
import { ApiError, normalizeMs, validateCue, findOverlap, parseImport } from './validation.js';
import { serializeSrt } from './srt.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ type: ['text/plain', 'application/x-www-subrip'], limit: '5mb' }));

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ---------- 认证 ----------
  app.post(
    '/api/auth/login',
    wrap((req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) throw new ApiError(400, '用户名和密码均为必填');
      const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw new ApiError(401, '用户名或密码错误');
      }
      const token = signToken(user, process.env.JWT_SECRET);
      res.json({
        token,
        user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name },
      });
    })
  );

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

  // ---------- 字幕原稿与时间轴 ----------
  const selectSubtitles = () =>
    getDb()
      .prepare('SELECT * FROM subtitles ORDER BY start_ms, seq')
      .all();

  const selectProposals = () =>
    getDb()
      .prepare(
        `SELECT p.*, u.username AS proposer_username, u.display_name AS proposer_name,
                ru.username AS reviewer_username
         FROM proposals p
         JOIN users u ON u.id = p.proposer_id
         LEFT JOIN users ru ON ru.id = p.reviewed_by
         ORDER BY p.created_at, p.id`
      )
      .all();

  function serializeProposal(p, currentVersion) {
    return {
      id: p.id,
      subtitleId: p.subtitle_id,
      proposer: { id: p.proposer_id, username: p.proposer_username, displayName: p.proposer_name },
      baseVersion: p.base_version,
      newText: p.new_text,
      newStartMs: p.new_start_ms,
      newEndMs: p.new_end_ms,
      status: p.status,
      conflictReason: p.conflict_reason,
      // 依据版本与当前已接受版本不一致 => 该待审提议无法被接受
      stale: p.status === 'pending' && p.base_version !== currentVersion,
      reviewedBy: p.reviewed_by
        ? { id: p.reviewed_by, username: p.reviewer_username }
        : null,
      reviewedAt: p.reviewed_at,
      createdAt: p.created_at,
    };
  }

  app.get(
    '/api/subtitles',
    requireAuth,
    wrap((req, res) => {
      const rows = selectSubtitles();
      const proposals = selectProposals();
      const bySub = new Map(rows.map((s) => [s.id, []]));
      for (const p of proposals) {
        if (!bySub.has(p.subtitle_id)) bySub.set(p.subtitle_id, []);
        bySub.get(p.subtitle_id).push(p);
      }
      res.json({
        count: rows.length,
        subtitles: rows.map((s) => ({
          id: s.id,
          seq: s.seq,
          text: s.text,
          startMs: s.start_ms,
          endMs: s.end_ms,
          version: s.version,
          updatedAt: s.updated_at,
          proposals: (bySub.get(s.id) || []).map((p) => serializeProposal(p, s.version)),
        })),
      });
    })
  );

  // ---------- 导入 SRT（仅审校者；整批替换，事务保证失败不影响既有已接受版本） ----------
  app.post(
    '/api/subtitles/import',
    requireAuth,
    requireRole('reviewer'),
    upload.single('file'),
    wrap((req, res) => {
      const raw =
        (req.file && req.file.buffer.toString('utf8')) ||
        (typeof req.body === 'string' && req.body) ||
        (req.body && req.body.content) ||
        '';
      const cues = parseImport(raw);
      const db = getDb();
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM proposals').run();
        db.prepare('DELETE FROM subtitles').run();
        const stmt = db.prepare(
          'INSERT INTO subtitles (seq, text, start_ms, end_ms) VALUES (?, ?, ?, ?)'
        );
        cues.forEach((c, i) => stmt.run(i + 1, c.text, c.startMs, c.endMs));
      });
      tx();
      res.json({ imported: cues.length });
    })
  );

  // ---------- 导出 SRT（仅已接受版本） ----------
  app.get(
    '/api/subtitles/export.srt',
    requireAuth,
    wrap((req, res) => {
      const rows = selectSubtitles();
      if (rows.length === 0) throw new ApiError(404, '当前没有已接受的字幕可导出');
      const body = serializeSrt(
        rows.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, text: s.text }))
      );
      res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="accepted.srt"');
      res.send(body);
    })
  );

  // ---------- 编辑者提交修订提议 ----------
  app.post(
    '/api/subtitles/:id/proposals',
    requireAuth,
    requireRole('editor'),
    wrap((req, res) => {
      const id = Number(req.params.id);
      const db = getDb();
      const sub = db.prepare('SELECT * FROM subtitles WHERE id = ?').get(id);
      if (!sub) throw new ApiError(404, '字幕不存在');

      const body = req.body || {};
      const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
      const hasStart = Object.prototype.hasOwnProperty.call(body, 'startMs');
      const hasEnd = Object.prototype.hasOwnProperty.call(body, 'endMs');
      if (!hasText && !hasStart && !hasEnd) {
        throw new ApiError(400, '提议至少包含一项修订（text / startMs / endMs）');
      }
      const newText = hasText ? String(body.text) : sub.text;
      const newStartMs = hasStart ? normalizeMs(body.startMs, '起点时间') : sub.start_ms;
      const newEndMs = hasEnd ? normalizeMs(body.endMs, '终点时间') : sub.end_ms;
      const cue = validateCue({ text: newText, startMs: newStartMs, endMs: newEndMs });

      if (
        cue.text === sub.text &&
        cue.startMs === sub.start_ms &&
        cue.endMs === sub.end_ms
      ) {
        throw new ApiError(400, '提议内容与当前已接受版本完全相同，无需提交');
      }
      const overlap = findOverlap(cue.startMs, cue.endMs, sub.id);
      if (overlap) {
        throw new ApiError(
          400,
          `时间轴重叠：修订区间与第 ${overlap.seq} 条字幕重叠` +
            `（${overlap.start_ms}–${overlap.end_ms}，"${overlap.text.slice(0, 20)}"）`
        );
      }

      const info = db
        .prepare(
          `INSERT INTO proposals
             (subtitle_id, proposer_id, base_version, new_text, new_start_ms, new_end_ms)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(sub.id, req.user.id, sub.version, cue.text, cue.startMs, cue.endMs);
      const p = getDb()
        .prepare(
          `SELECT p.*, u.username AS proposer_username, u.display_name AS proposer_name,
                  ru.username AS reviewer_username
           FROM proposals p
           JOIN users u ON u.id = p.proposer_id
           LEFT JOIN users ru ON ru.id = p.reviewed_by
           WHERE p.id = ?`
        )
        .get(info.lastInsertRowid);
      res.status(201).json({ proposal: serializeProposal(p, sub.version) });
    })
  );

  // ---------- 审校者接受提议 ----------
  app.post(
    '/api/proposals/:id/accept',
    requireAuth,
    requireRole('reviewer'),
    wrap((req, res) => {
      const id = Number(req.params.id);
      const db = getDb();

      const result = db.transaction(() => {
        const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
        if (!p) throw new ApiError(404, '提议不存在');
        const sub = db.prepare('SELECT * FROM subtitles WHERE id = ?').get(p.subtitle_id);
        if (!sub) throw new ApiError(404, '提议对应的字幕已不存在');

        if (p.status === 'accepted') {
          throw new ApiError(409, `该提议已被接受（审校人 #${p.reviewed_by}），不能重复接受`);
        }
        if (p.status === 'rejected') {
          throw new ApiError(409, '该提议已被驳回，不能接受；记录已保留');
        }

        // 版本冲突：依据版本已变化，不能接受；标记 conflicted 并保留记录。
        if (p.base_version !== sub.version || p.status === 'conflicted') {
          const reason =
            p.conflict_reason ||
            `版本冲突：提议依据第 v${p.base_version} 版，当前已接受版本为 v${sub.version}`;
          db.prepare(
            `UPDATE proposals SET status = 'conflicted', conflict_reason = ?,
               reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
          ).run(reason, req.user.id, p.id);
          throw new ApiError(409, reason + '；提议保留为「冲突」状态，可驳回但不能接受');
        }

        // 内容校验：非负、起点早于终点。
        const cue = validateCue({ text: p.new_text, startMs: p.new_start_ms, endMs: p.new_end_ms });

        // 时间轴重叠校验。
        const overlap = findOverlap(cue.startMs, cue.endMs, sub.id);
        if (overlap) {
          throw new ApiError(
            400,
            `接受后时间轴将与第 ${overlap.seq} 条字幕重叠（${overlap.start_ms}–${overlap.end_ms}），已拒绝接受且不改变已接受版本`
          );
        }

        db.prepare(
          `UPDATE subtitles
             SET text = ?, start_ms = ?, end_ms = ?, version = version + 1,
                 updated_at = datetime('now')
           WHERE id = ?`
        ).run(cue.text, cue.startMs, cue.endMs, sub.id);

        db.prepare(
          `UPDATE proposals SET status = 'accepted', reviewed_by = ?, reviewed_at = datetime('now')
           WHERE id = ?`
        ).run(req.user.id, p.id);

        // 同一条字幕上其余待审提议因依据版本变化全部标记为冲突（记录保留）。
        db.prepare(
          `UPDATE proposals SET status = 'conflicted',
             conflict_reason = COALESCE(conflict_reason, ?),
             reviewed_at = datetime('now')
           WHERE subtitle_id = ? AND status = 'pending' AND id != ?`
        ).run(
          `依据版本 v${sub.version} 已被其它接受操作推进到 v${sub.version + 1}`,
          sub.id,
          p.id
        );

        const updated = db.prepare('SELECT * FROM subtitles WHERE id = ?').get(sub.id);
        const accepted = db.prepare('SELECT * FROM proposals WHERE id = ?').get(p.id);
        return { subtitle: updated, proposal: accepted };
      })();

      res.json({
        subtitle: {
          id: result.subtitle.id,
          text: result.subtitle.text,
          startMs: result.subtitle.start_ms,
          endMs: result.subtitle.end_ms,
          version: result.subtitle.version,
        },
        proposal: serializeProposal(result.proposal, result.subtitle.version),
      });
    })
  );

  // ---------- 审校者驳回提议 ----------
  app.post(
    '/api/proposals/:id/reject',
    requireAuth,
    requireRole('reviewer'),
    wrap((req, res) => {
      const id = Number(req.params.id);
      const db = getDb();
      const p = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
      if (!p) throw new ApiError(404, '提议不存在');
      if (p.status === 'accepted') throw new ApiError(409, '该提议已被接受，不能驳回');
      if (p.status === 'rejected') throw new ApiError(409, '该提议已被驳回，不能重复操作');

      const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason.trim() : null;
      db.prepare(
        `UPDATE proposals SET status = 'rejected', conflict_reason = ?,
           reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`
      ).run(reason || p.conflict_reason, req.user.id, p.id);
      const updated = db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
      const sub = db.prepare('SELECT version FROM subtitles WHERE id = ?').get(p.subtitle_id);
      res.json({ proposal: serializeProposal(updated, sub ? sub.version : updated.base_version) });
    })
  );

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // 错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: '上传内容过大（上限 10MB）' });
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}
