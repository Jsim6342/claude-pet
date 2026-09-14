'use strict';
/**
 * Job Object 검증.
 *
 *   부모(mode=parent) : job 생성 → 오래 사는 자식 spawn → job에 assign → 대기
 *   드라이버(기본)     : 부모를 띄우고, 부모만 /F 로 강제 종료한 뒤
 *                       자식이 저절로 죽었는지 확인한다.
 *
 * 부모를 죽일 때 taskkill /T 를 쓰면 안 된다. /T 는 트리를 직접 죽이므로
 * "job 덕분에 죽은 것"인지 구분할 수 없게 된다.
 *
 *   node tools/test-job.js            > logs/job-node.log 2>&1
 *   npx electron tools/test-job.js    > logs/job-electron.log 2>&1
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const STATE = path.join(os.tmpdir(), 'claude-pet-jobtest.json');
const isElectron = Boolean(process.versions.electron);
const runtime = isElectron ? 'electron' : 'node';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/* ------------------------------------------------------------------ 부모 역할 */

if (process.argv.includes('--parent')) {
  const job = require('../src/main/job-object');
  const created = job.create();

  // 가만히 오래 사는 자식. 전용 프로세스라 다른 걸 건드릴 위험이 없다.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  const assigned = job.assign(child.pid);
  fs.writeFileSync(
    STATE,
    JSON.stringify({ created, assigned, status: job.status(), parentPid: process.pid, childPid: child.pid })
  );

  setInterval(() => {}, 1000); // 드라이버가 죽일 때까지 대기
  return;
}

/* ---------------------------------------------------------------- 드라이버 역할 */

(async () => {
  const log = (...a) => console.log(...a);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];

  log(`런타임: ${runtime} (${process.execPath})`);
  fs.rmSync(STATE, { force: true });

  const parent = spawn(process.execPath, [__filename, '--parent'], {
    stdio: 'ignore',
    detached: false,
  });

  // 부모가 상태 파일을 쓸 때까지 기다린다
  let state = null;
  for (let i = 0; i < 60 && !state; i++) {
    await wait(250);
    try {
      state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    } catch {
      /* 아직 */
    }
  }

  if (!state) {
    log('FAIL  부모가 상태를 기록하지 못했습니다');
    try {
      process.kill(parent.pid);
    } catch {
      /* 무시 */
    }
    process.exit(1);
  }

  log(`job 생성: ${state.created}  assign: ${state.assigned}  status: ${JSON.stringify(state.status)}`);
  log(`부모 PID ${state.parentPid} / 자식 PID ${state.childPid}`);

  checks.push(['job 생성 성공', state.created === true]);
  checks.push(['자식을 job에 넣음', state.assigned === true]);
  checks.push(['자식이 살아있다', alive(state.childPid)]);

  // 부모만 강제 종료. /T 없음 — job이 정리하는지 보려는 것이므로.
  log('부모만 강제 종료 (/T 없이)...');
  try {
    execFileSync('taskkill', ['/PID', String(state.parentPid), '/F'], { stdio: 'ignore', windowsHide: true });
  } catch (err) {
    log(`  taskkill 실패: ${err.message}`);
  }

  await wait(2500);

  const parentGone = !alive(state.parentPid);
  const childGone = !alive(state.childPid);
  log(`부모 종료됨: ${parentGone} / 자식 종료됨: ${childGone}`);

  checks.push(['부모가 죽었다', parentGone]);
  checks.push(['부모가 죽자 자식도 커널이 정리했다', childGone]);

  // 혹시 남았으면 PID로만 치운다
  if (!childGone) {
    try {
      execFileSync('taskkill', ['/PID', String(state.childPid), '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      /* 무시 */
    }
  }

  log('\n---------------- 결과');
  let ok = true;
  for (const [name, pass] of checks) {
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }

  fs.rmSync(STATE, { force: true });
  process.exit(ok ? 0 : 1);
})();
