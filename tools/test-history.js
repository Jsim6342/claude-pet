'use strict';
// 지난 대화 복원 검증: 몇 턴 나눈 뒤, 세션 id만 가지고 그 대화를 되읽어올 수 있는가.
//   node tools/test-history.js > logs/history.log 2>&1

const path = require('node:path');
const os = require('node:os');

const tracker = require('../src/main/child-tracker');
tracker.install({ recordPath: path.join(os.tmpdir(), 'claude-pet-history-pids.json') });

const { Agent } = require('../src/main/agent');
const { resolveClaudeCli } = require('../src/main/cli-path');

const log = (...a) => console.log(...a);
let resolveTurn;

const agent = new Agent({
  cwd: process.cwd(),
  cliPath: resolveClaudeCli(),
  onEvent: (e) => {
    if (e.type === 'result') resolveTurn?.();
    if (e.type === 'error') log(`  error: ${e.message}`);
  },
  onPermission: (req) => agent.resolvePermission(req.id, 'deny'),
});

async function turn(text) {
  const done = new Promise((r) => {
    resolveTurn = r;
  });
  await agent.send(text);
  await Promise.race([done, new Promise((_, j) => setTimeout(() => j(new Error('타임아웃')), 120000))]);
}

(async () => {
  log('두 턴 대화를 만듭니다...');
  await turn('Remember this word: BANANA. Just say OK.');
  await turn('Reply with exactly: DONE');
  const sessionId = agent.sessionId;
  log(`세션: ${sessionId}`);

  // CLI가 transcript를 디스크에 flush할 틈을 준다.
  // result 이벤트 직후 바로 죽이면 마지막 답변이 아직 안 쓰여 있다.
  await new Promise((r) => setTimeout(r, 2500));

  // 앱을 껐다 켠 상황을 흉내 낸다 — 세션 id만 남기고 새 Agent를 만든다
  agent.stop();
  const fresh = new Agent({
    cwd: process.cwd(),
    cliPath: resolveClaudeCli(),
    onEvent: () => {},
    onPermission: () => {},
  });
  fresh.sessionId = sessionId;

  const items = await fresh.loadHistory();
  log(`불러온 항목 ${items.length}개:`);
  for (const it of items) {
    const preview = (it.text || '').replace(/\s+/g, ' ').slice(0, 60);
    log(`  [${it.role}] ${preview}${it.tools?.length ? ` (도구: ${it.tools.join(',')})` : ''}`);
  }

  const users = items.filter((i) => i.role === 'user');
  const assistants = items.filter((i) => i.role === 'assistant');
  const allText = items.map((i) => i.text).join(' ');

  const checks = [
    ['기록을 불러왔다', items.length > 0],
    ['내가 보낸 말이 들어있다', users.some((u) => /BANANA/.test(u.text))],
    ['Claude 답변이 들어있다', assistants.some((a) => /DONE/i.test(a.text))],
    ['두 턴이 모두 보인다', users.length >= 2],
    ['도구 결과 찌꺼기가 섞이지 않았다', !/tool_result|tool_use_id/.test(allText)],
    ['빈 메시지가 없다', items.every((i) => (i.text || '').trim() || i.tools?.length)],
  ];

  log('\n---------------- 결과');
  let ok = true;
  for (const [name, pass] of checks) {
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }

  tracker.killTracked();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  log(`\n실패: ${err.message}`);
  tracker.killTracked();
  agent.stop();
  process.exit(1);
});
