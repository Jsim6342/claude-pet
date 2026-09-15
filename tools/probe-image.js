'use strict';
// 진단용: 이미지를 메시지에 실어 보내면 Claude가 실제로 보는지 확인한다.
//   node tools/probe-image.js > logs/probe-image.log 2>&1

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tracker = require('../src/main/child-tracker');
tracker.install({ recordPath: path.join(os.tmpdir(), 'claude-pet-image-pids.json') });

const { resolveClaudeCli } = require('../src/main/cli-path');

const log = (...a) => console.log(...a);

(async () => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const file = path.join(__dirname, '..', 'build', 'icon.png');
  const data = fs.readFileSync(file).toString('base64');
  log(`보낼 이미지: ${file} (${(data.length / 1024).toFixed(0)}KB base64)`);

  const q = query({
    prompt: (async function* () {
      yield {
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
            { type: 'text', text: '이 이미지에 뭐가 그려져 있어? 한 문장으로.' },
          ],
        },
      };
    })(),
    options: {
      cwd: process.cwd(),
      pathToClaudeCodeExecutable: resolveClaudeCli(),
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      // 도구 없이 순수하게 이미지만 보고 답하게 한다
      allowedTools: [],
      canUseTool: async () => ({ behavior: 'deny', message: '도구 불필요' }),
    },
  });

  let answer = '';
  for await (const m of q) {
    if (m.type === 'assistant') {
      for (const b of m.message?.content || []) if (b.type === 'text') answer += b.text;
      if (m.error) log(`[오류] ${m.error}`);
    }
    if (m.type === 'result') {
      log(`결과: ${m.subtype}`);
      break;
    }
  }

  log(`응답: ${answer.trim()}`);
  log('');
  log(/고양이|cat|동물/i.test(answer) ? 'PASS  이미지를 실제로 봤다' : 'FAIL  이미지를 못 본 듯하다');

  tracker.killTracked();
  process.exit(0);
})().catch((err) => {
  log(`실패: ${err.message}`);
  tracker.killTracked();
  process.exit(1);
});
