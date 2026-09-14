'use strict';

const TICK_MS = 16;

const GRAVITY = 0.85;
const BOUNCE = 0.28;
const WALK_SPEED = 0.95;

/**
 * 캐릭터 창의 위치를 매 프레임 갱신한다.
 * 화면 아래쪽(작업 영역 바닥)을 바닥으로 삼아 좌우로 걸어다니고,
 * 드래그해서 아무 데나 놓으면 중력으로 떨어진 뒤 다시 걷는다.
 */
class Walker {
  /**
   * @param {object} opts
   * @param {number} opts.size 캐릭터 창 한 변 크기(px)
   * @param {() => Electron.Rectangle} opts.getArea 작업 영역을 돌려주는 함수
   * @param {(x: number, y: number) => void} opts.onMove
   * @param {(state: object) => void} opts.onState
   */
  constructor({ size, getArea, onMove, onState }) {
    this.size = size;
    this.getArea = getArea;
    this.onMove = onMove;
    this.onState = onState;

    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1; // 1 = 오른쪽, -1 = 왼쪽
    this.mode = 'idle'; // idle | walk | fall | drag
    this.frozen = false; // 말풍선이 열려 있으면 제자리에 멈춘다
    this.busy = false; // Claude가 생각 중
    this.until = 0; // 현재 모드를 유지할 프레임 수
    this.timer = null;
    this.lastSent = null;
  }

  start() {
    const area = this.getArea();
    this.x = Math.round(area.x + area.width * 0.62);
    this.y = this.floorY();
    this.#plan();
    this.#emit(true);
    this.timer = setInterval(() => this.#tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  floorY() {
    const area = this.getArea();
    return area.y + area.height - this.size;
  }

  setFrozen(frozen) {
    this.frozen = frozen;
    if (frozen && this.mode === 'walk') {
      this.mode = 'idle';
      this.vx = 0;
      this.until = 0;
    }
    this.#emit();
  }

  setBusy(busy) {
    this.busy = busy;
    this.#emit();
  }

  beginDrag() {
    this.mode = 'drag';
    this.vx = 0;
    this.vy = 0;
    this.#emit();
  }

  dragTo(x, y) {
    if (this.mode !== 'drag') return;
    this.x = x;
    this.y = y;
    this.onMove(Math.round(this.x), Math.round(this.y));
  }

  endDrag() {
    if (this.mode !== 'drag') return;
    this.mode = 'fall';
    this.vy = 0;
    this.#emit();
  }

  /** 다음에 할 행동을 고른다. */
  #plan() {
    const area = this.getArea();
    if (this.frozen || this.busy) {
      this.mode = 'idle';
      this.vx = 0;
      this.until = 30;
      return;
    }

    // 60% 걷기, 40% 가만히 있기
    if (Math.random() < 0.6) {
      this.mode = 'walk';
      const goRight = this.x < area.x + 80 ? true : this.x > area.x + area.width - this.size - 80 ? false : Math.random() < 0.5;
      this.facing = goRight ? 1 : -1;
      this.vx = WALK_SPEED * this.facing;
      this.until = 90 + Math.floor(Math.random() * 260); // 1.5 ~ 5.8초
    } else {
      this.mode = 'idle';
      this.vx = 0;
      this.until = 120 + Math.floor(Math.random() * 300); // 2 ~ 7초
    }
  }

  #tick() {
    const area = this.getArea();
    const floor = this.floorY();

    if (this.mode === 'drag') return;

    if (this.mode === 'fall') {
      this.vy += GRAVITY;
      this.y += this.vy;
      if (this.y >= floor) {
        this.y = floor;
        if (this.vy > 3) {
          this.vy = -this.vy * BOUNCE; // 살짝 튕긴다
        } else {
          this.vy = 0;
          this.mode = 'idle';
          this.until = 45;
          this.#emit();
        }
      }
      // 떨어지는 중에도 화면 밖으로는 못 나가게
      this.x = Math.min(Math.max(this.x, area.x), area.x + area.width - this.size);
      this.onMove(Math.round(this.x), Math.round(this.y));
      return;
    }

    // 바닥에서 벗어나 있으면(해상도 변경 등) 다시 떨어뜨린다
    if (Math.abs(this.y - floor) > 1) {
      this.mode = 'fall';
      this.#emit();
      return;
    }

    if (this.mode === 'walk') {
      this.x += this.vx;
      const left = area.x;
      const right = area.x + area.width - this.size;
      if (this.x <= left || this.x >= right) {
        this.x = Math.min(Math.max(this.x, left), right);
        this.facing *= -1;
        this.vx = WALK_SPEED * this.facing;
        this.#emit();
      }
      this.onMove(Math.round(this.x), Math.round(this.y));
    }

    if (--this.until <= 0) {
      this.#plan();
      this.#emit();
    }
  }

  /** 렌더러가 스프라이트를 바꾸는 데 필요한 상태만 보낸다. */
  #emit(force = false) {
    const next = `${this.mode}|${this.facing}|${this.busy}|${this.frozen}`;
    if (!force && next === this.lastSent) return;
    this.lastSent = next;
    this.onState({ mode: this.mode, facing: this.facing, busy: this.busy, frozen: this.frozen });
  }
}

module.exports = { Walker, TICK_MS };
