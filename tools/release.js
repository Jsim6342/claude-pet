'use strict';
/**
 * dist/ 의 빌드 결과물을 GitHub Release로 올린다.
 *
 *   npm run dist && node tools/release.js
 *
 * 토큰은 git credential(자격증명 관리자)에서 가져오며 절대 출력하지 않는다.
 * electron-updater가 보려면 아래 세 가지가 모두 올라가 있어야 한다.
 *   - ClaudePet-Setup-x.y.z.exe    설치 파일
 *   - latest.yml                   버전/해시 정보 (없으면 업데이트 자체가 안 됨)
 *   - *.exe.blockmap               차등 다운로드용 (없으면 매번 전체를 받음)
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const publish = (Array.isArray(pkg.build.publish) ? pkg.build.publish[0] : pkg.build.publish) || {};
const { owner, repo } = publish;
const version = pkg.version;
const tag = `v${version}`;

const log = (...a) => console.log(...a);

/** 자격증명 관리자에서 GitHub 토큰을 꺼낸다. */
function getToken() {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', () => {
      const line = out.split(/\r?\n/).find((l) => l.startsWith('password='));
      if (!line) return reject(new Error('git credential에서 토큰을 찾지 못했습니다'));
      resolve(line.slice('password='.length));
    });
    child.on('error', reject);
    child.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}

async function api(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'claude-pet-release',
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // 본문에 토큰이 들어갈 일은 없지만, 상태코드 위주로만 보고한다
    throw new Error(`${options.method || 'GET'} ${new URL(url).pathname} → ${res.status}\n${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

(async () => {
  if (!owner || owner.startsWith('<')) throw new Error('package.json build.publish.owner 가 비어 있습니다');

  const assets = [
    `ClaudePet-Setup-${version}.exe`,
    `ClaudePet-Setup-${version}.exe.blockmap`,
    'latest.yml',
  ].map((name) => ({ name, file: path.join(root, 'dist', name) }));

  for (const a of assets) {
    if (!fs.existsSync(a.file)) throw new Error(`빌드 결과물이 없습니다: ${a.name} — 먼저 npm run dist`);
  }

  const token = await getToken();
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  // 같은 태그의 릴리스가 이미 있으면 재사용한다
  let release = null;
  try {
    release = await api(token, `${base}/releases/tags/${tag}`);
    log(`기존 릴리스 재사용: ${tag}`);
  } catch {
    log(`릴리스 생성: ${tag}`);
    release = await api(token, `${base}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: `Claude Pet ${tag}`,
        body: [
          '바탕화면을 걸어다니는 캐릭터로 Claude Code를 쓰는 앱입니다.',
          '',
          '**먼저 [Claude Code](https://claude.com/code)가 설치돼 있어야 합니다.**',
          '이 앱은 CLI를 번들하지 않고 설치된 것을 찾아 쓰며, 로그인도 그 자격증명을 그대로 씁니다.',
          '',
          '### 설치',
          `아래 \`ClaudePet-Setup-${version}.exe\` 를 받아 실행하세요. 윈도우 10/11 64비트.`,
          '서명되지 않은 앱이라 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**.',
          '',
          '사용법은 저장소의 `사용설명서.html` 에 그림과 함께 정리돼 있습니다.',
        ].join('\n'),
        draft: false,
        prerelease: false,
      }),
    });
  }

  const existing = new Set((release.assets || []).map((a) => a.name));
  const uploadBase = release.upload_url.replace(/\{.*$/, '');

  for (const a of assets) {
    if (existing.has(a.name)) {
      log(`  건너뜀(이미 있음): ${a.name}`);
      continue;
    }
    const body = fs.readFileSync(a.file);
    log(`  업로드: ${a.name} (${(body.length / 1024 / 1024).toFixed(1)}MB)`);
    await api(token, `${uploadBase}?name=${encodeURIComponent(a.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
      body,
    });
  }

  log(`\n완료: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
})().catch((err) => {
  console.error(`실패: ${err.message}`);
  process.exit(1);
});
