'use strict';
// 개발용: HTML 파일을 실제로 렌더링해 화면 단위로 캡처한다.
//   npx electron tools/render-page.js <파일명> [출력폴더명]

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const W = 1100;
const H = 900;

const target = process.argv.find((a) => a.endsWith('.html')) || '사용설명서.html';
const outName = process.argv[process.argv.indexOf(target) + 1] || path.parse(target).name;
const OUT = path.join(__dirname, '..', 'shots', outName);

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({ width: W, height: H, show: false });
  await win.loadFile(path.join(__dirname, '..', target));
  await new Promise((r) => setTimeout(r, 1200));

  const total = await win.webContents.executeJavaScript('document.body.scrollHeight');
  const pages = Math.ceil(total / H);
  console.log(`${target}: 높이 ${total}px → ${pages}장`);

  for (let i = 0; i < pages; i++) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${i * H})`);
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `p${String(i + 1).padStart(2, '0')}.png`), img.toPNG());
  }

  console.log('저장:', OUT);
  app.exit(0);
});
