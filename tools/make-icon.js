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
      <stop offset="0" stop-color="#9CCEF0"/>
      <stop offset="1" stop-color="#C9E8FB"/>
    </linearGradient>
  </defs>

  <path d="M 95 33 C 96 22 101 16 107 17 C 112 22 112 30 107 36 Z" fill="#7BB0D8"/>
  <circle cx="86" cy="52" r="27" fill="url(#fur)"/>
  <path d="M 70 34 C 70 22 74 14 80 14 C 86 18 90 26 90 34 Z" fill="url(#fur)"/>

  <ellipse cx="68" cy="58" rx="6" ry="3.4" fill="#74AED4" opacity=".34"/>
  <ellipse cx="104" cy="58" rx="6" ry="3.4" fill="#74AED4" opacity=".34"/>

  <g fill="none" stroke="#2F4A5C" stroke-linecap="round">
    <path d="M 72 48 q 5.5 6 11 0" stroke-width="3"/>
    <path d="M 92 48 q 5.5 6 11 0" stroke-width="3"/>
    <path d="M 82 60 q 3.5 4 7 0 q 3.5 4 7 0" stroke-width="2.4" stroke-linejoin="round"/>
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
