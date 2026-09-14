'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/**
 * PET_SELFTEST=1 로 실행하면 실제로 한 턴을 돌려보고 결과를 파일에 쓴 뒤 종료한다.
 * 배포본은 GUI 앱이라 콘솔 출력이 안 보여서, 빌드가 멀쩡한지 확인할 방법이 필요하다.
 * 특히 asar 안에서 ESM 전용인 Agent SDK를 import 할 수 있는지가 핵심 확인 대상.
 */
module.exports = function selftest({ cliPath, agent, childTracker }) {
  const out = path.join(app.getPath('userData'), 'selftest.json');
  const result = {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    cliPath,
    childProtection: null,
    events: [],
    answer: '',
    ok: false,
  };

  let finished = false;
  const finish = (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (err) result.error = String(err?.message || err);
    result.ok = !result.error && result.answer.includes('PONG');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));

    // app.exit()이 아니라 quit()을 쓴다 — before-quit의 자식 프로세스 정리를
    // 그대로 타야 실제 종료 경로를 검증하는 셈이 된다.
    app.quit();
  };

  const timer = setTimeout(() => finish(new Error('타임아웃 120초')), 120000);

  if (!cliPath) return finish(new Error('CLI를 찾지 못함'));

  // 이벤트를 가로채서 기록만 더하고 원래 핸들러로 넘긴다
  const passthrough = agent.onEvent;
  agent.onEvent = (event) => {
    result.events.push(event.type);
    if (event.type === 'delta') result.answer += event.text;
    if (event.type === 'error') result.error = event.message;
    // 자식이 실제로 떠 있는 시점(init)에 보호 상태를 찍어둔다
    if (event.type === 'init') result.childProtection = childTracker?.status() ?? null;
    if (event.type === 'result' || event.type === 'closed') finish();
    passthrough(event);
  };

  agent.send('Reply with exactly: PONG').catch(finish);
};
