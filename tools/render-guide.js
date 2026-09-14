'use strict';
// 개발용: 사용설명서.html 을 실제로 렌더링해서 화면 단위로 캡처한다.
//   npx electron tools/render-guide.js

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', 'shots', 'guide');
const W = 1100;
const H = 900;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: false } });
  await win.loadFile(path.join(__dirname, '..', '사용설명서.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const total = await win.webContents.executeJavaScript('document.body.scrollHeight');
  const pages = Math.ceil(total / H);
  console.log(`문서 높이 ${total}px → ${pages}장`);

  for (let i = 0; i < pages; i++) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${i * H})`);
    await new Promise((r) => setTimeout(r, 450));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `p${String(i + 1).padStart(2, '0')}.png`), img.toPNG());
  }

  console.log('저장:', OUT);
  app.exit(0);
});
