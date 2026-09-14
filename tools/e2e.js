'use strict';
// 개발용 통합 테스트: Electron 없이 agent.js만 돌려서
// 멀티턴 유지 / 스트리밍 / 권한 요청이 제대로 오는지 확인한다.
//   node tools/e2e.js

const { Agent } = require('../src/main/agent');
const { resolveClaudeCli } = require('../src/main/cli-path');

const log = (...args) => console.log(...args);

const cliPath = resolveClaudeCli();
log(`CLI: ${cliPath || '(SDK 기본값)'}`);

let turnDone = null;
const seen = { deltas: 0, tools: [], perms: [], errors: [] };
let answer = '';

const agent = new Agent({
  cwd: process.cwd(),
  cliPath,
  onEvent: (event) => {
    switch (event.type) {
      case 'init':
        log(`  [init] ${event.model} · session ${event.sessionId.slice(0, 8)}`);
        break;
      case 'delta':
        seen.deltas++;
        answer += event.text;
        break;
      case 'tool':
        seen.tools.push(event.name);
        log(`  [tool] ${event.name}`);
        break;
      case 'error':
        seen.errors.push(event.message);
        log(`  [error] ${event.message}`);
        break;
      case 'result':
        log(`  [result] ${event.subtype}`);
        turnDone?.();
        break;
      default:
        break;
    }
  },
  onPermission: (req) => {
    seen.perms.push(req.toolName);
    log(`  [permission] ${req.title}  (항상허용 가능: ${req.canAlwaysAllow})`);
    agent.resolvePermission(req.id, 'allow');
  },
});

async function turn(label, text) {
  log(`\n=== ${label}`);
  answer = '';
  const done = new Promise((resolve) => {
    turnDone = resolve;
  });
  await agent.send(text);
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('타임아웃 120초')), 120000))]);
  log(`  응답: ${answer.trim().slice(0, 160)}`);
  return answer;
}

(async () => {
  const a = await turn('1턴: 스트리밍', 'Reply with exactly: PONG');
  const sessionAfterFirst = agent.sessionId;

  const b = await turn('2턴: 같은 세션에서 문맥 유지', 'What did I just ask you to reply with? One word.');
  // cwd 안의 파일 Read는 기본 규칙상 자동 승인 → 권한 콜백이 오지 않는 게 정상
  const c = await turn('3턴: 자동 승인되는 도구', 'Read package.json and tell me only the "name" field value.');
  const autoApproved = seen.perms.length === 0;

  // Bash는 기본 모드에서 승인이 필요하다 → canUseTool이 불려야 한다
  const d = await turn(
    '4턴: 승인이 필요한 도구',
    'Run this exact bash command and tell me its output: node -e "console.log(6*7)"'
  );

  log('\n---------------- 결과');
  const checks = [
    ['스트리밍 델타 수신', seen.deltas > 0],
    ['1턴 응답에 PONG', /PONG/i.test(a)],
    ['멀티턴 문맥 유지', /PONG/i.test(b)],
    ['세션 id 유지', agent.sessionId === sessionAfterFirst],
    ['도구 호출 발생', seen.tools.length > 0],
    ['파일 내용 반영', /claude-pet/.test(c)],
    ['자동 승인 도구는 안 묻는다', autoApproved],
    ['승인 필요 도구는 권한 콜백 도달', seen.perms.length > 0],
    ['승인 후 도구 실행됨', /42/.test(d)],
    ['에러 없음', seen.errors.length === 0],
  ];

  let ok = true;
  for (const [name, pass] of checks) {
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }

  agent.stop();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('\n테스트 실패:', err);
  agent.stop();
  process.exit(1);
});
