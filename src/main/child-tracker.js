'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const jobObject = require('./job-object');

/**
 * Agent SDK가 띄우는 claude.exe 자식 프로세스를 "생성 시점에 PID로" 기록하고,
 * 종료할 때 그 PID 목록만 정리한다.
 *
 * 이미지 이름(taskkill /IM claude.exe)으로는 절대 죽이지 않는다.
 * 사용자의 Claude Code 세션 자체가 claude.exe라서, 이름으로 죽이면
 * 관계없는 남의 세션까지 전부 끊어버린다.
 *
 * 기록은 파일에도 남긴다. 앱이 강제 종료(작업 관리자 등)되면 정리 코드가
 * 돌지 못하므로, 다음 실행 때 그 파일을 보고 남은 것을 거둬들인다.
 */

const tracked = new Map(); // pid -> { command, startedAt }
let recordPath = null;
let installed = false;

function isClaudeCli(command) {
  const base = path.basename(String(command || '')).toLowerCase();
  return base === 'claude' || base === 'claude.exe';
}

/**
 * 기록 파일 위치는 app이 ready된 뒤에야 알 수 있으므로 나중에 지정할 수 있게 한다.
 * (spawn 훅 자체는 install()에서 바로 걸린다)
 */
function setRecordPath(p) {
  recordPath = p;
  persist();
}

/** SDK를 import 하기 전에 호출해야 한다. */
function install(options = {}) {
  if (installed) return;
  installed = true;
  recordPath = options.recordPath || null;

  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function patchedSpawn(command, ...rest) {
    const child = originalSpawn.call(this, command, ...rest);
    try {
      if (child && child.pid && isClaudeCli(command)) {
        track(child.pid, String(command));
        child.once('exit', () => untrack(child.pid));
      }
    } catch {
      /* 추적 실패가 앱 동작을 막지는 않게 한다 */
    }
    return child;
  };
}

function track(pid, command) {
  // Job Object에 넣어두면 우리가 강제 종료돼도 커널이 자식을 같이 정리한다.
  // 실패하면(FFI 불가 등) 아래 PID 기록만으로 동작한다.
  const inJob = jobObject.assign(pid);
  tracked.set(pid, { command, startedAt: Date.now(), inJob });
  persist();
}

function untrack(pid) {
  if (tracked.delete(pid)) persist();
}

function persist() {
  if (!recordPath) return;
  try {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(
      recordPath,
      JSON.stringify({ ownerPid: process.pid, pids: [...tracked.keys()] }, null, 2)
    );
  } catch {
    /* 기록 실패는 치명적이지 않다 */
  }
}

function list() {
  return [...tracked.keys()];
}

/** 진단용: 지금 어떤 보호가 걸려 있는지. */
function status() {
  return {
    job: jobObject.status(),
    tracked: [...tracked.entries()].map(([pid, info]) => ({ pid, inJob: info.inJob })),
  };
}

/** PID 하나를 자식까지 포함해 종료한다. 이름 기반 종료는 쓰지 않는다. */
function killPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      childProcess.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false; // 이미 죽었으면 여기로 온다 — 정상
  }
}

/** 지금 추적 중인 자식들을 정리한다. */
function killTracked() {
  const pids = list();
  for (const pid of pids) killPid(pid);
  tracked.clear();
  persist();
  return pids;
}

/**
 * 이전 실행이 강제 종료되어 남겨둔 PID를 거둬들인다.
 * 기록 파일의 ownerPid가 지금 살아있는 다른 인스턴스면 건드리지 않는다.
 */
function reapStale() {
  if (!recordPath) return [];
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch {
    return [];
  }

  if (!Array.isArray(saved.pids) || saved.pids.length === 0) return [];
  if (saved.ownerPid && saved.ownerPid !== process.pid && isAlive(saved.ownerPid)) return [];

  const killed = saved.pids.filter((pid) => isAlive(pid) && killPid(pid));
  try {
    fs.writeFileSync(recordPath, JSON.stringify({ ownerPid: process.pid, pids: [] }, null, 2));
  } catch {
    /* 무시 */
  }
  return killed;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // 살아는 있는데 권한이 없는 경우
  }
}

module.exports = { install, setRecordPath, list, status, killTracked, reapStale, killPid };
