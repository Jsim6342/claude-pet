'use strict';

const { app } = require('electron');

/**
 * GitHub Releases에서 새 버전을 받아 다음 실행 때 적용한다.
 *
 * 코드가 exe에 실시간으로 스며드는 건 아니다. 여전히 `npm run dist` 로 빌드해서
 * Release에 올려야 하고, 이 모듈은 "받아서 깔아주는" 단계만 자동화한다.
 *
 * package.json 의 build.publish 에 owner가 채워져 있을 때만 동작한다.
 * 개발 중(`npm start`)에는 항상 꺼진다 — 설치본이 아니면 업데이트할 대상이 없다.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간

let updater = null;
let state = { enabled: false, reason: null, status: 'idle', version: null };
let notify = () => {};
let timer = null;

function publishTarget() {
  try {
    const build = require('../../package.json').build;
    const entry = Array.isArray(build?.publish) ? build.publish[0] : build?.publish;
    if (!entry || entry.provider !== 'github') return null;
    if (!entry.owner || entry.owner.startsWith('<')) return null; // 아직 안 채운 자리표시자
    return entry;
  } catch {
    return null;
  }
}

/**
 * @param {(info: {status: string, version?: string, message?: string}) => void} onStatus
 */
function start(onStatus = () => {}) {
  notify = onStatus;

  if (!app.isPackaged) {
    state = { enabled: false, reason: '개발 모드에서는 사용하지 않음', status: 'disabled', version: null };
    return state;
  }

  const target = publishTarget();
  if (!target) {
    state = { enabled: false, reason: 'build.publish 설정이 비어 있음', status: 'disabled', version: null };
    return state;
  }

  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (err) {
    state = { enabled: false, reason: String(err?.message || err), status: 'disabled', version: null };
    return state;
  }

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true; // 조용히 받아두고 다음 실행 때 적용
  updater.logger = null;

  updater.on('update-available', (info) => {
    state.status = 'downloading';
    state.version = info?.version || null;
    notify({ status: 'downloading', version: state.version });
  });

  updater.on('update-not-available', () => {
    state.status = 'latest';
    notify({ status: 'latest' });
  });

  updater.on('update-downloaded', (info) => {
    state.status = 'ready';
    state.version = info?.version || null;
    notify({ status: 'ready', version: state.version });
  });

  updater.on('error', (err) => {
    state.status = 'error';
    // 네트워크가 없거나 Release가 아직 없을 때도 여기로 온다 — 조용히 넘긴다
    notify({ status: 'error', message: String(err?.message || err) });
  });

  state = { enabled: true, reason: null, status: 'idle', version: null };
  check();
  timer = setInterval(check, CHECK_INTERVAL_MS);
  return state;
}

function check() {
  if (!updater) return;
  updater.checkForUpdates().catch(() => {
    /* 에러는 위 이벤트에서 처리한다 */
  });
}

/** 받아둔 업데이트가 있으면 지금 적용하고 재시작한다. */
function installNow() {
  if (updater && state.status === 'ready') {
    updater.quitAndInstall();
    return true;
  }
  return false;
}

function stop() {
  clearInterval(timer);
  timer = null;
}

function status() {
  return { ...state };
}

module.exports = { start, check, installNow, stop, status };
