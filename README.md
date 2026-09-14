# Claude Pet

바탕화면 아래쪽을 걸어 다니는 캐릭터를 클릭하면 말풍선이 열리고, 거기에 적은 요청이
Claude Code로 그대로 전달된다. 응답은 말풍선에 한 글자씩 흘러나온다.

```
┌─ Electron main ────────────────────────────┐
│  walker.js  캐릭터 창 좌표 이동 / 중력      │
│  agent.js   Claude Agent SDK 스트리밍 세션  │
│  index.js   창·트레이·IPC                   │
└────────┬───────────────────────────────────┘
         │ IPC
    ┌────▼──────────────┐  ┌──────────────────┐
    │ pet.html  캐릭터   │  │ bubble.html 말풍선 │
    └───────────────────┘  └──────────────────┘
```

## 설치해서 쓰기

**먼저 [Claude Code](https://claude.com/code)가 설치돼 있어야 한다.** 이 앱은 CLI를 번들하지 않고
설치된 것을 찾아 쓴다. 로그인도 그쪽 자격증명을 그대로 쓰므로 API 키 설정이 필요 없다.

[Releases](https://github.com/Jsim6342/claude-pet/releases)에서 `ClaudePet-Setup-x.x.x.exe` 를
받아 실행한다. 관리자 권한이 필요 없고 계정별로 설치된다. 윈도우 10/11 64비트 전용.

서명되지 않은 앱이라 "Windows의 PC 보호" 창이 뜨면 **추가 정보 → 실행**.

사용법은 저장소의 [`사용설명서.html`](사용설명서.html)에 그림과 함께 정리돼 있다.

## 개발하면서 쓰기

```bash
npm install
npm start
```

인증은 이미 로그인된 Claude Code 자격증명을 그대로 쓴다. API 키를 따로 넣을 필요가 없다.

| 스크립트 | 설명 |
|---|---|
| `npm start` | 앱 실행 (유일하게 콘솔을 쓰는 스크립트) |
| `npm run debug` | 렌더러 콘솔과 CLI stderr를 `logs/debug.log` 로 |
| `npm run e2e` | Electron 없이 `agent.js`만 실전 호출로 검증 (스트리밍·멀티턴·권한) |
| `npm run selftest` | 배포본이 실제로 한 턴을 도는지 검증 → `%APPDATA%/claude-pet/selftest.json` |
| `npm run tracker` | 자식 프로세스 PID 추적이 동작하는지 검증 |
| `npm run procs` | 지금 떠 있는 `claude.exe` 를 나열 (내 세션 / 고아 구분) |
| `npm run shot` | 앱 창만 캡처해 `shots/` 에 저장 + 클릭 판정 자동 검사 |
| `npm run dist` | 설치 파일 생성 → `dist/` |
| `npm run guide` | `사용설명서.html` 다시 생성 |

### 릴리스

```bash
npm version patch          # 버전 올리기
npm run dist               # 설치 파일 빌드
```

`dist/` 의 `ClaudePet-Setup-*.exe`, `latest.yml`, `*.blockmap` 세 개를 GitHub Release에 올리면
설치된 앱들이 6시간마다 확인해 알아서 받아간다. `latest.yml` 이 없으면 업데이트가 동작하지 않고,
`.blockmap` 이 없으면 매번 전체 파일을 받는다.

`npm start` 를 뺀 모든 스크립트는 출력을 `logs/` 로 보낸다. GUI 앱이 호출한 쪽 콘솔을
물고 있으면 앱이 끝나도 파이프가 안 닫혀서 계속 매달리기 때문이다.

## 조작

| 동작 | 결과 |
|---|---|
| 캐릭터 클릭 | 말풍선 열기/닫기 |
| 캐릭터 드래그 | 원하는 곳으로 옮기기 (놓으면 바닥으로 떨어짐) |
| 캐릭터 우클릭 | 트레이 메뉴 |
| `Ctrl+Shift+Space` | 어디서든 말풍선 열기/닫기 |
| `Enter` / `Shift+Enter` | 전송 / 줄바꿈 |
| `Esc` | 응답 중이면 중단, 아니면 말풍선 닫기 |

말풍선 헤더의 경로를 클릭하면 작업 폴더를 바꿀 수 있고, `↺` 로 새 대화를 시작한다.
작업 폴더가 그대로면 앱을 다시 켜도 지난 대화를 이어받는다(세션 파일이 사라졌으면
자동으로 새 대화로 넘어간다).

## 동작 방식에서 알아둘 점

- **클릭 통과** — 투명한 128×128 창이 바탕화면 클릭을 다 먹지 않도록, 기본은
  `setIgnoreMouseEvents(true, {forward:true})` 상태다. 커서가 실제 캐릭터 픽셀 위에
  올 때만(`elementFromPoint` 로 SVG 도형 단위 판정) 입력을 받도록 전환한다.
  → `src/main/index.js` 의 `pet:hover`, `src/renderer/pet.js` 의 `overCharacter()`
- **하나의 긴 세션** — `agent.js` 는 `query()` 에 닫지 않는 큐를 물려서 세션을 계속
  살려 둔다. 매 턴 프로세스를 새로 띄우지 않고, 덕분에 `interrupt()`(중단 버튼)도 쓸 수 있다.
- **권한 요청** — `canUseTool` 콜백이 말풍선에 카드를 띄우고, 버튼을 누를 때까지
  Promise를 붙잡아 둔다. 이걸 구현하지 않으면 파일 수정·명령 실행에서 조용히 멈춘다.
  `~/.claude/settings.json` 의 permissions 설정을 그대로 따르므로, 이미 허용해 둔
  도구는 묻지 않는다.
- **항상 위** — `setAlwaysOnTop(true, 'screen-saver')` 로 전체화면 영상·게임 위에서도
  밀리지 않게 해 뒀다.
- **CLI를 번들하지 않는다** — SDK에 딸려오는 네이티브 CLI는 212MB라 배포본에서 제외하고,
  설치된 `claude.exe` 를 찾아 쓴다(`src/main/cli-path.js`). 그쪽이 스스로 업데이트되므로
  펫도 늘 최신 CLI를 쓰게 된다. 찾는 순서는 `CLAUDE_PET_CLI` → 배포본 동봉 → SDK 번들 →
  `~/.local/bin/claude.exe` → PATH.
- **자식 프로세스 정리** — SDK가 띄우는 `claude.exe` 를 두 겹으로 정리한다.
  `child-tracker.js` 가 `spawn` 을 훅해 생성 시점에 PID를 기록하고(정상 종료·다음 실행 시 회수),
  `job-object.js` 가 Windows Job Object(`KILL_ON_JOB_CLOSE`)로 묶어 강제 종료 시 커널이 치우게 한다.
  **이미지 이름으로 죽이면 안 된다** — Claude Code 자신이 `claude.exe` 라서 남의 세션까지 끊긴다.

## 캐릭터를 내 이미지로 바꾸기

캐릭터는 `src/renderer/pet.html` 안의 인라인 SVG다. 애니메이션은
`src/renderer/pet.css` 가 상태 클래스(`mode-idle` · `mode-walk` · `mode-fall` ·
`mode-drag` · `busy` · `facing-left`)를 보고 처리한다.

### 방법 1. 통짜 이미지 / GIF 하나로 (가장 간단)

`<g id="pet">` 안의 내용을 지우고 이미지 한 장으로 바꾼다.

```html
<g id="pet">
  <image href="../../assets/pet.png" x="0" y="0" width="128" height="128" />
</g>
```

이러면 걷기·생각하기 모션은 사라지지만, 좌우 반전(`facing-left`)과 클릭 판정,
클릭 리액션(`hop`)은 그대로 동작한다. APNG/GIF를 쓰면 이미지 자체가 움직인다.

### 방법 2. 상태별 이미지 (권장)

상태마다 다른 이미지를 겹쳐 두고 CSS로 보이는 것만 고른다.

```html
<g id="pet">
  <image class="sprite s-idle" href="../../assets/idle.png" width="128" height="128" />
  <image class="sprite s-walk" href="../../assets/walk.png" width="128" height="128" />
  <image class="sprite s-busy" href="../../assets/busy.png" width="128" height="128" />
</g>
```

```css
.sprite { display: none; }
.mode-idle .s-idle,
.mode-fall .s-idle,
.mode-drag .s-idle { display: block; }
.mode-walk .s-walk { display: block; }
.busy .s-busy      { display: block; }   /* busy가 다른 상태보다 우선하도록 뒤에 둔다 */
```

### 방법 3. 스프라이트 시트

가로로 이어 붙인 시트를 `<image>` 로 넣고 `clip-path` 를 `steps()` 로 넘긴다.
4프레임 걷기 시트(512×128) 예시:

```html
<g id="pet">
  <g id="sheet-clip" clip-path="url(#frame)">
    <image id="sheet" href="../../assets/walk-sheet.png" width="512" height="128" />
  </g>
  <clipPath id="frame"><rect x="0" y="0" width="128" height="128" /></clipPath>
</g>
```

```css
.mode-walk #sheet { animation: sheet 0.52s steps(4) infinite; }
@keyframes sheet { to { transform: translateX(-512px); } }
```

### 이미지로 바꿀 때 챙길 것

1. **클릭 판정** — 지금은 SVG 도형 모양대로 정확히 판정된다. `<image>` 로 바꾸면
   투명 영역까지 클릭 판정에 들어간다. 정확한 판정이 필요하면 이미지 위에 실루엣
   모양의 투명한 `<path fill="transparent">` 를 하나 올려 두면 된다.
2. **바닥 위치** — 캐릭터의 발이 viewBox 기준 `y≈124` 에 오도록 맞춘다. 창의 아래쪽
   변이 작업 영역 바닥에 붙기 때문에, 발이 더 위에 있으면 공중에 떠 보인다.
3. **그림자** — `#shadow` 는 `#pet` 그룹 밖에 있다. 클릭 판정에 안 들어가야 해서
   일부러 빼 둔 것이니, 이미지에 그림자를 그려 넣었다면 `#shadow` 를 지우자.
4. **크기** — 128보다 큰 캐릭터를 쓰려면 `src/main/index.js` 의 `PET_SIZE` 와
   `pet.html` 의 `viewBox`, `pet.css` 의 `#stage` 크기를 같이 올린다.

바꾼 모양은 `npm run shot` 으로 `shots/` 에 캡처해서 확인하면 편하다.

## 다듬을 지점

| 원하는 것 | 볼 곳 |
|---|---|
| 걷는 속도, 쉬는 빈도, 중력 | `src/main/walker.js` 상단 상수와 `#plan()` |
| 말풍선 크기·색 | `src/main/index.js` 의 `BUBBLE_W/H`, `src/renderer/bubble.css` |
| 답변 말투(짧게/길게) | `src/main/agent.js` 의 `PERSONA` |
| 파일 수정을 매번 묻지 않기 | `agent.js` 의 `permissionMode` 를 `'acceptEdits'` 로 |
| 시작할 때 뜨게 하기 | 트레이 메뉴 → "윈도우 시작 시 실행" |
