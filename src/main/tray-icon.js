'use strict';

const { nativeImage } = require('electron');

const SIZE = 32; // 실제 픽셀. scaleFactor 2 → 화면에서는 16pt로 보인다.

const CLAY = [0xd9, 0x77, 0x57];
const DARK = [0x3d, 0x2b, 0x24];

/** premultiplied BGRA 버퍼에 원을 하나 합성한다. */
function circle(buf, cx, cy, r, [cr, cg, cb], alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(SIZE - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(SIZE - 1, Math.ceil(cy + r + 1));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = Math.min(Math.max(r + 0.5 - d, 0), 1) * alpha;
      if (cov <= 0) continue;

      const i = (y * SIZE + x) * 4;
      const inv = 1 - cov;
      buf[i] = Math.round(cb * cov + buf[i] * inv);
      buf[i + 1] = Math.round(cg * cov + buf[i + 1] * inv);
      buf[i + 2] = Math.round(cr * cov + buf[i + 2] * inv);
      buf[i + 3] = Math.round(255 * cov + buf[i + 3] * inv);
    }
  }
}

/**
 * 트레이 아이콘을 코드로 그린다(별도 png 파일 없이 동작하게).
 * 나중에 이미지로 바꿀 땐 이 함수만 nativeImage.createFromPath(...)로 교체하면 된다.
 */
function makeTrayIcon() {
  const buf = Buffer.alloc(SIZE * SIZE * 4, 0);

  circle(buf, 9, 10, 4.5, CLAY); // 왼쪽 귀
  circle(buf, 23, 10, 4.5, CLAY); // 오른쪽 귀
  circle(buf, 16, 19, 11.5, CLAY); // 몸통
  circle(buf, 12, 17, 1.8, DARK); // 왼쪽 눈
  circle(buf, 20, 17, 1.8, DARK); // 오른쪽 눈

  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

module.exports = { makeTrayIcon };
