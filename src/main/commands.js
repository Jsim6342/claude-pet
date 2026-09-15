'use strict';

/**
 * 말풍선에서 쓰는 슬래시 명령.
 *
 * 스킬·플러그인 명령(/eli5 같은 것)은 CLI가 알아서 처리하므로 그냥 흘려보낸다.
 * 반면 /clear /context /model 같은 내장 명령은 터미널 UI 전용이라 그냥 보내면
 * 아무 반응 없이 조용히 끝난다. 그런 것들을 여기서 가로채 SDK의 제어 메서드로
 * 대신 처리하거나, 안 되는 것은 안 된다고 알려준다.
 */

/** 터미널 전용이라 말풍선에서는 동작할 수 없는 것들 */
const TERMINAL_ONLY = {
  compact: '대화 압축은 터미널에서만 돼요. 길어졌으면 ↺ 로 새 대화를 시작해 주세요.',
  config: '설정 화면은 터미널 전용이에요. `~/.claude/settings.json` 을 직접 고쳐도 됩니다.',
  vim: '편집기 모드는 터미널 전용이에요.',
  'terminal-setup': '터미널 설정은 여기서 못 해요.',
  login: '로그인은 터미널에서 `claude` 를 실행해 주세요.',
  logout: '로그아웃은 터미널에서 해주세요.',
  doctor: '진단은 터미널에서 `claude /doctor` 로 실행해 주세요.',
  upgrade: '요금제 변경은 터미널이나 claude.ai 에서 해주세요.',
};

const fmtBytes = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * @returns {null | {handled: true, notice?: string, text?: string}}
 *   null 이면 명령이 아니거나 그냥 Claude에게 보내면 되는 것.
 */
async function run(input, ctx) {
  const match = /^\/([\w:-]+)\s*(.*)$/s.exec(input.trim());
  if (!match) return null;

  const [, name, rest] = match;
  const { agent, actions } = ctx;

  switch (name) {
    case 'help':
      return { handled: true, text: await helpText(agent) };

    case 'clear':
    case 'new':
      actions.newSession();
      return { handled: true };

    case 'context': {
      const usage = await agent.control('getContextUsage');
      return { handled: true, text: contextText(usage) };
    }

    case 'model': {
      if (!rest.trim()) {
        const models = await agent.control('supportedModels');
        const now = agent.model || '(알 수 없음)';
        const list = models.map((m) => `- \`${m.model ?? m.id ?? m.name}\``).join('\n');
        return { handled: true, text: `지금 모델: \`${now}\`\n\n바꾸려면 \`/model <이름>\`\n\n${list}` };
      }
      await agent.control('setModel', rest.trim());
      return { handled: true, notice: `모델을 ${rest.trim()} 로 바꿨어요.` };
    }

    case 'mcp': {
      const servers = await agent.control('mcpServerStatus');
      if (!servers.length) return { handled: true, text: '연결된 MCP 서버가 없어요.' };
      const lines = servers.map((s) => `- **${s.name}** — ${s.status}`).join('\n');
      return { handled: true, text: `MCP 서버 ${servers.length}개\n\n${lines}` };
    }

    case 'plan':
      await agent.setPermissionMode('plan');
      return { handled: true, notice: '계획 모드로 바꿨어요. 파일을 고치지 않고 계획만 세웁니다.' };

    case 'auto':
      await agent.setPermissionMode('acceptEdits');
      return { handled: true, notice: '자동 승인 모드로 바꿨어요. 파일 수정을 매번 묻지 않습니다.' };

    case 'ask':
    case 'default':
      await agent.setPermissionMode('default');
      return { handled: true, notice: '기본 모드로 돌아왔어요. 위험한 작업은 다시 물어봅니다.' };

    case 'cwd':
    case 'dir':
      actions.pickCwd();
      return { handled: true };

    case 'resume':
    case 'sessions':
      actions.openSessions();
      return { handled: true };

    default:
      if (TERMINAL_ONLY[name]) return { handled: true, notice: TERMINAL_ONLY[name] };
      return null; // 스킬 명령 등 — Claude에게 그대로 보낸다
  }
}

async function helpText(agent) {
  let skills = [];
  try {
    const all = await agent.control('supportedCommands');
    // 스킬·플러그인 명령만 추린다 (내장 명령은 대부분 터미널 전용)
    skills = all.map((c) => c.name || c).filter((n) => /[:-]/.test(n)).slice(0, 14);
  } catch {
    /* 못 가져와도 기본 안내는 보여준다 */
  }

  return [
    '**말풍선에서 쓸 수 있는 명령**',
    '',
    '- `/help` — 이 목록',
    '- `/clear` — 새 대화 시작',
    '- `/resume` — 지난 대화 목록에서 골라 이어가기',
    '- `/context` — 문맥이 얼마나 찼는지',
    '- `/model` — 모델 보기 · `/model <이름>` 으로 변경',
    '- `/mcp` — MCP 서버 상태',
    '- `/cwd` — 작업 폴더 바꾸기',
    '- `/plan` — 계획만 세우기 · `/auto` — 자동 승인 · `/ask` — 기본',
    '',
    skills.length ? `**스킬 명령** (그대로 쓰면 돼요)\n\n${skills.map((s) => `\`/${s}\``).join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function contextText(usage) {
  if (!usage) return '문맥 정보를 가져오지 못했어요.';

  const used = usage.totalTokens ?? usage.used ?? usage.inputTokens;
  const max = usage.maxTokens ?? usage.contextWindow ?? usage.limit;

  if (typeof used !== 'number') {
    return `문맥 정보:\n\n\`\`\`json\n${JSON.stringify(usage, null, 2).slice(0, 600)}\n\`\`\``;
  }
  if (typeof max !== 'number') return `지금까지 쓴 문맥: **${fmtBytes(used)}** 토큰`;

  const pct = Math.round((used / max) * 100);
  const filled = Math.round(pct / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  return `문맥 ${bar} **${pct}%**\n\n${fmtBytes(used)} / ${fmtBytes(max)} 토큰`;
}

module.exports = { run };
