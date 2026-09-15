'use strict';
// 개발용: 앱 창만 캡처해서 모양을 확인한다. PET_SHOT=1 로 실행.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const OUT = path.join(__dirname, '..', 'shots');

module.exports = function shot({ petWin, bubbleWin, openBubble, send }) {
  fs.mkdirSync(OUT, { recursive: true });

  const save = async (win, name, zoom = 1) => {
    let img = await win.webContents.capturePage();
    if (zoom !== 1) {
      const { width, height } = img.getSize();
      img = img.resize({ width: width * zoom, height: height * zoom, quality: 'best' });
    }
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    await wait(1200);

    // 1) 색 테마별 · 상태별 모습
    const setTheme = (name) =>
      petWin.webContents.executeJavaScript(
        `document.body.classList.toggle('theme-clay', ${name === 'clay'})`
      );

    for (const theme of ['blue', 'clay']) {
      await setTheme(theme);
      for (const [label, state] of [
        ['idle', { mode: 'idle', facing: 1, busy: false }],
        ['walk', { mode: 'walk', facing: 1, busy: false }],
        ['busy', { mode: 'idle', facing: 1, busy: true }],
        ['held', { mode: 'drag', facing: -1, busy: false }],
      ]) {
        send(petWin, 'pet:state', state);
        await wait(350);
        await save(petWin, `cat-${theme}-${label}`, 3);
      }
    }

    await setTheme('blue');
    send(petWin, 'pet:state', { mode: 'walk', facing: 1, busy: false });
    await wait(300);
    await save(petWin, 'pet-walk');
    await save(petWin, 'pet-walk-3x', 3);

    send(petWin, 'pet:state', { mode: 'idle', facing: -1, busy: true });
    await wait(300);
    await save(petWin, 'pet-busy');

    // 2-b) 새 답변 알림 뱃지
    send(petWin, 'pet:state', { mode: 'idle', facing: 1, busy: false });
    send(petWin, 'pet:notify');
    await wait(700);
    await save(petWin, 'pet-notify', 3);
    send(petWin, 'pet:clear-notify');

    // 3) 말풍선 — 실제 렌더링 경로로 가짜 대화를 흘려 넣는다
    openBubble();
    await wait(400);
    // 스크린샷에 개인 경로가 남지 않도록 일반적인 예시 경로를 쓴다
    send(bubbleWin, 'chat:session', { cwd: 'C:\\Users\\me\\my-project', model: 'claude-opus-5' });
    await wait(200);
    await save(bubbleWin, 'bubble-empty');

    // 사용자가 보낸 말은 입력창을 거쳐야 생기므로, 스크린샷용으로 직접 넣는다
    await bubbleWin.webContents.executeJavaScript(`
      (() => {
        const log = document.getElementById('log');
        log.querySelector('.empty')?.remove();
        const b = document.createElement('div');
        b.className = 'msg user';
        b.textContent = '로그인 쪽 코드 좀 봐줘';
        log.append(b);
      })()
    `);

    send(bubbleWin, 'chat:event', { type: 'tool', name: 'Read', input: { file_path: 'src/app.js' } });
    send(bubbleWin, 'chat:event', { type: 'text-start' });
    for (const chunk of [
      '`app.js` 를 봤어요. 로그인 처리는 ',
      '**handleLogin** 안에 있는데,\n비밀번호를 평문으로 비교하고 있네요. ',
      '고칠까요?\n\n```js\nif (input === user.password) {\n```',
    ]) {
      send(bubbleWin, 'chat:event', { type: 'delta', text: chunk });
      await wait(120);
    }
    send(bubbleWin, 'chat:event', { type: 'result', isError: false, subtype: 'success' });
    await wait(400);
    await save(bubbleWin, 'bubble-chat');

    // 3-b) 지난 대화 복원 화면
    send(bubbleWin, 'chat:reset', { reason: '' });
    await wait(200);
    send(bubbleWin, 'chat:history', {
      items: [
        { role: 'user', text: '어제 하던 리팩터링 이어서 하자' },
        { role: 'assistant', text: '`handleLogin` 을 `bcrypt.compare` 로 바꿔뒀어요.', tools: ['Edit'] },
        { role: 'user', text: '좋아, 테스트도 고쳐줘' },
      ],
    });
    await wait(400);
    await save(bubbleWin, 'bubble-history');

    // 3-c) 도구 결과 펼침 + 이미지 첨부 + 명령 결과
    send(bubbleWin, 'chat:reset', { reason: '' });
    await wait(200);
    send(bubbleWin, 'chat:local', {
      text: '문맥 ████░░░░░░░░░░░░░░░░ **19%**\n\n38.2k / 200.0k 토큰',
    });
    send(bubbleWin, 'chat:event', { type: 'tool', id: 't1', name: 'Bash', input: { command: 'npm test' } });
    send(bubbleWin, 'chat:event', {
      type: 'tool-result',
      toolUseId: 't1',
      isError: false,
      text: 'PASS  src/login.test.js\n  ✓ 비밀번호가 해시로 저장된다 (12ms)\n  ✓ 틀린 비밀번호는 거부된다 (4ms)\n\nTests: 2 passed, 2 total',
    });
    await wait(300);
    await bubbleWin.webContents.executeJavaScript(
      `document.querySelector('.tool.has-result')?.click()` // 접힌 결과를 펼쳐서 찍는다
    );
    await wait(300);
    await save(bubbleWin, 'bubble-toolresult');

    // 4) 권한 요청 카드
    send(bubbleWin, 'chat:permission', {
      id: 'demo',
      toolName: 'Edit',
      input: {
        file_path: 'src/app.js',
        old_string: 'if (input === user.password) {',
        new_string: 'if (await bcrypt.compare(input, user.passwordHash)) {',
      },
      title: 'app.js 를 수정하려고 해요',
      displayName: 'Edit',
      description: '평문 비교를 bcrypt 해시 비교로 바꿉니다',
      defaultToNo: false,
      canAlwaysAllow: true,
    });
    await wait(500);
    await save(bubbleWin, 'bubble-permission');

    // 5) 렌더러의 클릭 판정 로직 검증.
    //    (합성 입력이라 OS 레벨 클릭 통과까지는 못 본다 — 그건 실제 마우스로 확인)
    const wc = petWin.webContents;
    const at = (x, y, type) => wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });

    const hitOn = { x: 64, y: 80 }; // 몸통 한가운데
    const hitOff = { x: 6, y: 6 }; // 투명한 모서리

    at(hitOff.x, hitOff.y, 'mouseMove');
    await wait(120);
    const overCorner = await wc.executeJavaScript('!!document.elementFromPoint(6,6)?.closest("#pet")');

    at(hitOn.x, hitOn.y, 'mouseMove');
    await wait(120);
    const overBody = await wc.executeJavaScript('!!document.elementFromPoint(64,80)?.closest("#pet")');

    await wc.executeJavaScript(`
      window.__ev = [];
      for (const t of ['pointerdown','pointerup','mousedown','mouseup','click']) {
        window.addEventListener(t, () => window.__ev.push(t));
      }
    `);

    const before = bubbleWin.isVisible();
    at(hitOn.x, hitOn.y, 'mouseDown');
    at(hitOn.x, hitOn.y, 'mouseUp');

    // 고정 대기는 느린 실행에서 흔들린다 — 바뀔 때까지 짧게 폴링한다
    let toggled = false;
    for (let i = 0; i < 30 && !toggled; i++) {
      await wait(100);
      toggled = bubbleWin.isVisible() !== before;
    }
    const fired = await wc.executeJavaScript('window.__ev.join(",")');
    console.log(`[click] 렌더러가 받은 이벤트: [${fired}]  (말풍선 보임: ${before} → ${bubbleWin.isVisible()})`);

    console.log(`[click] 캐릭터 위 판정=${overBody} (true 여야 함)`);
    console.log(`[click] 투명 모서리 판정=${overCorner} (false 여야 함)`);
    console.log(`[click] 클릭으로 말풍선 토글=${toggled} (true 여야 함)`);

    console.log('[shot] 저장 완료:', OUT);
    // app.exit()은 before-quit을 건너뛰어 프로세스가 남는다. 실제 종료 경로를 탄다.
    console.log(`[shot] ${overBody && !overCorner && toggled ? 'PASS' : 'FAIL'} 클릭 판정`);
    app.quit();
  })().catch((err) => {
    console.error('[shot] FAIL', err);
    app.quit();
  });
};
