'use strict';
// 진단용: 말풍선에 슬래시 명령을 적으면 통하는지 확인한다.
//   node tools/probe-slash.js > logs/probe-slash.log 2>&1

const path = require('node:path');
const os = require('node:os');

const tracker = require('../src/main/child-tracker');
tracker.install({ recordPath: path.join(os.tmpdir(), 'claude-pet-slash-pids.json') });

const { Agent } = require('../src/main/agent');
const { resolveClaudeCli } = require('../src/main/cli-path');

const log = (...a) => console.log(...a);

let resolveTurn;
let answer = '';
const seen = [];

const agent = new Agent({
  cwd: process.cwd(),
  cliPath: resolveClaudeCli(),
  onEvent: (e) => {
    seen.push(e.type);
    if (e.type === 'delta') answer += e.text;
    if (e.type === 'tool') log(`    [도구] ${e.name}`);
    if (e.type === 'error') log(`    [오류] ${e.message}`);
    if (e.type === 'result') resolveTurn?.();
  },
  onPermission: (req) => agent.resolvePermission(req.id, 'deny'),
});

async function turn(label, text) {
  log(`\n=== ${label}: ${JSON.stringify(text)}`);
  answer = '';
  seen.length = 0;
  const done = new Promise((r) => {
    resolveTurn = r;
  });
  await agent.send(text);
  await Promise.race([done, new Promise((_, j) => setTimeout(() => j(new Error('타임아웃')), 120000))]);
  log(`    이벤트: ${[...new Set(seen)].join(',')}`);
  log(`    응답: ${answer.trim().replace(/\s+/g, ' ').slice(0, 220) || '(없음)'}`);
  return answer;
}

(async () => {
  // 1) 로컬 전용 명령 — TUI 기능이라 SDK에서 안 될 가능성이 높다
  await turn('로컬 명령', '/context');

  // 2) 스킬 기반 명령 — 프롬프트로 펼쳐지므로 될 가능성이 높다
  await turn('스킬 명령', '/eli5 화폐란 무엇인가');

  tracker.killTracked();
  agent.stop();
  process.exit(0);
})().catch((err) => {
  log(`\n실패: ${err.message}`);
  tracker.killTracked();
  agent.stop();
  process.exit(1);
});
