'use strict';
/**
 * 설명서 안의 캐릭터를 앱(src/renderer/pet.html)의 것과 똑같이 맞춘다.
 * 캐릭터를 고칠 때마다 설명서가 뒤처지는 걸 막으려고 자동화했다.
 *
 *   node tools/sync-guide-pet.js
 *
 * 설명서는 캐릭터를 여러 번 복제해 쓰므로 id 대신 class 를 쓴다.
 * (같은 id가 여러 개면 유효한 HTML이 아니다)
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// 주석 안에도 <g id="pet"> 같은 문구가 설명으로 들어있어서, 먼저 걷어내고 파싱한다
const petHtml = fs
  .readFileSync(path.join(root, 'src', 'renderer', 'pet.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
const guidePath = path.join(__dirname, 'guide.template.html');
let guide = fs.readFileSync(guidePath, 'utf8');

/** pet.html 에서 <defs> 와 <g id="pet"> 블록을 통째로 꺼낸다. */
function grab(tag, attr) {
  const open = petHtml.indexOf(`<${tag}${attr ? ` ${attr}` : ''}`);
  if (open < 0) throw new Error(`pet.html 에서 <${tag} ${attr}> 를 찾지 못했습니다`);

  let depth = 0;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = open;
  let m;
  while ((m = re.exec(petHtml))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return petHtml.slice(open, m.index + m[0].length);
  }
  throw new Error(`<${tag}> 가 닫히지 않았습니다`);
}

const defs = grab('defs', '');
const petGroup = grab('g', 'id="pet"');
const shadow = petHtml.match(/<ellipse id="shadow"[^>]*\/>/)[0];

// id → class 로 바꾼다. 그라데이션 id(fur, fur-far)는 참조가 걸려 있어 그대로 둔다.
const KEEP_ID = new Set(['fur', 'fur-far', 'fur-top', 'fur-bottom', 'fur-far-top', 'fur-far-bottom']);

function idsToClasses(svg) {
  return svg.replace(/\sid="([\w-]+)"/g, (whole, id) => {
    if (KEEP_ID.has(id)) return whole;
    return ` data-part="${id}"`;
  });
}

const body = idsToClasses(`${defs}\n    ${shadow}\n    ${petGroup}`)
  // 설명서 CSS 는 .pet [data-part=...] 로 잡는다. 기존 class 는 그대로 쓴다.
  .replace(/^/gm, '  ')
  .trim();

const START = '<!-- PET:START -->';
const END = '<!-- PET:END -->';
if (!guide.includes(START)) throw new Error(`설명서에 ${START} 표시가 없습니다`);

guide = guide.replace(
  new RegExp(`${START}[\\s\\S]*?${END}`),
  `${START}\n    ${body}\n    ${END}`
);

fs.writeFileSync(guidePath, guide);
console.log('설명서 캐릭터를 앱과 동기화했습니다');
