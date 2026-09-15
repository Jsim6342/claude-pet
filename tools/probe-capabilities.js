'use strict';
// 진단용: 앱이 띄우는 세션이 터미널 Claude Code와 같은 것을 갖고 있는지 확인한다.
//   node tools/probe-capabilities.js > logs/probe.log 2>&1

const path = require('node:path');
const os = require('node:os');

const tracker = require('../src/main/child-tracker');
tracker.install({ recordPath: path.join(os.tmpdir(), 'claude-pet-probe-pids.json') });

const { resolveClaudeCli } = require('../src/main/cli-path');

const log = (...a) => console.log(...a);

(async () => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  // agent.js 와 같은 옵션으로 띄운다 (PERSONA 만 뺌 — 여기선 능력만 본다)
  const q = query({
    prompt: (async function* () {
      yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: 'hi' } };
    })(),
    options: {
      cwd: process.cwd(),
      pathToClaudeCodeExecutable: resolveClaudeCli(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'default',
      canUseTool: async () => ({ behavior: 'deny', message: '조사 중' }),
    },
  });

  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') {
      log(`CLI 버전 : ${m.claude_code_version}`);
      log(`모델     : ${m.model}`);
      log(`권한 모드: ${m.permissionMode}`);
      log(`작업 폴더: ${m.cwd}`);
      log('');
      log(`도구 (${m.tools.length}개):`);
      log('  ' + m.tools.join(', '));
      log('');
      log(`슬래시 명령 (${(m.slash_commands || []).length}개):`);
      log('  ' + (m.slash_commands || []).join(', '));
      log('');
      log(`MCP 서버 (${(m.mcp_servers || []).length}개):`);
      for (const s of m.mcp_servers || []) log(`  - ${s.name}: ${s.status}`);
      log('');
      log(`서브에이전트 (${(m.agents || []).length}개):`);
      log('  ' + (m.agents || []).join(', '));
      break;
    }
  }

  tracker.killTracked();
  process.exit(0);
})().catch((err) => {
  console.error('실패:', err.message);
  tracker.killTracked();
  process.exit(1);
});
