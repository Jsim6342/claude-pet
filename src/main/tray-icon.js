'use strict';

const { nativeImage } = require('electron');

const SIZE = 32; // 실제 픽셀. scaleFactor 2 → 화면에서는 16pt로 보인다.

const FUR = [0x9c, 0xce, 0xf0];
const FUR_FAR = [0x7b, 0xb0, 0xd8];
const INK = [0x2f, 0x4a, 0x5c];

/** premultiplied BGRA 버퍼에 도형 하나를 합성한다. inside()가 덮는 범위를 정한다. */
function paint(buf, [r, g, b], bounds, inside) {
  const [x0, y0, x1, y1] = bounds.map((v, i) => Math.max(0, Math.min(SIZE - 1, Math.round(v))));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // 2x2 슈퍼샘플링으로 가장자리를 부드럽게
      let hits = 0;
      for (const dy of [0.25, 0.75]) {
        for (const dx of [0.25, 0.75]) if (inside(x + dx, y + dy)) hits++;
      }
      const cov = hits / 4;
      if (cov <= 0) continue;

      const i = (y * SIZE + x) * 4;
      const inv = 1 - cov;
      buf[i] = Math.round(b * cov + buf[i] * inv);
      buf[i + 1] = Math.round(g * cov + buf[i + 1] * inv);
      buf[i + 2] = Math.round(r * cov + buf[i + 2] * inv);
      buf[i + 3] = Math.round(255 * cov + buf[i + 3] * inv);
    }
  }
}

const circle = (buf, color, cx, cy, r) =>
  paint(buf, color, [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], (x, y) => Math.hypot(x - cx, y - cy) <= r);

/** 세 점으로 이루어진 삼각형 (귀) */
function triangle(buf, color, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const bounds = [
    Math.min(ax, bx, cx) - 1,
    Math.min(ay, by, cy) - 1,
    Math.max(ax, bx, cx) + 1,
    Math.max(ay, by, cy) + 1,
  ];
  paint(buf, color, bounds, (x, y) => {
    const d1 = sign(x, y, ax, ay, bx, by);
    const d2 = sign(x, y, bx, by, cx, cy);
    const d3 = sign(x, y, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  });
}

/** 가로로 누운 둥근 막대 (감은 눈) */
const bar = (buf, color, cx, cy, halfW, thick) =>
  paint(
    buf,
    color,
    [cx - halfW - 1, cy - thick - 1, cx + halfW + 1, cy + thick + 1],
    (x, y) => Math.abs(y - cy) <= thick && Math.abs(x - cx) <= halfW
  );

/**
 * 트레이 아이콘을 코드로 그린다(별도 png 파일 없이 동작하게).
 * 전신은 16pt에서 뭉개지므로 얼굴만 담는다.
 * 나중에 이미지로 바꿀 땐 nativeImage.createFromPath(...) 로 교체하면 된다.
 */
function makeTrayIcon() {
  const buf = Buffer.alloc(SIZE * SIZE * 4, 0);

  triangle(buf, FUR_FAR, [21, 10], [28, 2], [29, 12]); // 반대편 귀
  triangle(buf, FUR, [5, 11], [9, 2], [15, 9]); // 가까운 귀
  circle(buf, FUR, 16, 18, 12.5); // 머리

  bar(buf, INK, 11, 17, 2.6, 1.1); // 감은 왼쪽 눈
  bar(buf, INK, 21, 17, 2.6, 1.1); // 감은 오른쪽 눈

  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

module.exports = { makeTrayIcon };
