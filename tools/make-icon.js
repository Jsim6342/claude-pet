'use strict';
// 개발용: 캐릭터 얼굴을 앱 아이콘용 512px PNG로 뽑는다.
// electron-builder가 이 png를 .ico 로 변환해 준다.
// 전신은 작업표시줄 크기에서 뭉개져서, 아이콘은 얼굴만 쓴다.
//   npx electron tools/make-icon.js

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const OUT = path.join(__dirname, '..', 'build');

// pet.html 의 머리 부분과 같은 좌표. 얼굴이 꽉 차게 viewBox만 좁혔다.
const HTML = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:transparent;overflow:hidden}
  svg{display:block;width:${SIZE}px;height:${SIZE}px}
</style>
<svg viewBox="50 4 74 74">
  <defs>
    <linearGradient id="fur" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="82">
      <stop offset="0" stop-color="#A2D1EF"/>
      <stop offset="1" stop-color="#C4E5FA"/>
    </linearGradient>
  </defs>

  <path d="M 96 32 C 97 21 102 15 108 16 C 113 21 113 29 108 35 Z" fill="#88BEE4"/>
  <circle cx="86" cy="52" r="29" fill="url(#fur)"/>
  <path d="M 68 33 C 68 20 72 12 78 12 C 85 16 89 25 89 33 Z" fill="url(#fur)"/>

  <ellipse cx="66" cy="59" rx="7.5" ry="4.2" fill="#8FC2DF" opacity=".26"/>
  <ellipse cx="105" cy="59" rx="7.5" ry="4.2" fill="#8FC2DF" opacity=".26"/>

  <g fill="none" stroke="#6690A8" stroke-linecap="round">
    <path d="M 71 48 q 5.5 6 11 0" stroke-width="2.8"/>
    <path d="M 91 48 q 5.5 6 11 0" stroke-width="2.8"/>
    <path d="M 81 61 q 3.5 4 7 0 q 3.5 4 7 0" stroke-width="2.2" stroke-linejoin="round"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  await new Promise((r) => setTimeout(r, 600));

  const img = await win.webContents.capturePage();
  const file = path.join(OUT, 'icon.png');
  fs.writeFileSync(file, img.toPNG());

  const { width, height } = img.getSize();
  console.log(`아이콘 저장: ${file} (${width}x${height})`);

  // 트레이 아이콘도 확대해서 저장 — 16pt에서 알아볼 수 있는지 눈으로 확인용
  const { makeTrayIcon } = require('../src/main/tray-icon');
  const tray = makeTrayIcon();
  const t = tray.getSize();
  const trayFile = path.join(__dirname, '..', 'shots', 'tray-8x.png');
  fs.mkdirSync(path.dirname(trayFile), { recursive: true });
  fs.writeFileSync(
    trayFile,
    tray.resize({ width: t.width * 8, height: t.height * 8, quality: 'best' }).toPNG()
  );
  console.log(`트레이 아이콘 확대본: ${trayFile}`);

  app.exit(width >= 256 ? 0 : 1);
});
