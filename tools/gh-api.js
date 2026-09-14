'use strict';
/**
 * 진단용 GitHub API 호출기. 토큰은 자격증명 관리자에서 가져오며 출력하지 않는다.
 *   node tools/gh-api.js GET /repos/:owner/:repo/actions/permissions
 *   node tools/gh-api.js PUT /repos/:owner/:repo/actions/permissions '{"enabled":true}'
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const publish = (Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish) || {};

function getToken() {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', () => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith('password='));
      line ? resolve(line.slice(9)) : reject(new Error('토큰을 찾지 못했습니다'));
    });
    child.on('error', reject);
    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

(async () => {
  const [method, rawPath, body] = process.argv.slice(2);
  if (!method || !rawPath) throw new Error('사용법: node tools/gh-api.js <METHOD> <PATH> [BODY]');

  const apiPath = rawPath.replace(':owner', publish.owner).replace(':repo', publish.repo);
  const token = await getToken();

  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'claude-pet',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
  });

  const text = await res.text();
  console.log(`${method} ${apiPath} → ${res.status}`);

  // GH_OUT=파일경로 로 주면 잘리지 않은 응답 전체를 파일에 쓴다
  if (process.env.GH_OUT) {
    require('node:fs').writeFileSync(process.env.GH_OUT, text);
    console.log(`(응답 전체 → ${process.env.GH_OUT})`);
    return;
  }

  if (text) {
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 1500));
    } catch {
      console.log(text.slice(0, 800));
    }
  }
})().catch((err) => {
  console.error(`실패: ${err.message}`);
  process.exit(1);
});
