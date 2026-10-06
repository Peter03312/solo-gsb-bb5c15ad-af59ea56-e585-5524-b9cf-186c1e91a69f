'use strict';

// Point this at a running dev server; expects a fresh database (SEED_SAMPLE_SRT=true).
const BASE = process.env.BASE_URL || 'http://localhost:8088';
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS', name); }
  else { fail += 1; console.log('FAIL', name, extra || ''); }
}

async function call(method, path, token, body, raw = false) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

(async () => {
  // ---- login ----
  const bad = await call('POST', '/api/login', null, { username: 'editor', password: 'wrong' });
  ok('bad password -> 401', bad.status === 401, bad.status);

  const ed = await call('POST', '/api/login', null, { username: 'editor', password: 'editor123' });
  ok('editor login', ed.status === 200 && ed.data.user.role === 'editor', ed.data);
  const edToken = ed.data.token;

  const rv = await call('POST', '/api/login', null, { username: 'reviewer', password: 'reviewer123' });
  ok('reviewer login', rv.status === 200 && rv.data.user.role === 'reviewer');
  const rvToken = rv.data.token;

  const noauth = await call('GET', '/api/state', null);
  ok('state requires auth -> 401', noauth.status === 401);

  let state = (await call('GET', '/api/state', edToken)).data;
  ok('seeded 5 cues', state.cues.length === 5, state.cues.length);
  ok('cue has original snapshot', !!state.cues[0].orig_text && state.cues[0].version === 1);

  // ---- permissions ----
  const reviewerCreates = await call('POST', '/api/cues/1/proposals', rvToken,
    { text: 'x', start_ms: 0, end_ms: 1000 });
  ok('reviewer cannot create proposal -> 403', reviewerCreates.status === 403, reviewerCreates.data);

  const editorAccepts = await call('POST', '/api/proposals/1/accept', edToken, {});
  ok('editor cannot accept -> 403', editorAccepts.status === 403, editorAccepts.data);

  // ---- validation at creation ----
  const neg = await call('POST', '/api/cues/1/proposals', edToken,
    { text: '负时间', start_ms: -1, end_ms: 1000 });
  ok('negative time rejected -> 400', neg.status === 400 && /负/.test(neg.data.error), neg.data);

  const order = await call('POST', '/api/cues/1/proposals', edToken,
    { text: '反了', start_ms: 5000, end_ms: 4000 });
  ok('start>=end rejected -> 400', order.status === 400 && /早于终点/.test(order.data.error), order.data);

  const same = await call('POST', '/api/cues/1/proposals', edToken, {
    text: state.cues[0].text,
    start_ms: state.cues[0].start_ms,
    end_ms: state.cues[0].end_ms
  });
  ok('identical proposal rejected -> 400', same.status === 400, same.data);

  // cue1: 0-4200, cue2: 4300-9000
  // ---- two pending proposals on same cue, based on v1 ----
  const p1 = await call('POST', '/api/cues/1/proposals', edToken,
    { text: '清晨，第一缕阳光掠过雪线。', start_ms: 0, end_ms: 4000 });
  ok('proposal 1 created', p1.status === 201, p1.data);
  const p1id = p1.data.proposal.id;

  const p2 = await call('POST', '/api/cues/1/proposals', edToken,
    { text: '另一处文字修订建议。', start_ms: 100, end_ms: 3500 });
  ok('proposal 2 created (multiple pending allowed)', p2.status === 201, p2.data);
  const p2id = p2.data.proposal.id;

  state = (await call('GET', '/api/state', rvToken)).data;
  const c1 = state.cues.find((c) => c.id === 1);
  ok('two pending on cue1', c1.proposals.filter((p) => p.status === 'pending').length === 2);
  ok('both recorded author + based_on_version=1',
    c1.proposals.every((p) => p.author_name && p.based_on_version === 1));

  // reviewer accepts p1
  const acc1 = await call('POST', `/api/proposals/${p1id}/accept`, rvToken, {});
  ok('accept p1 -> 200', acc1.status === 200, acc1.data);

  state = acc1.data.state;
  const cue1After = state.cues.find((c) => c.id === 1);
  ok('cue version bumped to 2', cue1After.version === 2, cue1After.version);
  ok('cue text updated', cue1After.text === '清晨，第一缕阳光掠过雪线。');
  ok('original snapshot retained', cue1After.orig_text.includes('山脊'));
  const p2view = cue1After.proposals.find((p) => p.id === p2id);
  ok('other pending proposal marked stale', p2view.status === 'pending' && p2view.stale === true);

  // try accept stale p2 -> conflict, record retained, accepted version unchanged
  const accStale = await call('POST', `/api/proposals/${p2id}/accept`, rvToken, {});
  ok('accept stale proposal -> 409 VERSION_CONFLICT',
    accStale.status === 409 && accStale.data.code === 'VERSION_CONFLICT', accStale.data);
  ok('conflict message explains versions', /依据第 1 版/.test(accStale.data.error) && /第 2 版/.test(accStale.data.error));
  state = (await call('GET', '/api/state', rvToken)).data;
  const cue1Check = state.cues.find((c) => c.id === 1);
  ok('accepted version unchanged after failed accept', cue1Check.version === 2 &&
    cue1Check.text === '清晨，第一缕阳光掠过雪线。');
  const p2kept = cue1Check.proposals.find((p) => p.id === p2id);
  ok('conflicting proposal record retained pending', p2kept.status === 'pending');

  // reject the stale one with reason
  const rej = await call('POST', `/api/proposals/${p2id}/reject`, rvToken,
    { reason: '版本过旧，请依据 v2 重新提交' });
  ok('reject stale proposal -> 200', rej.status === 200, rej.data);
  ok('reject reason stored', rej.data.proposal.status === 'rejected' &&
    /版本过旧/.test(rej.data.proposal.review_reason));

  // cannot double-decide
  const accAgain = await call('POST', `/api/proposals/${p1id}/accept`, rvToken, {});
  ok('accept already-accepted -> 409', accAgain.status === 409, accAgain.data);
  const rejAgain = await call('POST', `/api/proposals/${p2id}/reject`, rvToken, {});
  ok('reject already-rejected -> 409', rejAgain.status === 409);

  // ---- overlap at acceptance ----
  // cue1 now 0-4000; cue3 is 9200-14000. Propose moving cue3 to 3000-8000 (overlaps cue1).
  const ov = await call('POST', '/api/cues/3/proposals', edToken,
    { text: '制造重叠的提议', start_ms: 3000, end_ms: 8000 });
  ok('overlap proposal created (no global overlap until accepted)', ov.status === 201, ov.data);
  const ovAcc = await call('POST', `/api/proposals/${ov.data.proposal.id}/accept`, rvToken, {});
  ok('accept overlapping proposal -> 409 OVERLAP',
    ovAcc.status === 409 && ovAcc.data.code === 'OVERLAP', ovAcc.data);
  ok('overlap message names interval', /重叠/.test(ovAcc.data.error), ovAcc.data.error);
  state = (await call('GET', '/api/state', rvToken)).data;
  const cue3 = state.cues.find((c) => c.id === 3);
  ok('cue3 unchanged after overlap rejection (still v1)', cue3.version === 1 &&
    cue3.start_ms === 9200 && cue3.end_ms === 14000);

  // adjacent endpoint touch is allowed: cue1 ends 4000, move cue2 (4300-9000) to 4000-8800
  const adj = await call('POST', '/api/cues/2/proposals', edToken,
    { text: '摄制组在海拔四千米的营地等待风停。', start_ms: 4000, end_ms: 8800 });
  const adjAcc = await call('POST', `/api/proposals/${adj.data.proposal.id}/accept`, rvToken, {});
  ok('adjacent (end==start) accepted', adjAcc.status === 200, adjAcc.data);

  // ---- export: only accepted versions ----
  const exp = await call('GET', '/api/export', edToken);
  ok('export -> 200 srt', exp.status === 200 && /-->/.test(exp.data), exp.status);
  ok('export contains accepted text', exp.data.includes('阳光掠过雪线'));
  ok('export excludes pending overlap text', !exp.data.includes('制造重叠'));
  const blocks = exp.data.trim().split(/\n\s*\n/);
  ok('export has 5 cues numbered', blocks.length === 5 && blocks[0].startsWith('1'));

  // ---- invalid SRT import ----
  const badSrt = await call('POST', '/api/import', edToken, { content:
    '1\n00:00:01,000 --> 00:00:03,000\n正常第一条\n\n' +
    '2\n00:00:0X,000 --> 00:00:05,000\n坏时间戳'
  });
  ok('invalid SRT -> 400 with block reason',
    badSrt.status === 400 && badSrt.data.code === 'INVALID_SRT' && /第 2 个字幕块/.test(badSrt.data.error),
    badSrt.data);

  const overlapSrt = await call('POST', '/api/import', edToken, { content:
    '1\n00:00:00,000 --> 00:00:05,000\n甲\n\n2\n00:00:04,000 --> 00:00:06,000\n乙'
  });
  ok('overlapping SRT import rejected',
    overlapSrt.status === 400 && overlapSrt.data.code === 'INVALID_SRT' && /重叠/.test(overlapSrt.data.error),
    overlapSrt.data);

  const emptySrt = await call('POST', '/api/import', edToken, { content: '   ' });
  ok('empty SRT rejected', emptySrt.status === 400);

  // accepted data untouched after failed imports
  state = (await call('GET', '/api/state', edToken)).data;
  ok('state unchanged after failed imports (5 cues)', state.cues.length === 5);

  // ---- valid import resets project ----
  const goodSrt =
    '1\n00:00:00,500 --> 00:00:02,000\n新原稿 A\n\n' +
    '2\n00:00:02,000 --> 00:00:04,500\n新原稿 B\n';
  const goodImp = await call('POST', '/api/import', rvToken, { content: goodSrt });
  ok('valid import by reviewer -> 200, project reset',
    goodImp.status === 200 && goodImp.data.cues.length === 2, goodImp.data);
  ok('imported cues at v1 with original snapshot',
    goodImp.data.cues[0].version === 1 && goodImp.data.cues[0].orig_text === '新原稿 A' &&
    goodImp.data.cues[0].start_ms === 500);
  ok('old proposals cleared on reimport',
    goodImp.data.cues.every((c) => c.proposals.length === 0));

  const exp2 = await call('GET', '/api/export', edToken);
  ok('export reflects new manuscript', exp2.data.includes('新原稿 A') && exp2.data.includes('新原稿 B'));
  ok('export timestamp uses comma mmm', /00:00:00,500 --> 00:00:02,000/.test(exp2.data), exp2.data);

  // export requires auth
  const expNoAuth = await call('GET', '/api/export', null);
  ok('export without token -> 401', expNoAuth.status === 401);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
