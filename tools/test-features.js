'use strict';
// 새로 넣은 기능 검증: 슬래시 명령 · 이미지 첨부 · 도구 결과 · 권한 모드 전환
//   node tools/test-features.js > logs/features.log 2>&1

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tracker = require('../src/main/child-tracker');
tracker.install({ recordPath: path.join(os.tmpdir(), 'claude-pet-features-pids.json') });

const { Agent } = require('../src/main/agent');
const { resolveClaudeCli } = require('../src/main/cli-path');
const commands = require('../src/main/commands');

const log = (...a) => console.log(...a);
const checks = [];
const check = (name, pass) => {
  checks.push([name, pass]);
  log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
};

let resolveTurn;
let answer = '';
const seen = [];
const toolResults = [];

const agent = new Agent({
  cwd: process.cwd(),
  cliPath: resolveClaudeCli(),
  onEvent: (e) => {
    seen.push(e.type);
    if (e.type === 'delta') answer += e.text;
    if (e.type === 'tool-result') toolResults.push(e);
    if (e.type === 'error') log(`    [오류] ${e.message}`);
    if (e.type === 'result') resolveTurn?.();
  },
  onPermission: (req) => agent.resolvePermission(req.id, 'allow'),
});

async function turn(text, images = []) {
  answer = '';
  seen.length = 0;
  toolResults.length = 0;
  const done = new Promise((r) => {
    resolveTurn = r;
  });
  await agent.send(text, images);
  await Promise.race([done, new Promise((_, j) => setTimeout(() => j(new Error('타임아웃')), 120000))]);
  return answer;
}

const noop = { newSession() {}, pickCwd() {} };

(async () => {
  log('=== 1. 슬래시 명령 ===');

  const help = await commands.run('/help', { agent, actions: noop });
  log(`  /help → ${help?.text?.slice(0, 60).replace(/\n/g, ' ')}…`);
  check('/help 가 명령 목록을 돌려준다', Boolean(help?.handled && /clear/.test(help.text)));

  const ctx = await commands.run('/context', { agent, actions: noop });
  log(`  /context → ${String(ctx?.text).replace(/\n/g, ' ').slice(0, 80)}`);
  check('/context 가 문맥 사용량을 돌려준다', Boolean(ctx?.handled && ctx.text));

  const mcp = await commands.run('/mcp', { agent, actions: noop });
  log(`  /mcp → ${String(mcp?.text).replace(/\n/g, ' ').slice(0, 80)}`);
  check('/mcp 가 서버 상태를 돌려준다', Boolean(mcp?.handled && mcp.text));

  const compact = await commands.run('/compact', { agent, actions: noop });
  check('터미널 전용 명령은 안내를 준다', Boolean(compact?.handled && compact.notice));

  const skill = await commands.run('/eli5 test', { agent, actions: noop });
  check('스킬 명령은 가로채지 않고 통과시킨다', skill === null);

  log('\n=== 2. 권한 모드 전환 ===');
  await agent.setPermissionMode('plan');
  check('plan 모드로 전환된다', agent.permissionMode === 'plan');
  await agent.setPermissionMode('default');
  check('기본 모드로 되돌아온다', agent.permissionMode === 'default');

  log('\n=== 3. 도구 결과가 말풍선으로 온다 ===');
  await turn('Read package.json and tell me the "name" field.');
  log(`  도구 결과 ${toolResults.length}건, 첫 건 길이 ${toolResults[0]?.text?.length ?? 0}`);
  check('tool-result 이벤트가 온다', toolResults.length > 0);
  check('결과에 실제 파일 내용이 담긴다', /claude-pet/.test(toolResults.map((t) => t.text).join('')));

  log('\n=== 4. 이미지 첨부 ===');
  const icon = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64');
  const reply = await turn('이 이미지에 뭐가 있어? 한 단어로.', [{ mediaType: 'image/png', data: icon }]);
  log(`  응답: ${reply.trim().slice(0, 80)}`);
  check('이미지를 실제로 본다', /고양이|cat|동물|얼굴/i.test(reply));

  log('\n---------------- 결과');
  const ok = checks.every(([, p]) => p);
  log(`${checks.filter(([, p]) => p).length}/${checks.length} 통과`);

  tracker.killTracked();
  agent.stop();
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  log(`\n실패: ${err.message}`);
  tracker.killTracked();
  agent.stop();
  process.exit(1);
});
