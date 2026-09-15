'use strict';
// 진단용: 말풍선/캐릭터 렌더러를 띄워 콘솔 오류를 그대로 찍는다.
//   npx electron tools/check-renderer.js

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  for (const [name, file, preload] of [
    ['bubble', 'bubble.html', 'preload-bubble.js'],
    ['pet', 'pet.html', 'preload-pet.js'],
  ]) {
    const win = new BrowserWindow({
      width: 420,
      height: 360,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'main', preload),
        contextIsolation: true,
      },
    });

    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') {
        console.log(`[${name}:${e.level}] ${e.message}  (${e.sourceId}:${e.lineNumber})`);
      }
    });
    win.webContents.on('render-process-gone', (_e, d) => console.log(`[${name}] 렌더러 죽음: ${d.reason}`));

    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', file));
    await new Promise((r) => setTimeout(r, 900));

    // 스크립트가 끝까지 돌았는지: 주요 DOM 요소가 준비됐는지로 확인
    const probe =
      name === 'bubble'
        ? `(() => {
             const m = document.getElementById('btn-mode');
             return JSON.stringify({
               modeLabel: m?.textContent, modeAttr: m?.dataset.mode,
               attachmentsHidden: document.getElementById('attachments')?.hidden,
               emptyState: Boolean(document.querySelector('.empty')),
             });
           })()`
        : `JSON.stringify({ stageClass: document.getElementById('stage')?.getAttribute('class') })`;

    console.log(`[${name}] ${await win.webContents.executeJavaScript(probe)}`);
    win.destroy();
    // 창을 부순 직후 바로 다음 창을 만들면 로드가 취소되는 일이 있다
    await new Promise((r) => setTimeout(r, 400));
  }

  app.exit(0);
});
