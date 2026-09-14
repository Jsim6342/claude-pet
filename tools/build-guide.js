'use strict';
// tools/guide.template.html 의 __IMG_*__ 자리에 shots/*.png 를 data URI로 박아 넣어
// 어디로 옮겨도 열리는 단일 HTML을 만든다.
//   node tools/build-guide.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const IMAGES = {
  __IMG_BUBBLE_CHAT__: 'bubble-chat.png',
  __IMG_BUBBLE_PERMISSION__: 'bubble-permission.png',
  __IMG_BUBBLE_EMPTY__: 'bubble-empty.png',
  __IMG_BUBBLE_HISTORY__: 'bubble-history.png',
  __IMG_PET_NOTIFY__: 'pet-notify.png',
};

let html = fs.readFileSync(path.join(__dirname, 'guide.template.html'), 'utf8');

for (const [token, file] of Object.entries(IMAGES)) {
  if (!html.includes(token)) continue;
  const full = path.join(root, 'shots', file);
  if (!fs.existsSync(full)) {
    console.error(`빠진 스크린샷: ${file} — 먼저 npm run shot 을 실행하세요.`);
    process.exit(1);
  }
  const uri = `data:image/png;base64,${fs.readFileSync(full).toString('base64')}`;
  html = html.replaceAll(token, uri);
}

const left = html.match(/__IMG_[A-Z_]+__/g);
if (left) {
  console.error('치환 안 된 토큰:', [...new Set(left)].join(', '));
  process.exit(1);
}

const out = path.join(root, '사용설명서.html');
fs.writeFileSync(out, html);
console.log(`완성: ${out}  (${(html.length / 1024).toFixed(0)}KB)`);
