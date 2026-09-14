'use strict';
// 자식 PID 추적이 실제로 동작하는지 확인한다.
// SDK가 ESM이라 child_process.spawn 훅이 안 걸릴 수도 있어서 반드시 실측한다.
//   node tools/test-tracker.js > logs/tracker.txt 2>&1

const path = require('node:path');
const os = require('node:os');

// SDK를 import 하기 전에 훅을 걸어야 한다
const tracker = require('../src/main/child-tracker');
tracker.install({ recordPath: path.join(os.tmpdir(), 'claude-pet-test-pids.json') });

const { Agent } = require('../src/main/agent');
const { resolveClaudeCli } = require('../src/main/cli-path');

const log = (...a) => console.log(...a);
const checks = [];

let resolveTurn;
const agent = new Agent({
  cwd: process.cwd(),
  cliPath: resolveClaudeCli(),
  onEvent: (e) => {
    if (e.type === 'init') log(`  init  session=${e.sessionId.slice(0, 8)}`);
    if (e.type === 'result') resolveTurn?.();
    if (e.type === 'error') log(`  error ${e.message}`);
  },
  onPermission: (req) => agent.resolvePermission(req.id, 'deny'),
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

(async () => {
  log(`내 PID: ${process.pid}`);
  log(`추적 중(시작 전): [${tracker.list().join(', ')}]`);

  const done = new Promise((r) => {
    resolveTurn = r;
  });
  await agent.send('Reply with exactly: PONG');
  await Promise.race([done, new Promise((_, j) => setTimeout(() => j(new Error('타임아웃')), 120000))]);

  const pids = tracker.list();
  log(`추적된 자식 PID: [${pids.join(', ')}]`);
  checks.push(['spawn 훅이 자식 PID를 잡았다', pids.length > 0]);
  checks.push(['잡힌 PID가 실제로 살아있다', pids.length > 0 && pids.every(alive)]);
  checks.push(['내 PID를 자식으로 오인하지 않았다', !pids.includes(process.pid)]);

  const killed = tracker.killTracked();
  log(`종료 요청한 PID: [${killed.join(', ')}]`);
  await new Promise((r) => setTimeout(r, 2500));

  const survivors = killed.filter(alive);
  log(`아직 살아있는 PID: [${survivors.join(', ')}]`);
  checks.push(['PID 단위 종료로 자식이 정리됐다', killed.length > 0 && survivors.length === 0]);
  checks.push(['추적 목록이 비워졌다', tracker.list().length === 0]);

  log('\n---------------- 결과');
  let ok = true;
  for (const [name, pass] of checks) {
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }
  agent.stop();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  log(`\n테스트 실패: ${err.message}`);
  log(`추적된 PID: [${tracker.list().join(', ')}]`);
  tracker.killTracked();
  agent.stop();
  process.exit(1);
});
