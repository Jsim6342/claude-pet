'use strict';

const path = require('node:path');
const os = require('node:os');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  screen,
  dialog,
  shell,
  globalShortcut,
} = require('electron');

// Agent SDK가 claude.exe를 띄우기 전에 훅을 걸어야 자식 PID를 놓치지 않는다.
const childTracker = require('./child-tracker');
childTracker.install();

const store = require('./store');
const { Agent } = require('./agent');
const { Walker } = require('./walker');
const { makeTrayIcon } = require('./tray-icon');
const { resolveClaudeCli } = require('./cli-path');
const updater = require('./updater');

const PET_SIZE = 128;
const BUBBLE_W = 400;
const BUBBLE_H = 320;
const BUBBLE_GAP = 8;

let petWin = null;
let bubbleWin = null;
let tray = null;
let walker = null;
let agent = null;
let dragTimer = null;
let grabOffset = { x: 0, y: 0 };
let cliPath = null;
let lastAnswer = ''; // 알림 본문에 쓸 직전 답변

const CLI_MISSING =
  'Claude Code CLI를 찾지 못했어요. 설치한 뒤 앱을 다시 켜주세요. ' +
  '이미 설치돼 있다면 CLAUDE_PET_CLI 환경변수에 claude.exe 경로를 넣어주세요.';

/** 배포본에 CLI를 같이 넣은 경우 먼저 확인할 자리들. */
function packagedCliCandidates() {
  if (!app.isPackaged) return [];
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  return [
    path.join(process.resourcesPath, 'cli', exe),
    path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      `claude-agent-sdk-${process.platform}-${process.arch}`,
      exe
    ),
  ];
}

/* ------------------------------------------------------------------ 창 만들기 */

function workArea() {
  // 캐릭터가 있는 디스플레이를 기준으로 삼는다(멀티 모니터 대응).
  const point = petWin ? centerOf(petWin.getBounds()) : screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point).workArea;
}

function centerOf(bounds) {
  return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
}

function createPetWindow() {
  petWin = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 캐릭터를 클릭해도 작업 중인 창의 포커스를 빼앗지 않는다
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 전체화면 영상이나 게임 위에서도 밀리지 않는 레벨
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // 기본은 "클릭 통과". forward:true 덕분에 마우스 이동은 계속 렌더러로 전달되므로,
  // 렌더러가 커서가 캐릭터 픽셀 위에 있다고 알려줄 때만 입력을 받도록 전환한다.
  petWin.setIgnoreMouseEvents(true, { forward: true });

  pipeConsole(petWin, 'pet');
  petWin.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
}

function createBubbleWindow() {
  bubbleWin = new BrowserWindow({
    width: BUBBLE_W,
    height: BUBBLE_H,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-bubble.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  bubbleWin.setAlwaysOnTop(true, 'screen-saver');
  pipeConsole(bubbleWin, 'bubble');
  bubbleWin.loadFile(path.join(__dirname, '..', 'renderer', 'bubble.html'));

  // 렌더러가 준비되기 전에 보낸 메시지는 유실되므로 여기서 한 번 더 채운다
  bubbleWin.webContents.on('did-finish-load', () => {
    if (agent) {
      send(bubbleWin, 'chat:session', { cwd: agent.cwd, sessionId: agent.sessionId });
      loadHistoryIntoBubble();
    }
  });

  // 외부 링크는 기본 브라우저로
  bubbleWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------- 말풍선 위치/토글 */

function positionBubble() {
  if (!bubbleWin || !petWin) return;
  const pet = petWin.getBounds();
  const area = workArea();

  let x = Math.round(pet.x + pet.width / 2 - BUBBLE_W / 2);
  x = Math.min(Math.max(x, area.x + 4), area.x + area.width - BUBBLE_W - 4);

  // 기본은 캐릭터 위. 위쪽 공간이 부족하면 아래에 붙인다.
  let y = pet.y - BUBBLE_H + BUBBLE_GAP;
  let tail = 'bottom';
  if (y < area.y + 4) {
    y = pet.y + pet.height - BUBBLE_GAP;
    tail = 'top';
  }

  bubbleWin.setBounds({ x, y, width: BUBBLE_W, height: BUBBLE_H });

  // 말풍선 꼬리가 캐릭터를 가리키도록 렌더러에 위치를 알려준다.
  const tailX = Math.round(pet.x + pet.width / 2 - x);
  send(bubbleWin, 'chat:anchor', { tail, tailX });
}

function openBubble() {
  if (!bubbleWin) return;
  positionBubble();
  bubbleWin.show();
  bubbleWin.focus();
  walker?.setFrozen(true);
  send(petWin, 'pet:clear-notify');
  send(bubbleWin, 'chat:focus-input');
}

/**
 * 답이 다 나왔는데 말풍선이 닫혀 있으면 알려준다.
 * 캐릭터가 폴짝 뛰며 뱃지를 띄우고, 윈도우 알림도 같이 보낸다.
 */
function notifyAnswerReady() {
  if (bubbleWin?.isVisible()) return;

  send(petWin, 'pet:notify');

  if (!Notification.isSupported()) return;
  const body = lastAnswer.trim().replace(/\s+/g, ' ').slice(0, 140);
  const notification = new Notification({
    title: 'Claude Pet — 답변이 준비됐어요',
    body: body || '말풍선을 열어 확인해 주세요.',
    silent: false,
  });
  notification.on('click', openBubble);
  notification.show();
}

function closeBubble() {
  if (!bubbleWin) return;
  bubbleWin.hide();
  walker?.setFrozen(false);
}

function toggleBubble() {
  if (bubbleWin?.isVisible()) closeBubble();
  else openBubble();
}

function send(win, channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** PET_DEBUG=1 로 실행하면 렌더러 콘솔을 터미널에서 볼 수 있게 한다. */
function pipeConsole(win, label) {
  if (!process.env.PET_DEBUG) return;
  win.webContents.on('console-message', (event) => {
    console.log(`[${label}:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
}

/* --------------------------------------------------------------------- 에이전트 */

function createAgent(cwd) {
  agent?.stop();

  agent = new Agent({
    cwd,
    cliPath,
    onEvent: (event) => {
      if (event.type === 'init') {
        store.set('lastSessionId', event.sessionId);
        send(bubbleWin, 'chat:session', {
          cwd: event.cwd,
          model: event.model,
          version: event.version,
          sessionId: event.sessionId,
        });
        return;
      }

      if (event.type === 'busy') {
        walker?.setBusy(event.busy);
      }

      // 알림 본문으로 쓰려고 답변 본문을 모아둔다
      if (event.type === 'text-start') lastAnswer = '';
      if (event.type === 'delta') lastAnswer += event.text;

      if (event.type === 'result') {
        store.set('lastSessionId', event.sessionId);
        if (!event.isError) notifyAnswerReady();
      }

      if (event.type === 'resume-failed') {
        store.set('lastSessionId', null);
        agent.sessionId = null;
        send(bubbleWin, 'chat:notice', { text: '이전 대화를 이어받지 못해서 새 대화로 시작할게요.' });
        if (event.text) agent.send(event.text);
        return;
      }

      send(bubbleWin, 'chat:event', event);
    },
    onPermission: (request) => {
      send(bubbleWin, 'chat:permission', request);
      openBubble(); // 승인 요청이 오면 말풍선을 자동으로 띄운다
    },
  });

  // 같은 폴더였다면 지난 대화를 이어받는다.
  if (store.get('cwd') === cwd) {
    agent.sessionId = store.get('lastSessionId') || null;
  } else {
    store.set('lastSessionId', null);
  }
  store.set('cwd', cwd);

  send(bubbleWin, 'chat:session', { cwd, model: null, version: null, sessionId: agent.sessionId });
  loadHistoryIntoBubble();
}

/** 이어받은 세션이 있으면 지난 대화를 말풍선에 먼저 깔아둔다. */
async function loadHistoryIntoBubble() {
  if (!agent?.sessionId) return;
  const target = agent;
  const items = await agent.loadHistory();
  // 불러오는 동안 세션이 바뀌었으면 버린다
  if (agent !== target || !items.length) return;
  send(bubbleWin, 'chat:history', { items });
}

async function pickCwd() {
  const result = await dialog.showOpenDialog({
    title: '작업 폴더 선택',
    defaultPath: agent?.cwd || os.homedir(),
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return;

  createAgent(result.filePaths[0]);
  send(bubbleWin, 'chat:reset', { reason: `작업 폴더를 ${result.filePaths[0]} 로 바꿨어요.` });
}

function newSession() {
  const cwd = agent?.cwd || os.homedir();
  store.set('lastSessionId', null);
  createAgent(cwd);
  send(bubbleWin, 'chat:reset', { reason: '새 대화를 시작했어요.' });
}

/* ------------------------------------------------------------------ 트레이 메뉴 */

function buildTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Claude Pet');
  refreshTrayMenu();
  tray.on('click', toggleBubble);
}

/** 업데이트 상태에 따라 트레이 메뉴 한 줄을 만든다. */
function updateMenuItem() {
  const info = updater.status();

  if (!info.enabled) {
    return { label: `업데이트: ${info.reason || '꺼짐'}`, enabled: false };
  }
  if (info.status === 'ready') {
    return {
      label: `새 버전 ${info.version} 적용하고 재시작`,
      click: () => updater.installNow(),
    };
  }
  if (info.status === 'downloading') {
    return { label: `새 버전 ${info.version} 받는 중…`, enabled: false };
  }
  return { label: '업데이트 확인', click: () => updater.check() };
}

function refreshTrayMenu() {
  const menu = Menu.buildFromTemplate([
    { label: '말풍선 열기  (Ctrl+Shift+Space)', click: openBubble },
    { type: 'separator' },
    { label: `작업 폴더: ${agent?.cwd || '-'}`, enabled: false },
    { label: '작업 폴더 변경…', click: pickCwd },
    { label: '새 대화 시작', click: newSession },
    { type: 'separator' },
    updateMenuItem(),
    {
      label: '윈도우 시작 시 실행',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

/* ---------------------------------------------------------------------- IPC */

function wireIpc() {
  // --- 캐릭터 조작
  ipcMain.on('pet:click', toggleBubble);

  ipcMain.on('pet:hover', (_e, over) => {
    if (dragTimer) return; // 드래그 중에는 절대 통과 모드로 돌아가지 않는다
    petWin?.setIgnoreMouseEvents(!over, { forward: true });
  });

  ipcMain.on('pet:drag-start', () => {
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWin.getBounds();
    grabOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    walker.beginDrag();

    clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      walker.dragTo(p.x - grabOffset.x, p.y - grabOffset.y);
      if (bubbleWin?.isVisible()) positionBubble();
    }, 16);
  });

  ipcMain.on('pet:drag-end', () => {
    clearInterval(dragTimer);
    dragTimer = null;
    walker.endDrag();
  });

  ipcMain.on('pet:context-menu', () => tray?.popUpContextMenu());

  // --- 말풍선
  ipcMain.on('chat:send', (_e, text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    if (!cliPath) {
      send(bubbleWin, 'chat:event', { type: 'error', message: CLI_MISSING });
      return;
    }
    agent.send(trimmed).catch((err) => {
      send(bubbleWin, 'chat:event', { type: 'error', message: String(err?.message || err) });
    });
  });

  ipcMain.on('chat:stop', () => agent?.interrupt());
  ipcMain.on('chat:close', closeBubble);
  ipcMain.on('chat:new-session', newSession);
  ipcMain.on('chat:pick-cwd', pickCwd);
  ipcMain.on('chat:permission', (_e, { id, decision }) => agent?.resolvePermission(id, decision));
  ipcMain.on('chat:open-external', (_e, url) => {
    if (/^https?:\/\//.test(String(url))) shell.openExternal(url);
  });
}

/* --------------------------------------------------------------------- 부트 */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openBubble);

  app.whenReady().then(() => {
    // 윈도우 알림이 앱 이름으로 제대로 뜨려면 필요하다
    app.setAppUserModelId('com.jsb.claude-pet');

    createPetWindow();
    createBubbleWindow();
    wireIpc();

    // 지난 실행이 강제 종료돼 남긴 자식이 있으면 PID로만 거둬들인다
    childTracker.setRecordPath(path.join(app.getPath('userData'), 'child-pids.json'));
    const reaped = childTracker.reapStale();
    if (reaped.length && process.env.PET_DEBUG) console.log('[reap]', reaped.join(', '));

    cliPath = resolveClaudeCli(packagedCliCandidates());
    if (process.env.PET_DEBUG) console.log('[cli]', cliPath || '못 찾음');
    if (!cliPath) {
      bubbleWin.webContents.once('did-finish-load', () =>
        send(bubbleWin, 'chat:notice', { text: CLI_MISSING })
      );
    }

    walker = new Walker({
      size: PET_SIZE,
      getArea: workArea,
      onMove: (x, y) => {
        if (petWin && !petWin.isDestroyed()) petWin.setPosition(x, y);
      },
      onState: (state) => send(petWin, 'pet:state', state),
    });

    petWin.webContents.once('did-finish-load', () => walker.start());

    createAgent(store.get('cwd') || os.homedir());
    buildTray();

    if (process.env.PET_SELFTEST) require('./selftest')({ cliPath, agent, childTracker });

    globalShortcut.register('Control+Shift+Space', toggleBubble);

    updater.start((info) => {
      if (info.status === 'ready') {
        send(bubbleWin, 'chat:notice', {
          text: `새 버전 ${info.version} 을 받아뒀어요. 다음에 켤 때 적용됩니다.`,
        });
      }
      refreshTrayMenu();
    });

    // 해상도나 모니터 구성이 바뀌면 캐릭터를 다시 바닥으로 떨어뜨린다.
    screen.on('display-metrics-changed', () => walker?.endDrag());

    if (process.env.PET_SHOT) require('../../tools/shot')({ petWin, bubbleWin, openBubble, send });
  });

  app.on('window-all-closed', () => {
    /* 트레이 앱이므로 창이 다 닫혀도 종료하지 않는다 */
  });

  // 종료 시: SDK에 정상 종료를 먼저 부탁하고, 잠깐 기다렸다가
  // 그래도 남아 있는 자식을 기록해 둔 PID로만 정리한다.
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;

    clearInterval(dragTimer);
    walker?.stop();
    updater.stop();

    // 입력만 닫아 CLI가 대화 기록을 flush하고 스스로 나가게 둔다.
    // 그래도 안 죽으면 기록해 둔 PID로만 정리한다.
    agent?.stop({ force: false });

    setTimeout(() => {
      agent?.stop();
      childTracker.killTracked();
      app.quit();
    }, 800);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
