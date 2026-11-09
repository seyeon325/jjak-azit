/**
 * 1차 수정에서 추가된 소품: 푸드트럭 존, 카피바라 온천, 새 게시판.
 */
import { FOODS } from '../../../../shared/foods';
import { buildFood } from './foods';
import { P } from './palette';
import { drawPixelText, hash2, measurePixelText, mix, PixelCanvas } from './pixel';

const OUT = P.ink;

// ------------------------------------------------------------------ 게시판 (광장 중앙)

export function board(): PixelCanvas {
  const W = 94;
  const pc = new PixelCanvas(W, 70);
  // 기둥
  pc.rect(9, 18, 4, 50, P.woodDark);
  pc.rect(81, 18, 4, 50, P.woodDark);
  pc.vline(9, 18, 67, P.wood);
  pc.vline(81, 18, 67, P.wood);
  // 지붕
  for (let y = 0; y < 9; y++) {
    const inset = Math.max(0, 6 - y);
    for (let x = 2 + inset; x < W - 2 - inset; x++) {
      const tile = (x + (y % 2 ? 3 : 0)) % 6 === 0;
      pc.set(x, y + 2, y === 8 ? P.roofDark : tile ? P.roofDark : y < 3 ? P.roofLight : P.roof);
    }
  }
  // 프레임 + 코르크
  pc.rect(4, 11, W - 8, 44, P.wood);
  pc.hline(4, W - 5, 11, P.woodLight);
  pc.hline(4, W - 5, 54, P.woodDeep);
  pc.rect(7, 26, W - 14, 26, '#e7c193');
  for (let y = 26; y < 52; y++)
    for (let x = 7; x < W - 7; x++) {
      const n = hash2(x, y, 5);
      if (n > 0.86) pc.set(x, y, '#d7ad7c');
      else if (n < 0.06) pc.set(x, y, '#f1d3ad');
    }
  // 머리판
  pc.rect(9, 13, W - 18, 12, P.cream);
  pc.hline(9, W - 10, 24, P.cream2);
  drawPixelText(pc, '메시지 게시판', W / 2, 13, P.ink);
  // 포스트잇들
  const notes: [number, number, string, number][] = [
    [10, 28, P.lemon, -1],
    [23, 30, P.mint, 0],
    [36, 27, P.skyLight, 1],
    [50, 31, P.pink, 0],
    [64, 28, '#fff6e4', -1],
    [76, 31, P.lavenderLight, 1],
    [14, 40, P.coralLight, 0],
    [29, 41, P.lemon, 1],
    [44, 40, P.mint, -1],
    [58, 42, P.skyLight, 0],
    [71, 41, P.pink, 1],
  ];
  for (const [x, y, c, tilt] of notes) {
    pc.rect(x, y, 10, 9, c);
    pc.hline(x, x + 9, y + 8, mix(c, '#7a5a5a', 0.3));
    if (tilt) pc.set(tilt > 0 ? x + 9 : x, y + 8, '#e7c193');
    pc.hline(x + 2, x + 7, y + 3, mix(c, '#6d5a72', 0.4));
    pc.hline(x + 2, x + 5, y + 5, mix(c, '#6d5a72', 0.4));
    pc.set(x + 4, y, P.coralDark);
    pc.set(x + 5, y, P.coralDark);
  }
  // 작은 하트
  pc.set(84, 46, '#ff7a9c');
  pc.set(86, 46, '#ff7a9c');
  pc.hline(84, 86, 47, '#ff7a9c');
  pc.set(85, 48, '#ff7a9c');
  pc.outline(OUT);
  return pc;
}

// ------------------------------------------------------------------ 푸드트럭 존

export function foodTruck(): PixelCanvas {
  const W = 104;
  const pc = new PixelCanvas(W, 74);
  const body = '#fff6e4';
  const bodyD = '#f0dcc0';
  // 간판
  const title = '축제 간식';
  const tw = measurePixelText(title) + 14;
  const sx = Math.round(W / 2 - tw / 2) - 6;
  pc.rect(sx, 0, tw, 14, P.lemon);
  pc.hline(sx, sx + tw - 1, 13, P.lemonDark);
  pc.hline(sx, sx + tw - 1, 0, '#ffe6a3');
  drawPixelText(pc, title, sx + tw / 2, 1, P.ink);
  pc.rect(sx + 6, 14, 2, 4, P.slate);
  pc.rect(sx + tw - 8, 14, 2, 4, P.slate);
  // 지붕
  pc.rect(3, 18, 84, 4, P.coral);
  pc.hline(3, 86, 18, P.coralLight);
  // 몸체
  pc.rect(3, 22, 84, 38, body);
  pc.vline(86, 22, 59, bodyD);
  pc.rect(3, 50, 84, 6, P.mint);
  pc.hline(3, 86, 55, P.mintDark);
  // 운전석
  pc.rect(87, 30, 14, 30, body);
  pc.rect(88, 32, 10, 10, P.glass);
  pc.set(89, 33, P.glassLight);
  pc.set(90, 34, P.glassLight);
  pc.rect(87, 50, 14, 6, P.mint);
  pc.rect(98, 46, 3, 2, P.lemon);
  // 판매 창
  pc.rect(16, 28, 58, 18, '#5b4660');
  pc.rect(18, 30, 54, 3, '#6d5a72');
  // 차양 (줄무늬 + 물결 끝)
  for (let x = 12; x < 78; x++) {
    const stripe = Math.floor((x - 12) / 6) % 2 === 0;
    for (let y = 22; y < 28; y++) pc.set(x, y, stripe ? P.coral : P.cream);
    const sc = (x - 12) % 6;
    if (sc >= 1 && sc <= 4) pc.set(x, 28, stripe ? P.coral : P.cream);
  }
  // 전구
  for (let x = 14; x < 78; x += 6) pc.set(x, 21, [P.lemon, '#ffffff', P.pink][(x / 6) % 3 | 0]);
  // 진열대 + 음식
  pc.rect(12, 44, 66, 4, P.wood);
  pc.hline(12, 77, 44, P.woodLight);
  pc.hline(12, 77, 47, P.woodDark);
  FOODS.forEach((f, i) => {
    const data = buildFood(f.id).getContext('2d')!.getImageData(0, 0, 12, 12).data;
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) {
        const k = (y * 12 + x) * 4;
        if (data[k + 3] < 128) continue;
        const hx = ((data[k] << 16) | (data[k + 1] << 8) | data[k + 2]).toString(16).padStart(6, '0');
        pc.set(14 + i * 11 + x, 33 + y, `#${hx}`);
      }
  });
  // 바퀴
  for (const cx of [20, 74]) {
    pc.circle(cx, 61, 6.5, '#4b4360');
    pc.circle(cx, 61, 3, P.slateLight);
    pc.set(cx, 61, P.cream);
  }
  pc.outline(OUT);
  return pc;
}

export function bunting(): PixelCanvas {
  const W = 224;
  const H = 40;
  const pc = new PixelCanvas(W, H);
  pc.rect(2, 4, 2, 36, P.woodDark);
  pc.rect(W - 4, 4, 2, 36, P.woodDark);
  const colors = [P.coral, P.lemon, P.mint, P.sky, P.pink];
  let i = 0;
  for (let x = 4; x < W - 4; x++) {
    const t = (x - 4) / (W - 8);
    const y = Math.round(6 + Math.sin(t * Math.PI) * 10);
    pc.set(x, y, P.slate);
    if ((x - 8) % 13 === 0 && x < W - 10) {
      const c = colors[i++ % colors.length];
      for (let k = 0; k < 7; k++) {
        const half = Math.max(0, 3 - Math.floor(k / 2));
        for (let dx = -half; dx <= half; dx++) pc.set(x + 3 + dx, y + 1 + k, c);
      }
    }
  }
  pc.outline(OUT);
  return pc;
}

export function picnic(): PixelCanvas {
  const pc = new PixelCanvas(42, 26);
  // 뒤 벤치
  pc.rect(4, 3, 34, 3, P.woodDark);
  pc.hline(4, 37, 3, P.wood);
  // 테이블 (체크 무늬 천)
  for (let y = 7; y < 16; y++)
    for (let x = 2; x < 40; x++) {
      const c = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? P.coral : '#fff6e4';
      pc.set(x, y, y === 15 ? P.coralDark : c);
    }
  pc.rect(6, 16, 2, 4, P.woodDark);
  pc.rect(34, 16, 2, 4, P.woodDark);
  // 컵·접시
  pc.rect(10, 9, 3, 3, P.skyLight);
  pc.set(11, 8, '#ffffff');
  pc.ellipse(28, 10.5, 3.2, 1.6, '#ffffff');
  pc.set(28, 10, P.coral);
  // 앞 벤치
  pc.rect(4, 19, 34, 3, P.wood);
  pc.hline(4, 37, 19, P.woodLight);
  pc.rect(6, 22, 2, 3, P.woodDark);
  pc.rect(34, 22, 2, 3, P.woodDark);
  pc.outline(OUT);
  return pc;
}

export function menuSign(): PixelCanvas {
  const pc = new PixelCanvas(30, 36);
  pc.line(4, 34, 9, 2, P.woodDark);
  pc.line(25, 34, 20, 2, P.woodDark);
  pc.rect(4, 4, 22, 26, P.wood);
  pc.rect(6, 6, 18, 22, '#3f5a48');
  drawPixelText(pc, '메뉴', 15, 6, '#ffffff');
  const cols = [P.lemon, P.pink, P.mint, P.skyLight, P.coralLight];
  for (let i = 0; i < 4; i++) {
    pc.set(8, 19 + i * 2, cols[i]);
    pc.hline(10, 20 - (i % 2) * 3, 19 + i * 2, '#dfe8e0');
  }
  pc.outline(OUT);
  return pc;
}

// ------------------------------------------------------------------ 카피바라 온천

const CAPY = '#b88457';
const CAPY_D = '#956645';
const CAPY_L = '#d3a37a';

/** 온천에 몸을 담근 카피바라 (3프레임: 눈 뜸 / 반쯤 / 감음) */
export function capyBathSheet(): { canvas: HTMLCanvasElement; w: number; h: number; count: number } {
  const w = 30;
  const h = 20;
  const sheet = new PixelCanvas(w * 3, h);
  for (let f = 0; f < 3; f++) {
    const pc = new PixelCanvas(w, h);
    // 등 (물 위로 나온 부분)
    pc.ellipse(18, 15, 9, 4.5, (dx, dy) => (dy > 0.55 ? null : dx + dy > 0.4 ? CAPY_D : CAPY));
    // 머리
    for (let y = 5; y <= 15; y++)
      for (let x = 3; x <= 14; x++) {
        const rx = x < 6 ? (6 - x) / 3 : 0;
        const ry = y < 7 ? (7 - y) / 2 : 0;
        if (rx * rx + ry * ry > 1) continue;
        pc.set(x, y, y > 11 ? CAPY_D : x < 6 ? CAPY_L : CAPY);
      }
    // 코
    pc.rect(3, 9, 3, 3, '#5a3a2c');
    pc.set(3, 9, '#7a5240');
    // 귀
    pc.rect(12, 4, 2, 2, CAPY_D);
    // 눈
    if (f === 0) {
      pc.set(9, 8, '#2b2032');
      pc.set(9, 9, '#2b2032');
    } else if (f === 1) {
      pc.hline(8, 9, 9, '#2b2032');
    } else {
      pc.set(8, 9, '#2b2032');
      pc.set(9, 10, '#2b2032');
      pc.set(10, 9, '#2b2032');
    }
    pc.set(8, 11, '#ff9f9a');
    // 유자
    pc.circle(16, 3.5, 2.6, (dx, dy) => (dx + dy > 0.5 ? '#f09a3a' : '#ffb84d'));
    pc.set(16, 1, P.leafDark);
    pc.set(17, 0, P.leaf);
    pc.outline(OUT);
    // 수면선
    for (let x = 6; x <= 28; x++) if (pc.opaque(x, 15)) pc.set(x, 16, '#e9fbf7');
    sheet.blit(pc, f * w, 0);
  }
  return { canvas: sheet.flush(), w, h, count: 3 };
}

/** 온천가에 누워 쉬는 카피바라 (2프레임: 눈 뜸/감음) */
export function capyRestSheet(): { canvas: HTMLCanvasElement; w: number; h: number; count: number } {
  const w = 30;
  const h = 20;
  const sheet = new PixelCanvas(w * 2, h);
  for (let f = 0; f < 2; f++) {
    const pc = new PixelCanvas(w, h);
    pc.ellipse(17, 12, 10, 5.6, (dx, dy) => (dy > 0.5 ? CAPY_D : dx + dy < -0.6 ? CAPY_L : CAPY));
    pc.rect(9, 16, 3, 2, CAPY_D);
    pc.rect(21, 16, 3, 2, CAPY_D);
    // 머리
    pc.ellipse(7, 10, 5.2, 4.2, (dx) => (dx < -0.4 ? CAPY_L : CAPY));
    pc.rect(2, 9, 3, 3, '#5a3a2c');
    pc.rect(9, 5, 2, 2, CAPY_D);
    if (f === 0) {
      pc.set(7, 8, '#2b2032');
      pc.set(7, 9, '#2b2032');
    } else {
      pc.hline(6, 8, 9, '#2b2032');
    }
    // 머리 위 수건
    pc.rect(5, 4, 6, 2, '#ffffff');
    pc.set(10, 4, '#cfe9f5');
    pc.set(11, 5, '#ffffff');
    pc.outline(OUT);
    sheet.blit(pc, f * w, 0);
  }
  return { canvas: sheet.flush(), w, h, count: 2 };
}

export function bucket(): PixelCanvas {
  const pc = new PixelCanvas(14, 14);
  pc.rect(2, 5, 10, 8, P.woodLight);
  for (const x of [4, 7, 10]) pc.vline(x, 5, 12, P.wood);
  pc.hline(2, 11, 7, P.slate);
  pc.hline(2, 11, 11, P.slate);
  pc.ellipse(7, 5, 5, 1.6, P.woodDark);
  // 수건
  pc.rect(4, 2, 7, 3, '#ffffff');
  pc.hline(4, 10, 4, '#cfe9f5');
  pc.outline(OUT);
  return pc;
}

export function fern(): PixelCanvas {
  const pc = new PixelCanvas(18, 16);
  const leaf = (x0: number, y0: number, x1: number, y1: number) => {
    pc.line(x0, y0, x1, y1, P.leafDark);
    pc.line(x0, y0 - 1, x1, y1 - 1, P.leaf);
  };
  leaf(9, 15, 2, 6);
  leaf(9, 15, 16, 6);
  leaf(9, 15, 6, 2);
  leaf(9, 15, 12, 2);
  leaf(9, 15, 9, 1);
  pc.outline('#3f5a48');
  return pc;
}
