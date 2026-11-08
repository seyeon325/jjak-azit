/**
 * 소품(나무·게시판·모닥불·놀이기구·포털 등) 픽셀 아트.
 * 각 함수는 PixelCanvas 를 돌려주며, 원점은 (가운데, 바닥) 기준으로 배치됩니다.
 */
import type { PropKind } from '../../../../shared/map';
import { P } from './palette';
import { drawPixelText, hash2, measurePixelText, mix, PixelCanvas, PIXEL_FONT } from './pixel';

const OUT = P.ink;
const TREE_OUT = '#3f5a48';

function canopy(pc: PixelCanvas, blobs: [number, number, number][], colors: [string, string, string, string], seed: number) {
  const [base, dark, light, deep] = colors;
  // 전체 덩어리의 경계 상자
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, cy, r] of blobs) {
    minY = Math.min(minY, cy - r);
    maxY = Math.max(maxY, cy + r);
  }
  for (let y = 0; y < pc.h; y++)
    for (let x = 0; x < pc.w; x++) {
      let best: [number, number] | null = null;
      for (const [cx, cy, r] of blobs) {
        const dx = (x + 0.5 - cx) / r;
        const dy = (y + 0.5 - cy) / r;
        const d = dx * dx + dy * dy;
        if (d <= 1 && (!best || d < best[0] * best[0] + best[1] * best[1])) best = [dx, dy];
      }
      if (!best) continue;
      const gy = (y - minY) / (maxY - minY); // 0 위 ~ 1 아래
      const n = hash2(x, y, seed);
      const v = best[0] * 0.55 + best[1] * 0.75 + (gy - 0.5) * 0.9 + (n - 0.5) * 0.45;
      let c: string = base;
      if (v > 0.95) c = deep;
      else if (v > 0.4) c = dark;
      else if (v < -0.75) c = light;
      pc.set(x, y, c);
    }
  // 잎 질감: 작은 하이라이트 점
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(hash2(i, 1, seed) * pc.w);
    const y = Math.floor(minY + hash2(i, 2, seed) * (maxY - minY) * 0.6);
    if (pc.get(x, y) && pc.get(x + 1, y)) {
      pc.set(x, y, light);
      pc.set(x + 1, y, light);
      if (pc.get(x, y + 1)) pc.set(x, y + 1, base);
    }
  }
}

function trunk(pc: PixelCanvas, cx: number, top: number, bottom: number) {
  for (let y = top; y <= bottom; y++) {
    const flare = y >= bottom - 1 ? 1 : 0;
    for (let x = cx - 3 - flare; x <= cx + 2 + flare; x++) {
      const rel = x - (cx - 3);
      pc.set(x, y, rel <= 0 ? '#c99167' : rel >= 4 ? '#8a5a3e' : '#a8714f');
    }
  }
  pc.set(cx - 1, top + 3, '#8a5a3e');
  pc.set(cx, top + 6, '#8a5a3e');
}

function tree(variant: 'leafy' | 'round' | 'blossom', seed: number): PixelCanvas {
  const pc = new PixelCanvas(34, 46);
  trunk(pc, 17, 30, 43);
  if (variant === 'leafy') {
    canopy(
      pc,
      [
        [17, 13, 10],
        [10, 20, 8],
        [24, 20, 8],
        [17, 25, 8.5],
        [12, 11, 6],
        [22, 12, 6],
      ],
      [P.leaf, P.leafDark, P.leafLight, P.leafDeep],
      seed,
    );
  } else if (variant === 'round') {
    canopy(
      pc,
      [
        [17, 17, 12.5],
        [11, 24, 6],
        [23, 24, 6],
      ],
      ['#8dcf72', '#6bb15f', '#b9e793', '#538f52'],
      seed,
    );
    // 열매
    for (const [x, y] of [
      [11, 14],
      [21, 11],
      [24, 21],
      [14, 23],
      [18, 18],
    ]) {
      pc.set(x, y, P.coral);
      pc.set(x + 1, y, P.coralDark);
      pc.set(x, y - 1, P.coralLight);
    }
  } else {
    canopy(
      pc,
      [
        [17, 15, 11],
        [10, 21, 7.5],
        [24, 21, 7.5],
        [17, 25, 8],
      ],
      ['#ffc6d6', '#f3a2bc', '#ffe3ec', '#e488a6'],
      seed,
    );
    for (let i = 0; i < 10; i++) {
      const x = 6 + Math.floor(hash2(i, 9, seed) * 22);
      const y = 6 + Math.floor(hash2(i, 7, seed) * 20);
      if (pc.opaque(x, y)) pc.set(x, y, '#ffffff');
    }
  }
  pc.outline(TREE_OUT);
  return pc;
}

function bush(): PixelCanvas {
  const pc = new PixelCanvas(20, 15);
  canopy(
    pc,
    [
      [10, 8, 7.5],
      [5.5, 9.5, 4.5],
      [14.5, 9.5, 4.5],
    ],
    [P.leaf, P.leafDark, P.leafLight, P.leafDeep],
    77,
  );
  for (const [x, y, c] of [
    [6, 6, '#ffffff'],
    [13, 5, P.pink],
    [10, 9, '#ffffff'],
    [15, 10, P.lemon],
  ] as const) {
    pc.set(x, y, c);
  }
  pc.outline(TREE_OUT);
  return pc;
}

function lamp(): PixelCanvas {
  const pc = new PixelCanvas(14, 44);
  // 기둥
  pc.rect(6, 13, 2, 27, P.slate);
  pc.vline(7, 13, 39, P.slateDark);
  pc.rect(4, 39, 6, 3, P.slate);
  pc.hline(4, 9, 41, P.slateDark);
  pc.rect(5, 24, 4, 1, P.slateLight);
  // 등
  pc.rect(4, 1, 6, 1, P.slate);
  pc.rect(3, 2, 8, 2, P.slate);
  pc.rect(3, 4, 8, 7, '#ffe9a6');
  pc.rect(5, 5, 4, 5, '#fff8d8');
  pc.vline(3, 4, 10, P.slateDark);
  pc.vline(10, 4, 10, P.slateDark);
  pc.vline(7, 4, 10, '#f5d27c');
  pc.rect(3, 11, 8, 2, P.slate);
  pc.outline(OUT);
  return pc;
}

function bench(): PixelCanvas {
  const pc = new PixelCanvas(30, 19);
  // 등받이
  pc.rect(2, 2, 26, 3, P.wood);
  pc.hline(2, 27, 4, P.woodDark);
  pc.hline(2, 27, 2, P.woodLight);
  pc.rect(2, 6, 26, 2, P.wood);
  pc.hline(2, 27, 7, P.woodDark);
  pc.rect(4, 5, 2, 1, P.slate);
  pc.rect(24, 5, 2, 1, P.slate);
  // 좌석
  pc.rect(1, 9, 28, 4, P.woodLight);
  pc.hline(1, 28, 12, P.woodDark);
  pc.hline(1, 28, 10, P.wood);
  // 다리
  pc.rect(3, 13, 2, 4, P.slate);
  pc.rect(25, 13, 2, 4, P.slate);
  pc.outline(OUT);
  return pc;
}

function board(): PixelCanvas {
  const pc = new PixelCanvas(90, 64);
  // 기둥
  pc.rect(8, 12, 4, 50, P.woodDark);
  pc.rect(78, 12, 4, 50, P.woodDark);
  pc.vline(8, 12, 61, P.wood);
  pc.vline(78, 12, 61, P.wood);
  // 프레임
  pc.rect(3, 5, 84, 44, P.wood);
  pc.hline(3, 86, 5, P.woodLight);
  pc.hline(3, 86, 48, P.woodDeep);
  pc.rect(6, 20, 78, 26, '#e7c193');
  for (let y = 20; y < 46; y++)
    for (let x = 6; x < 84; x++) {
      const n = hash2(x, y, 5);
      if (n > 0.86) pc.set(x, y, '#d7ad7c');
      else if (n < 0.06) pc.set(x, y, '#f1d3ad');
    }
  pc.hline(6, 83, 20, '#c99a68');
  // 머리판
  pc.rect(7, 7, 76, 12, P.cream);
  pc.hline(7, 82, 18, P.cream2);
  drawPixelText(pc, '메시지 게시판', 45, 7, P.ink);
  // 쪽지들 (빈 쪽지 — 2차에서 실제 메시지가 붙을 자리)
  const notes: [number, number, string][] = [
    [10, 23, P.lemon],
    [24, 26, P.mint],
    [39, 23, P.skyLight],
    [54, 27, P.pink],
    [68, 23, '#fff6e4'],
    [15, 35, P.lavenderLight],
    [33, 36, P.coralLight],
    [61, 36, P.lemon],
  ];
  for (const [x, y, c] of notes) {
    pc.rect(x, y, 12, 9, c);
    pc.hline(x, x + 11, y + 8, mix(c, '#7a5a5a', 0.25));
    pc.hline(x + 2, x + 8, y + 3, mix(c, '#6d5a72', 0.35));
    pc.hline(x + 2, x + 6, y + 5, mix(c, '#6d5a72', 0.35));
    pc.set(x + 5, y, P.coralDark);
    pc.set(x + 6, y, P.coralDark);
  }
  // 준비 중 꼬리표
  const tagW = measurePixelText('준비 중', PIXEL_FONT) + 10;
  const tx = 45 - Math.floor(tagW / 2);
  pc.rect(tx, 50, tagW, 13, P.lemon);
  pc.hline(tx, tx + tagW - 1, 62, P.lemonDark);
  pc.vline(tx + 3, 47, 49, P.slate);
  pc.vline(tx + tagW - 4, 47, 49, P.slate);
  drawPixelText(pc, '준비 중', 45, 50, P.ink);
  pc.outline(OUT);
  return pc;
}

function pot(): PixelCanvas {
  const pc = new PixelCanvas(14, 18);
  canopy(
    pc,
    [
      [7, 6, 5.5],
      [4, 8, 3.5],
      [10, 8, 3.5],
    ],
    [P.leaf, P.leafDark, P.leafLight, P.leafDeep],
    31,
  );
  pc.set(5, 4, P.pink);
  pc.set(9, 6, P.lemon);
  pc.rect(3, 10, 8, 6, '#e98f6f');
  pc.hline(2, 11, 10, '#f5a98c');
  pc.hline(2, 11, 11, '#d2775a');
  pc.vline(10, 12, 15, '#d2775a');
  pc.outline(OUT);
  return pc;
}

function sign(label: string): PixelCanvas {
  const tw = measurePixelText(label, PIXEL_FONT);
  const w = Math.max(30, tw + 12);
  const pc = new PixelCanvas(w + 2, 30);
  const cx = Math.floor((w + 2) / 2);
  pc.rect(cx - 1, 15, 3, 14, P.woodDark);
  pc.vline(cx - 1, 15, 28, P.wood);
  pc.rect(1, 1, w, 15, P.woodLight);
  pc.hline(1, w, 1, '#f5d6ad');
  pc.hline(1, w, 15, P.woodDark);
  pc.set(3, 3, P.woodDark);
  pc.set(w - 2, 3, P.woodDark);
  drawPixelText(pc, label, cx, 2, P.ink);
  pc.outline(OUT);
  return pc;
}

function campfireBase(): PixelCanvas {
  const pc = new PixelCanvas(28, 18);
  // 장작
  pc.line(6, 11, 21, 6, P.woodDeep);
  pc.line(6, 12, 21, 7, '#a8714f');
  pc.line(6, 6, 21, 11, '#a8714f');
  pc.line(6, 7, 21, 12, P.woodDeep);
  pc.rect(12, 8, 4, 2, '#5c3b2c');
  // 돌 테두리
  const stones: [number, number][] = [
    [3, 10],
    [6, 14],
    [11, 15],
    [17, 15],
    [22, 14],
    [25, 10],
    [5, 6],
    [23, 6],
  ];
  for (const [x, y] of stones)
    pc.ellipse(x, y, 2.6, 2, (dx, dy) => (dx + dy > 0.4 ? P.stoneDark : dx + dy < -0.6 ? P.stoneLight : P.stone));
  pc.outline(OUT);
  return pc;
}

/** 불꽃 4프레임 시트 */
function flameSheet(): PixelCanvas {
  const fw = 16;
  const fh = 20;
  const sheet = new PixelCanvas(fw * 4, fh);
  for (let f = 0; f < 4; f++) {
    const pc = new PixelCanvas(fw, fh);
    const sway = [0, 1, 0, -1][f];
    for (let y = 2; y < fh - 1; y++)
      for (let x = 1; x < fw - 1; x++) {
        const t = (y - 2) / (fh - 3); // 0 위 ~ 1 아래
        const half = 1 + t * 5.5;
        const cx = 8 + sway * (1 - t) * 1.6;
        const wob = Math.sin(y * 0.9 + f * 1.7) * (1 - t) * 1.2;
        const d = Math.abs(x + 0.5 - cx - wob);
        if (d > half) continue;
        const flick = hash2(x, y, f * 13);
        if (t < 0.25 && flick > 0.55) continue;
        const k = d / half;
        let c: string = P.fire3;
        if (k < 0.35 && t > 0.35) c = P.fire1;
        else if (k < 0.65) c = P.fire2;
        else if (t > 0.75) c = P.fire4;
        pc.set(x, y, c);
      }
    // 불씨
    pc.set(4 + f, 2 + (f % 2), P.fire2);
    pc.set(12 - f, 4 - (f % 2), P.fire1);
    sheet.blit(pc, f * fw, 0);
  }
  return sheet;
}

function log(vertical: boolean): PixelCanvas {
  if (!vertical) {
    const pc = new PixelCanvas(32, 14);
    pc.rect(2, 3, 26, 8, '#b07a52');
    pc.hline(2, 27, 3, '#c99167');
    pc.hline(2, 27, 10, '#8a5a3e');
    for (const x of [7, 14, 21]) {
      pc.set(x, 5, '#8a5a3e');
      pc.set(x + 1, 6, '#8a5a3e');
      pc.set(x + 2, 8, '#8a5a3e');
    }
    pc.ellipse(28, 7, 3, 4.5, (dx, dy) => (dx * dx + dy * dy < 0.25 ? '#d9a877' : dx * dx + dy * dy < 0.55 ? '#e8c095' : '#d1996a'));
    pc.outline(OUT);
    return pc;
  }
  const pc = new PixelCanvas(14, 28);
  pc.rect(3, 4, 8, 20, '#b07a52');
  pc.vline(3, 4, 23, '#c99167');
  pc.vline(10, 4, 23, '#8a5a3e');
  for (const y of [9, 15, 20]) {
    pc.set(5, y, '#8a5a3e');
    pc.set(6, y + 1, '#8a5a3e');
  }
  pc.ellipse(7, 4, 4.5, 3, (dx, dy) => (dx * dx + dy * dy < 0.3 ? '#d9a877' : '#e8c095'));
  pc.outline(OUT);
  return pc;
}

function tent(): PixelCanvas {
  const pc = new PixelCanvas(44, 36);
  for (let y = 3; y <= 32; y++) {
    const t = (y - 3) / 29;
    const half = 2 + t * 18;
    for (let x = Math.round(22 - half); x <= Math.round(22 + half); x++) {
      const stripe = Math.floor((x - 22 + 40) / 5) % 2 === 0;
      let c: string = stripe ? P.cream : P.coral;
      if (x > 22) c = stripe ? P.cream2 : P.coralDark;
      pc.set(x, y, c);
    }
  }
  // 입구
  for (let y = 16; y <= 32; y++) {
    const half = ((y - 16) / 16) * 6;
    for (let x = Math.round(22 - half); x <= Math.round(22 + half); x++) pc.set(x, y, '#5b4660');
  }
  pc.vline(22, 1, 3, P.woodDark);
  pc.set(23, 1, P.lemon);
  pc.set(24, 1, P.lemon);
  pc.set(23, 2, P.lemon);
  pc.outline(OUT);
  return pc;
}

function lantern(): PixelCanvas {
  const pc = new PixelCanvas(12, 26);
  pc.rect(5, 9, 2, 15, P.woodDark);
  pc.rect(3, 23, 6, 2, P.woodDark);
  pc.hline(3, 8, 3, P.woodDeep);
  pc.rect(3, 4, 6, 6, '#ffd77d');
  pc.rect(4, 5, 4, 4, '#fff3c2');
  pc.hline(3, 8, 9, '#e9b05a');
  pc.outline(OUT);
  return pc;
}

function slide(): PixelCanvas {
  const pc = new PixelCanvas(44, 46);
  // 사다리
  pc.rect(28, 8, 2, 34, P.slate);
  pc.rect(38, 8, 2, 34, P.slate);
  for (let y = 14; y <= 38; y += 6) pc.rect(30, y, 8, 2, P.slateLight);
  // 지붕/플랫폼
  pc.rect(25, 5, 17, 5, P.coral);
  pc.hline(25, 41, 5, P.coralLight);
  pc.hline(25, 41, 9, P.coralDark);
  pc.rect(27, 1, 13, 4, P.lemon);
  pc.hline(27, 39, 1, '#ffe6a3');
  // 미끄럼틀
  for (let i = 0; i <= 30; i++) {
    const x = 26 - i * 0.75;
    const y = 9 + i;
    for (let k = 0; k < 9; k++) {
      const c = k === 0 || k === 8 ? P.skyDark : k < 3 ? P.skyLight : P.sky;
      pc.set(Math.round(x - 4 + k * 0.6), Math.round(y + k * 0.35), c);
    }
  }
  pc.rect(2, 40, 10, 3, P.sky);
  pc.hline(2, 11, 42, P.skyDark);
  pc.outline(OUT);
  return pc;
}

function swing(): PixelCanvas {
  const pc = new PixelCanvas(60, 46);
  // 기둥 (A자)
  pc.line(3, 43, 9, 4, P.coralDark);
  pc.line(4, 43, 10, 4, P.coral);
  pc.line(15, 43, 9, 4, P.coral);
  pc.line(56, 43, 50, 4, P.coralDark);
  pc.line(55, 43, 49, 4, P.coral);
  pc.line(44, 43, 50, 4, P.coral);
  pc.rect(7, 3, 46, 3, P.lemon);
  pc.hline(7, 52, 3, '#ffe6a3');
  pc.hline(7, 52, 5, P.lemonDark);
  // 줄 + 의자
  for (const [a, b] of [
    [20, 27],
    [33, 40],
  ]) {
    pc.vline(a, 6, 32, P.slateLight);
    pc.vline(b, 6, 32, P.slateLight);
    pc.rect(a - 1, 32, b - a + 3, 3, P.sky);
    pc.hline(a - 1, b + 1, 34, P.skyDark);
  }
  pc.outline(OUT);
  return pc;
}

function seesaw(): PixelCanvas {
  const pc = new PixelCanvas(48, 22);
  pc.line(3, 6, 44, 11, P.lemonDark);
  for (let i = 0; i < 3; i++) pc.line(3, 3 + i, 44, 8 + i, i === 0 ? '#ffe6a3' : P.lemon);
  // 손잡이
  pc.rect(7, 0, 2, 4, P.slate);
  pc.rect(39, 5, 2, 4, P.slate);
  // 받침
  for (let y = 9; y <= 19; y++) {
    const half = (y - 9) * 0.6 + 1;
    for (let x = Math.round(24 - half); x <= Math.round(24 + half); x++) pc.set(x, y, x > 24 ? P.coralDark : P.coral);
  }
  pc.outline(OUT);
  return pc;
}

function castle(): PixelCanvas {
  const pc = new PixelCanvas(28, 24);
  const S = '#f0d08f';
  const SD = '#dcb677';
  pc.rect(4, 11, 14, 10, S);
  pc.rect(2, 7, 5, 14, S);
  pc.rect(15, 7, 5, 14, S);
  for (const x of [2, 5, 15, 18]) pc.rect(x, 5, 2, 2, S);
  pc.rect(9, 9, 4, 3, S);
  pc.rect(9, 15, 4, 6, SD);
  pc.vline(19, 7, 20, SD);
  pc.vline(11, 2, 8, P.woodDark);
  pc.rect(12, 2, 4, 3, P.coral);
  // 양동이
  pc.rect(21, 15, 6, 6, P.sky);
  pc.hline(20, 27, 14, P.skyDark);
  pc.vline(26, 15, 20, P.skyDark);
  pc.outline(OUT);
  return pc;
}

function spring(): PixelCanvas {
  const pc = new PixelCanvas(18, 24);
  for (let y = 14; y <= 20; y++) pc.set(y % 2 ? 8 : 10, y, P.slate);
  pc.rect(5, 20, 9, 2, P.slateDark);
  pc.ellipse(9, 9, 6, 5, (dx, dy) => (dx + dy > 0.6 ? P.lemonDark : dx + dy < -0.7 ? '#ffe9a8' : P.lemon));
  pc.circle(5, 4, 3.4, (dx, dy) => (dx + dy > 0.7 ? P.lemonDark : P.lemon));
  pc.set(4, 3, P.ink);
  pc.rect(0, 4, 2, 2, P.coral);
  pc.rect(12, 7, 3, 3, '#ffe9a8');
  pc.outline(OUT);
  return pc;
}

function portalFrame(): PixelCanvas {
  const pc = new PixelCanvas(60, 72);
  const cx = 30;
  // 아치 바깥/안쪽
  for (let y = 0; y < 70; y++)
    for (let x = 0; x < 60; x++) {
      const ay = 24;
      const inOuter = y >= ay ? x >= 3 && x <= 56 : (x + 0.5 - cx) ** 2 / 27 ** 2 + (y + 0.5 - ay) ** 2 / 22 ** 2 <= 1;
      const inInner = y >= ay ? x >= 14 && x <= 45 : (x + 0.5 - cx) ** 2 / 16 ** 2 + (y + 0.5 - ay) ** 2 / 13 ** 2 <= 1;
      if (!inOuter || (inInner && y < 66) || y > 66) continue;
      // 돌 블록 무늬
      const row = Math.floor(y / 6);
      const off = row % 2 ? 4 : 0;
      const grout = y % 6 === 5 || (x + off) % 9 === 0;
      const n = hash2(Math.floor((x + off) / 9), row, 3);
      let c: string = n > 0.6 ? P.stone : n > 0.25 ? '#ccd0e2' : P.stoneLight;
      if (grout) c = P.stoneDark;
      if (x > 50 || (x > 40 && x < 46 && y > 24)) c = grout ? '#9fa4bd' : mix(c, P.stoneDark, 0.5);
      pc.set(x, y, c);
    }
  // 받침돌
  pc.rect(0, 64, 18, 6, P.stoneDark);
  pc.rect(42, 64, 18, 6, P.stoneDark);
  pc.hline(0, 17, 64, P.stone);
  pc.hline(42, 59, 64, P.stone);
  // 룬 (빛나는 점)
  for (const [x, y] of [
    [8, 32],
    [8, 44],
    [8, 56],
    [51, 32],
    [51, 44],
    [51, 56],
  ]) {
    pc.rect(x - 1, y, 3, 3, P.lavender);
    pc.set(x, y + 1, '#f1eaff');
  }
  // 쐐기돌
  pc.rect(26, 2, 8, 9, P.lavender);
  pc.rect(27, 3, 6, 7, P.lavenderLight);
  pc.rect(29, 5, 2, 3, '#ffffff');
  pc.outline(OUT);
  return pc;
}

/** 포털 소용돌이 6프레임 */
function swirlSheet(): PixelCanvas {
  const fw = 34;
  const fh = 46;
  const sheet = new PixelCanvas(fw * 6, fh);
  for (let f = 0; f < 6; f++) {
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const ay = 16;
        const inside =
          y >= ay ? x >= 1 && x <= 32 : (x + 0.5 - 17) ** 2 / 16 ** 2 + (y + 0.5 - ay) ** 2 / 15 ** 2 <= 1;
        if (!inside) continue;
        const dx = (x + 0.5 - 17) / 16;
        const dy = (y + 0.5 - 26) / 22;
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        const v = Math.sin(a * 3 + r * 9 - (f / 6) * Math.PI * 2);
        let c: string;
        if (r < 0.18) c = '#ffffff';
        else if (r < 0.32) c = v > 0 ? '#eef2ff' : P.lavenderLight;
        else if (v > 0.55) c = P.skyLight;
        else if (v > 0) c = P.lavender;
        else if (v > -0.5) c = '#8d73d0';
        else c = '#6e58b5';
        sheet.set(f * fw + x, y, c);
      }
  }
  return sheet;
}

function crystal(): PixelCanvas {
  const pc = new PixelCanvas(16, 24);
  const shard = (cx: number, top: number, w: number, bottom: number) => {
    for (let y = top; y <= bottom; y++) {
      const t = Math.min(1, (y - top) / 4);
      const half = Math.max(0.5, t * w);
      for (let x = Math.round(cx - half); x <= Math.round(cx + half - 0.5); x++)
        pc.set(x, y, x < cx ? P.lavenderLight : x > cx ? P.lavenderDark : P.lavender);
    }
  };
  shard(8, 2, 3, 21);
  shard(4, 10, 2, 21);
  shard(12, 8, 2, 21);
  pc.set(7, 6, '#ffffff');
  pc.set(7, 7, '#ffffff');
  pc.outline(OUT);
  return pc;
}

function barrier(): PixelCanvas {
  const tw = measurePixelText('준비 중', PIXEL_FONT);
  const w = Math.max(50, tw + 26);
  const pc = new PixelCanvas(w, 24);
  for (const x0 of [2, w - 6]) {
    for (let y = 2; y < 22; y++) pc.rect(x0, y, 4, 1, Math.floor(y / 3) % 2 ? P.ink : P.lemon);
  }
  pc.rect(5, 5, w - 10, 14, P.lemon);
  pc.hline(5, w - 6, 5, '#ffe6a3');
  pc.hline(5, w - 6, 18, P.lemonDark);
  drawPixelText(pc, '준비 중', Math.floor(w / 2), 6, P.ink);
  pc.outline(OUT);
  return pc;
}

function banner(): PixelCanvas {
  const text = '짝선짝후 아지트';
  const tw = measurePixelText(text, PIXEL_FONT);
  const w = tw + 26;
  const pc = new PixelCanvas(w, 24);
  pc.rect(1, 3, w - 2, 18, P.coral);
  pc.rect(3, 5, w - 6, 14, '#ff9e8a');
  pc.hline(1, w - 2, 3, P.coralLight);
  pc.hline(1, w - 2, 20, P.coralDark);
  for (const x of [5, w - 6]) {
    pc.rect(x - 1, 9, 3, 3, P.lemon);
    pc.set(x, 10, '#fff6d0');
  }
  drawPixelText(pc, text, Math.floor(w / 2), 6, P.cream, { shadow: P.coralDark });
  pc.outline(OUT);
  return pc;
}

function door(): PixelCanvas {
  const pc = new PixelCanvas(36, 26);
  for (let y = 2; y < 26; y++)
    for (let x = 3; x < 33; x++) {
      const ay = 10;
      if (y < ay && (x + 0.5 - 18) ** 2 / 15 ** 2 + (y + 0.5 - ay) ** 2 / 8 ** 2 > 1) continue;
      let c: string = P.wood;
      if (x === 17 || x === 18) c = P.woodDeep;
      else if ((x - 3) % 5 === 0) c = P.woodDark;
      pc.set(x, y, c);
    }
  pc.rect(9, 9, 5, 5, P.glass);
  pc.rect(22, 9, 5, 5, P.glass);
  pc.set(10, 10, P.glassLight);
  pc.set(23, 10, P.glassLight);
  pc.rect(15, 16, 2, 2, P.lemon);
  pc.rect(19, 16, 2, 2, P.lemon);
  pc.outline(OUT);
  return pc;
}

function lily(): PixelCanvas {
  const pc = new PixelCanvas(16, 10);
  pc.ellipse(8, 5, 6.5, 3.6, (dx, dy) => (dx > 0.1 && Math.abs(dy) < 0.25 ? null : dy > 0.3 ? '#5fae62' : '#7cc96a'));
  pc.set(6, 3, P.pink);
  pc.set(7, 3, P.pink);
  pc.set(6, 4, '#ffffff');
  pc.set(7, 2, P.pink);
  pc.outline('#4f8b6b');
  return pc;
}

function reed(): PixelCanvas {
  const pc = new PixelCanvas(14, 20);
  pc.vline(4, 6, 18, P.leafDark);
  pc.vline(8, 3, 18, P.leafDark);
  pc.vline(11, 8, 18, P.leafDark);
  pc.rect(3, 4, 2, 4, P.woodDeep);
  pc.rect(7, 1, 2, 4, P.woodDeep);
  pc.line(2, 18, 0, 12, P.leaf);
  pc.line(12, 18, 13, 13, P.leaf);
  pc.outline(TREE_OUT);
  return pc;
}

// ------------------------------------------------------------------ 공개 API

export interface PropArt {
  canvas: HTMLCanvasElement;
  frames?: { w: number; h: number; count: number };
}

const cache = new Map<string, PropArt>();

export function propTextureKey(kind: PropKind, label?: string) {
  return kind === 'sign' ? `prop-sign-${label ?? ''}` : `prop-${kind}`;
}

export function buildProp(kind: PropKind, label?: string): PropArt {
  const key = propTextureKey(kind, label);
  const hit = cache.get(key);
  if (hit) return hit;
  let pc: PixelCanvas;
  switch (kind) {
    case 'tree':
      pc = tree('leafy', 11);
      break;
    case 'treeRound':
      pc = tree('round', 23);
      break;
    case 'blossom':
      pc = tree('blossom', 41);
      break;
    case 'bush':
      pc = bush();
      break;
    case 'lamp':
      pc = lamp();
      break;
    case 'bench':
      pc = bench();
      break;
    case 'board':
      pc = board();
      break;
    case 'pot':
      pc = pot();
      break;
    case 'sign':
      pc = sign(label ?? '');
      break;
    case 'campfire':
      pc = campfireBase();
      break;
    case 'log':
      pc = log(false);
      break;
    case 'logV':
      pc = log(true);
      break;
    case 'tent':
      pc = tent();
      break;
    case 'lantern':
      pc = lantern();
      break;
    case 'slide':
      pc = slide();
      break;
    case 'swing':
      pc = swing();
      break;
    case 'seesaw':
      pc = seesaw();
      break;
    case 'castle':
      pc = castle();
      break;
    case 'spring':
      pc = spring();
      break;
    case 'portal':
      pc = portalFrame();
      break;
    case 'crystal':
      pc = crystal();
      break;
    case 'barrier':
      pc = barrier();
      break;
    case 'banner':
      pc = banner();
      break;
    case 'door':
      pc = door();
      break;
    case 'lily':
      pc = lily();
      break;
    case 'reed':
      pc = reed();
      break;
  }
  const art = { canvas: pc.flush() };
  cache.set(key, art);
  return art;
}

/** 애니메이션 시트들 */
export function buildFlameSheet() {
  return { canvas: flameSheet().flush(), w: 16, h: 20, count: 4 };
}
export function buildSwirlSheet() {
  return { canvas: swirlSheet().flush(), w: 34, h: 46, count: 6 };
}

/** 부드러운 빛 (가산 혼합용) */
export function buildGlow(size = 64, color = '255,214,140'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color},0.9)`);
  g.addColorStop(0.45, `rgba(${color},0.35)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** 캐릭터 그림자 */
export function buildShadow(): HTMLCanvasElement {
  const pc = new PixelCanvas(14, 6);
  pc.ellipse(7, 3, 6.5, 2.6, '#3d304744');
  pc.ellipse(7, 3, 4.5, 1.6, '#3d304766');
  return pc.flush();
}

/** 작은 반짝이 */
export function buildSparkle(): HTMLCanvasElement {
  const pc = new PixelCanvas(5, 5);
  pc.set(2, 0, '#ffffff');
  pc.set(2, 4, '#ffffff');
  pc.set(0, 2, '#ffffff');
  pc.set(4, 2, '#ffffff');
  pc.rect(1, 1, 3, 3, '#fff6c8');
  pc.set(2, 2, '#ffffff');
  return pc.flush();
}

export function buildDot(color: string, size = 2): HTMLCanvasElement {
  const pc = new PixelCanvas(size, size);
  pc.rect(0, 0, size, size, color);
  return pc.flush();
}

/** 바닥에 굽는 그림자 반지름 */
export const PROP_SHADOW: Partial<Record<PropKind, [number, number]>> = {
  tree: [11, 4],
  treeRound: [11, 4],
  blossom: [11, 4],
  bush: [8, 3],
  lamp: [5, 2],
  bench: [13, 3],
  board: [38, 4],
  pot: [6, 2],
  sign: [5, 2],
  campfire: [13, 4],
  log: [14, 3],
  logV: [6, 3],
  tent: [20, 4],
  lantern: [4, 2],
  slide: [20, 4],
  swing: [27, 3],
  seesaw: [20, 3],
  castle: [12, 3],
  spring: [6, 2],
  portal: [28, 5],
  crystal: [6, 2],
  barrier: [22, 3],
  reed: [5, 2],
};
