'use strict';
// 지난 대화 목록 패널 UI 검증: 가짜 목록을 물려주고 버튼을 눌러
// 목록이 그려지는지 / 고르면 이어받기 요청이 나가는지 확인한다.
//   npx electron tools/probe-sessions.js

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

// PET_SHOT=1 이면 펼친 목록을 logs/sessions.png 로 찍어 눈으로 확인할 수 있다.
const SHOT = Boolean(process.env.PET_SHOT);

const DAY = 86400000;
const now = Date.now();

const FAKE = {
  currentId: 'aaaaaaaa-0000-0000-0000-000000000001',
  items: [
    { sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', title: '지금 보고 있는 대화', lastModified: now - 60000, cwd: 'D:\\tmp', gitBranch: 'main' },
    { sessionId: 'bbbbbbbb-0000-0000-0000-000000000002', title: '어제 하던 리팩터링', lastModified: now - DAY, cwd: 'D:\\tmp', gitBranch: null },
    { sessionId: 'cccccccc-0000-0000-0000-000000000003', title: '', lastModified: now - 30 * DAY, cwd: 'D:\\tmp', gitBranch: 'fix/ui' },
  ],
};

const resumed = [];

ipcMain.handle('chat:list-sessions', () => FAKE);
ipcMain.on('chat:resume-session', (_e, payload) => resumed.push(payload));

const $ = (js) => js;

// hidden 프로퍼티만 보면 CSS 가 display 를 덮어써도 통과해 버린다.
// 실제로 레이아웃에서 빠졌는지(offsetParent)를 본다.
const GONE = (id) => `document.getElementById('${id}').offsetParent === null`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400,
    height: 320,
    show: SHOT,
    transparent: SHOT,
    frame: !SHOT,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload-bubble.js'),
      contextIsolation: true,
    },
  });

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') {
      console.log(`[bubble:${e.level}] ${e.message}  (${e.sourceId}:${e.lineNumber})`);
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'bubble.html'));
  await new Promise((r) => setTimeout(r, 600));

  const run = (js) => win.webContents.executeJavaScript(js);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const closedFirst = await run(GONE('sessions'));
  const chipsGone = await run(GONE('attachments'));

  await run($(`document.getElementById('btn-history').click()`));
  await wait(400);

  const opened = JSON.parse(
    await run(
      $(`JSON.stringify({
        shown: document.getElementById('sessions').offsetParent !== null,
        btnOn: document.getElementById('btn-history').classList.contains('on'),
        rows: [...document.querySelectorAll('.session')].map((el) => ({
          title: el.querySelector('.title').textContent,
          meta: el.querySelector('.meta').textContent,
          current: el.classList.contains('current'),
        })),
        covers: (() => {
          const p = document.getElementById('sessions').getBoundingClientRect();
          const l = document.getElementById('log').getBoundingClientRect();
          return p.width >= l.width - 1 && p.height >= l.height - 1;
        })(),
      })`)
    )
  );

  console.log('[열림]', JSON.stringify(opened, null, 1));

  if (SHOT) {
    const out = path.join(__dirname, '..', 'logs', 'sessions.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, (await win.capturePage()).toPNG());
    console.log(`[shot] ${out}`);
  }

  // 지금 보고 있는 대화를 고르면 이어받기를 보내지 않고 닫기만 해야 한다
  await run($(`document.querySelectorAll('.session')[0].click()`));
  await wait(200);
  const afterSame = await run(GONE('sessions'));
  const resumedAfterSame = resumed.length; // 아래에서 더 클릭하므로 여기서 세어 둔다

  // 다른 대화를 고르면 이어받기 요청이 나가야 한다
  await run($(`document.getElementById('btn-history').click()`));
  await wait(400);
  await run($(`document.querySelectorAll('.session')[1].click()`));
  await wait(200);

  // Esc 는 창을 닫기 전에 목록부터 닫는다
  await run($(`document.getElementById('btn-history').click()`));
  await wait(400);
  await run($(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`));
  await wait(150);
  const afterEsc = await run(GONE('sessions'));

  const checks = [
    ['처음엔 목록이 접혀 있다', closedFirst === true],
    ['첨부 줄도 비었을 땐 안 보인다', chipsGone === true],
    ['버튼을 누르면 펼쳐진다', opened.shown === true && opened.btnOn === true],
    ['목록이 로그를 덮는다', opened.covers === true],
    ['세 줄이 그려졌다', opened.rows.length === 3],
    ['지금 대화에 표시가 붙는다', opened.rows[0]?.current === true && !opened.rows[1]?.current],
    ['제목이 없으면 대신 문구가 나온다', opened.rows[2]?.title === '(제목 없는 대화)'],
    ['상대 시각이 보인다', /분 전/.test(opened.rows[0]?.meta || '') && /어제/.test(opened.rows[1]?.meta || '')],
    ['브랜치가 같이 보인다', /main/.test(opened.rows[0]?.meta || '')],
    ['오래된 것은 날짜로 보인다', /\d+\.\d+\.\d+/.test(opened.rows[2]?.meta || '')],
    ['지금 대화를 고르면 닫히기만 한다', afterSame === true && resumedAfterSame === 0],
    ['다른 대화를 고르면 이어받기를 보낸다', resumed.length === 1 && resumed[0].sessionId.startsWith('bbbbbbbb')],
    ['이어받을 폴더도 같이 보낸다', resumed[0]?.cwd === 'D:\\tmp'],
    ['Esc 로 목록만 닫힌다', afterEsc === true],
  ];

  console.log('\n---------------- 결과');
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }

  win.destroy();
  app.exit(ok ? 0 : 1);
});
