'use strict';
// 개발용: 캐릭터 SVG를 앱 아이콘용 512px PNG로 뽑는다.
// electron-builder가 이 png를 .ico 로 변환해 준다.
//   npx electron tools/make-icon.js

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const OUT = path.join(__dirname, '..', 'build');

// 아이콘은 그림자 없이, 캐릭터가 캔버스를 꽉 채우게 다시 배치한다.
const HTML = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;background:transparent;overflow:hidden}
  svg{display:block;width:${SIZE}px;height:${SIZE}px}
  *{transform-box:fill-box}
</style>
<!-- 캐릭터 전체(귀~꼬리 x26~118, 더듬이~발 y23~124)가 들어가는 정사각 영역 -->
<svg viewBox="16 17 112 112">
  <path d="M 96 92 C 110 92 118 82 113 70" fill="none" stroke="#D97757" stroke-width="8" stroke-linecap="round"/>
  <ellipse cx="38" cy="44" rx="12" ry="14.5" fill="#D97757"/>
  <ellipse cx="90" cy="44" rx="12" ry="14.5" fill="#D97757"/>
  <path d="M 64 48 C 62 39 66 33 69 30" fill="none" stroke="#BF6040" stroke-width="3.4" stroke-linecap="round"/>
  <circle cx="70" cy="28" r="5" fill="#F2A98F"/>
  <rect x="44" y="102" width="15" height="22" rx="7.5" fill="#A8512F"/>
  <rect x="69" y="102" width="15" height="22" rx="7.5" fill="#A8512F"/>
  <ellipse cx="64" cy="78" rx="36" ry="33" fill="#D97757"/>
  <ellipse cx="64" cy="88" rx="23" ry="19" fill="#FBF0E8" opacity=".92"/>
  <ellipse cx="40" cy="84" rx="7.5" ry="4.4" fill="#E26D5C" opacity=".42"/>
  <ellipse cx="88" cy="84" rx="7.5" ry="4.4" fill="#E26D5C" opacity=".42"/>
  <ellipse cx="52" cy="74" rx="5" ry="6.6" fill="#2F241F"/>
  <circle cx="53.6" cy="71.4" r="1.9" fill="#fff" opacity=".9"/>
  <ellipse cx="76" cy="74" rx="5" ry="6.6" fill="#2F241F"/>
  <circle cx="77.6" cy="71.4" r="1.9" fill="#fff" opacity=".9"/>
  <path d="M 58 89 q 6 5.5 12 0" fill="none" stroke="#2F241F" stroke-width="2.6" stroke-linecap="round"/>
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
  app.exit(width >= 256 ? 0 : 1);
});
