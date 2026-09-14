'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXE = process.platform === 'win32' ? 'claude.exe' : 'claude';

/**
 * Claude Code CLI 실행 파일을 찾는다.
 *
 * Agent SDK는 이 CLI를 자식 프로세스로 띄운다. 개발 중에는 SDK에 딸려온
 * 네이티브 바이너리를 쓰지만, 배포본에서는 용량(212MB) 때문에 그걸 빼고
 * 사용자가 이미 설치해 둔 CLI를 찾아 쓴다. 그쪽이 스스로 업데이트되므로
 * 펫도 늘 최신 버전을 쓰게 되는 이점이 있다.
 *
 * @param {string[]} extraCandidates 먼저 확인할 경로(배포본의 resources 등)
 * @returns {string|null} 찾은 실행 파일 경로
 */
function resolveClaudeCli(extraCandidates = []) {
  for (const candidate of candidates(extraCandidates)) {
    if (candidate && isExecutableFile(candidate)) return candidate;
  }
  return null;
}

function* candidates(extraCandidates) {
  // 0. 직접 지정한 경로가 최우선 (문제 생겼을 때의 탈출구)
  yield process.env.CLAUDE_PET_CLI;

  // 1. 호출자가 넘긴 경로 (배포본에 CLI를 같이 넣은 경우)
  yield* extraCandidates;

  // 2. Agent SDK에 딸려온 네이티브 바이너리 (개발 중 경로)
  yield sdkBundledCli();

  // 3. 공식 설치본이 놓이는 자리
  yield path.join(os.homedir(), '.local', 'bin', EXE);

  // 4. PATH에 있는 것
  yield fromPath();
}

/** node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude(.exe) */
function sdkBundledCli() {
  try {
    const sdkDir = path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk/package.json'));
    const scope = path.dirname(sdkDir); // .../node_modules/@anthropic-ai
    const prefix = 'claude-agent-sdk-';

    for (const entry of fs.readdirSync(scope)) {
      if (!entry.startsWith(prefix)) continue;
      const full = path.join(scope, entry, EXE);
      if (isExecutableFile(full)) return full;
    }
  } catch {
    /* SDK를 못 찾으면 다음 후보로 */
  }
  return null;
}

function fromPath() {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

function isExecutableFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

module.exports = { resolveClaudeCli };
