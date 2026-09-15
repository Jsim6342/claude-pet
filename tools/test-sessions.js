'use strict';
// 지난 대화 목록 검증: 작업 폴더를 주면 그 폴더의 세션들이 최신순으로 나오는가.
// API를 쓰지 않으므로 몇 초면 끝난다.
//   node tools/test-sessions.js

const os = require('node:os');
const path = require('node:path');
const { listProjectSessions } = require('../src/main/agent');

const log = (...a) => console.log(...a);

(async () => {
  const dirs = [os.homedir(), path.resolve(__dirname, '..')];
  const checks = [];

  for (const dir of dirs) {
    const items = await listProjectSessions(dir, 10);
    log(`\n=== ${dir}  →  ${items.length}개`);

    for (const item of items.slice(0, 5)) {
      const when = new Date(item.lastModified).toLocaleString('ko-KR');
      log(`  ${item.sessionId.slice(0, 8)}  ${when}  ${(item.title || '(제목 없음)').slice(0, 50)}`);
    }

    if (!items.length) continue;

    const sorted = items.every((it, i) => i === 0 || items[i - 1].lastModified >= it.lastModified);
    checks.push([`${path.basename(dir)}: 최신순 정렬`, sorted]);
    checks.push([`${path.basename(dir)}: 세션 id가 다 있다`, items.every((it) => Boolean(it.sessionId))]);
    checks.push([`${path.basename(dir)}: 시각이 다 있다`, items.every((it) => it.lastModified > 0)]);
    checks.push([`${path.basename(dir)}: 제목이 하나라도 있다`, items.some((it) => it.title)]);
    checks.push([`${path.basename(dir)}: cwd가 그 폴더다`, items.every((it) => !it.cwd || it.cwd.startsWith(dir))]);
  }

  checks.unshift(['한 폴더에서라도 목록을 받았다', checks.length > 0]);

  log('\n---------------- 결과');
  let ok = true;
  for (const [name, pass] of checks) {
    log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  log(`\n실패: ${err.stack || err.message}`);
  process.exit(1);
});
