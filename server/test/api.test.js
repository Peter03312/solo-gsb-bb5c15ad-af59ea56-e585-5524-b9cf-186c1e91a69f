// 端到端集成测试：内存 SQLite + 真实 HTTP（全局 fetch，Node >=20）。
// 运行：node --test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.JWT_SECRET = 'test-secret';
process.env.DB_PATH = ':memory:';
process.env.NO_LISTEN = '1';

const { initDb, seedUsersIfEmpty } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { serializeSrt, parseSrt } = await import('../src/srt.js');

initDb(':memory:');
seedUsersIfEmpty({
  editor: { username: 'editor', password: 'editor123', role: 'editor', displayName: '编辑者' },
  reviewer: { username: 'reviewer', password: 'reviewer123', role: 'reviewer', displayName: '审校者' },
});

const server = createServer(createApp());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

after(() => server.close());

const SAMPLE = `1
00:00:01,000 --> 00:00:04,000
第一句原稿

2
00:00:04,500 --> 00:00:08,000
第二句原稿
`;

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function login(role) {
  const { status, json } = await call('POST', '/api/auth/login', {
    body: { username: role, password: `${role}123` },
  });
  assert.equal(status, 200);
  return json.token;
}

let editorToken, reviewerToken;
before(async () => {
  editorToken = await login('editor');
  reviewerToken = await login('reviewer');
});

test('SRT 解析器：合法往返；非法块报错', () => {
  const cues = parseSrt(SAMPLE);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1000);
  const out = serializeSrt(cues.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })));
  assert.match(out, /00:00:01,000 --> 00:00:04,000/);

  assert.throws(() => parseSrt('1\n00:00:05,000 --> 00:00:02,000\n坏'), /起点必须早于终点/);
  assert.throws(
    () => parseSrt('1\n00:00:01,000 --> 00:00:03,000\n甲\n\n2\n00:00:02,000 --> 00:00:04,000\n乙'),
    /重叠/
  );
  assert.throws(() => parseSrt(''), /空/);
});

test('未登录 401；编辑者无权导入 403', async () => {
  assert.equal((await call('GET', '/api/subtitles')).status, 401);
  const fd = new FormData();
  fd.append('file', new Blob([SAMPLE]), 'a.srt');
  const r = await call('POST', '/api/subtitles/import', { token: editorToken, form: fd });
  assert.equal(r.status, 403);
});

test('非法 SRT 导入失败且不改变已接受版本', async () => {
  const fdOk = new FormData();
  fdOk.append('file', new Blob([SAMPLE]), 'ok.srt');
  const ok = await call('POST', '/api/subtitles/import', { token: reviewerToken, form: fdOk });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.imported, 2);

  const fdBad = new FormData();
  fdBad.append('file', new Blob(['1\nXX --> YY\n坏']), 'bad.srt');
  const bad = await call('POST', '/api/subtitles/import', { token: reviewerToken, form: fdBad });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /非法 SRT/);

  const list = await call('GET', '/api/subtitles', { token: reviewerToken });
  assert.equal(list.json.count, 2, '失败导入不应改变已有字幕');
});

test('编辑者可提交文本/时间修订；同一条可有多个待审提议', async () => {
  const p1 = await call('POST', '/api/subtitles/1/proposals', {
    token: editorToken,
    body: { text: '第一句修订文本' },
  });
  assert.equal(p1.status, 201);
  assert.equal(p1.json.proposal.baseVersion, 1);
  assert.equal(p1.json.proposal.proposer.username, 'editor');

  const p2 = await call('POST', '/api/subtitles/1/proposals', {
    token: editorToken,
    body: { startMs: '00:00:01,500' },
  });
  assert.equal(p2.status, 201);

  const list = await call('GET', '/api/subtitles', { token: editorToken });
  const first = list.json.subtitles[0];
  assert.equal(first.proposals.length, 2);
  assert.ok(first.proposals.every((p) => p.status === 'pending'));
});

test('非法修订被拒绝：负数、起点不早于终点、重叠、无改动', async () => {
  const cases = [
    { startMs: -1, endMs: 4000 },
    { startMs: 5000, endMs: 4000 },
    { startMs: 5000, endMs: 9000 }, // 与第二句 4500-8000 重叠
  ];
  for (const body of cases) {
    const r = await call('POST', '/api/subtitles/1/proposals', { token: editorToken, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  const same = await call('POST', '/api/subtitles/2/proposals', {
    token: editorToken,
    body: { text: '第二句原稿' },
  });
  assert.equal(same.status, 400);
});

test('接受提议推进版本；其余同条待审提议变为冲突且不能接受', async () => {
  const listBefore = await call('GET', '/api/subtitles', { token: reviewerToken });
  const first = listBefore.json.subtitles[0];
  const textProp = first.proposals.find((p) => p.newText === '第一句修订文本');
  const timingProp = first.proposals.find((p) => p.newStartMs === 1500);

  const acc = await call('POST', `/api/proposals/${textProp.id}/accept`, { token: reviewerToken });
  assert.equal(acc.status, 200);
  assert.equal(acc.json.subtitle.version, 2);
  assert.equal(acc.json.subtitle.text, '第一句修订文本');

  const stale = await call('POST', `/api/proposals/${timingProp.id}/accept`, { token: reviewerToken });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /版本冲突|冲突/);

  // 记录保留为 conflicted，且已接受文本未变
  const after = await call('GET', '/api/subtitles', { token: reviewerToken });
  const row = after.json.subtitles[0];
  const marked = row.proposals.find((p) => p.id === timingProp.id);
  assert.equal(marked.status, 'conflicted');
  assert.equal(row.text, '第一句修订文本');

  // 冲突提议仍可驳回
  const rej = await call('POST', `/api/proposals/${timingProp.id}/reject`, {
    token: reviewerToken,
    body: { reason: '依据过期' },
  });
  assert.equal(rej.status, 200);
});

test('接受后导致跨条重叠的提议被拒绝且不改变已接受版本', async () => {
  // 两条已接受字幕间有 500ms 间隙：第一句 1000-4000，第二句 4500-8000。
  // 提议 A：第一句延长到 4400（单独合法，与第二句 4500 不重叠）
  // 提议 B：第二句起点提前到 4300（单独合法，与第一句当前终点 4000 不重叠）
  const a = await call('POST', '/api/subtitles/1/proposals', {
    token: editorToken,
    body: { endMs: 4400 },
  });
  assert.equal(a.status, 201);
  const b = await call('POST', '/api/subtitles/2/proposals', {
    token: editorToken,
    body: { startMs: 4300 },
  });
  assert.equal(b.status, 201);

  // 接受 A 后第一句变为 1000-4400；再接受 B 会与第一句重叠
  const accA = await call('POST', `/api/proposals/${a.json.proposal.id}/accept`, {
    token: reviewerToken,
  });
  assert.equal(accA.status, 200);

  const accB = await call('POST', `/api/proposals/${b.json.proposal.id}/accept`, {
    token: reviewerToken,
  });
  assert.equal(accB.status, 400);
  assert.match(accB.json.error, /重叠/);

  // 第二句已接受版本保持不变（起点仍是 4500，版本仍为 1，B 仍为待审）
  const list = await call('GET', '/api/subtitles', { token: reviewerToken });
  const second = list.json.subtitles.find((s) => s.id === 2);
  assert.equal(second.startMs, 4500);
  assert.equal(second.version, 1);
  const bRow = second.proposals.find((p) => p.id === b.json.proposal.id);
  assert.equal(bRow.status, 'pending');
});

test('审校者可驳回；编辑者不能审校', async () => {
  const p = await call('POST', '/api/subtitles/2/proposals', {
    token: editorToken,
    body: { text: '第二句修订' },
  });
  const forbidden = await call('POST', `/api/proposals/${p.json.proposal.id}/accept`, {
    token: editorToken,
  });
  assert.equal(forbidden.status, 403);

  const rej = await call('POST', `/api/proposals/${p.json.proposal.id}/reject`, {
    token: reviewerToken,
    body: {},
  });
  assert.equal(rej.status, 200);
  assert.equal(rej.json.proposal.status, 'rejected');
});

test('导出 SRT 只包含已接受版本', async () => {
  const res = await fetch(base + '/api/subtitles/export.srt', {
    headers: { Authorization: `Bearer ${reviewerToken}` },
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /第一句修订文本/);
  assert.doesNotMatch(text, /第二句修订/, '被驳回的提议不得进入导出');
  assert.match(text, /第二句原稿/);
});
