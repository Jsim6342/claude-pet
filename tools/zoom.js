'use strict';
// 개발용: 이미지를 확대해서 저장한다(레퍼런스 디테일 확인용).
//   npx electron tools/zoom.js <입력> <배율> [출력]

const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');

app.whenReady().then(() => {
  const input = process.argv[2];
  const scale = Number(process.argv[3] || 4);
  const output = process.argv[4] || path.join(__dirname, '..', 'shots', 'zoom.png');

  const img = nativeImage.createFromPath(input);
  const { width, height } = img.getSize();
  const big = img.resize({ width: width * scale, height: height * scale, quality: 'best' });

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, big.toPNG());
  console.log(`${width}x${height} → ${width * scale}x${height * scale}  ${output}`);
  app.exit(0);
});
