'use strict';

const stage = document.getElementById('stage');
const petGroup = document.getElementById('pet');

const DRAG_THRESHOLD = 5; // 이만큼 움직이면 클릭이 아니라 드래그로 본다

let down = null;
let dragging = false;
let hovering = null;

/* --------------------------------------------------- 메인이 알려주는 상태 반영 */

// 말풍선이 닫힌 채로 답이 다 나오면 뱃지를 띄우고 한 번 폴짝 뛴다
window.pet.onNotify(() => {
  stage.classList.add('notify');
  hop();
});

window.pet.onClearNotify(() => stage.classList.remove('notify'));

window.pet.onState(({ mode, facing, busy }) => {
  // 드래그 중 표시는 렌더러가 직접 관리하므로 메인의 drag 상태와 충돌하지 않게 둔다
  const nextMode = dragging ? 'drag' : mode;

  stage.classList.remove('mode-idle', 'mode-walk', 'mode-fall', 'mode-drag');
  stage.classList.add(`mode-${nextMode}`);

  stage.classList.toggle('facing-left', facing < 0);
  stage.classList.toggle('facing-right', facing >= 0);
  stage.classList.toggle('busy', Boolean(busy));
});

/* -------------------------------------------------------- 픽셀 단위 클릭 판정 */

/**
 * 투명한 사각형 창이 바탕화면 클릭을 다 먹어버리지 않도록,
 * 커서가 실제 캐릭터 픽셀 위에 있을 때만 마우스 입력을 받는다.
 * SVG 도형은 자기 모양대로 히트 테스트되므로 elementFromPoint로 충분하다.
 */
function overCharacter(x, y) {
  const el = document.elementFromPoint(x, y);
  return Boolean(el && petGroup.contains(el));
}

function updateHover(x, y) {
  if (dragging) return;
  const over = overCharacter(x, y);
  if (over === hovering) return;
  hovering = over;
  window.pet.setHover(over);
}

window.addEventListener('mousemove', (e) => updateHover(e.clientX, e.clientY));

window.addEventListener('mouseleave', () => {
  if (dragging) return;
  hovering = false;
  window.pet.setHover(false);
});

/* ----------------------------------------------------------- 클릭 / 드래그 */

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (!overCharacter(e.clientX, e.clientY)) return;
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
  try {
    e.target.setPointerCapture(e.pointerId);
  } catch {
    /* 캡처 실패해도 window 리스너로 처리된다 */
  }
});

window.addEventListener('pointermove', (e) => {
  if (!down || dragging) return;
  if (Math.hypot(e.screenX - down.x, e.screenY - down.y) <= DRAG_THRESHOLD) return;

  dragging = true;
  document.body.classList.add('dragging');
  stage.classList.remove('mode-idle', 'mode-walk', 'mode-fall');
  stage.classList.add('mode-drag');
  window.pet.dragStart();
});

window.addEventListener('pointerup', () => {
  if (!down) return;
  down = null;

  if (dragging) {
    dragging = false;
    document.body.classList.remove('dragging');
    window.pet.dragEnd();
  } else {
    window.pet.click();
    hop();
  }
});

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.pet.contextMenu();
});

function hop() {
  petGroup.classList.remove('react');
  void petGroup.getBoundingClientRect(); // 리플로우로 애니메이션 재시작
  petGroup.classList.add('react');
  setTimeout(() => petGroup.classList.remove('react'), 400);
}
