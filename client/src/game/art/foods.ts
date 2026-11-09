/**
 * 음식·이펙트 픽셀 아트.
 * 음식은 12×12 스프라이트로, 캐릭터 손에 붙어 다니고 메뉴판 아이콘으로도 쓰입니다.
 * ※ 수뭉이빵은 교체 가능한 임시 디자인입니다 (학교 공식 에셋이 있으면 drawSumung 만 바꾸면 됨).
 */
import type { FoodId } from '../../../../shared/protocol';
import { PixelCanvas } from './pixel';

const OUT = '#3d3047';
export const FOOD_SIZE = 12;

function drawSumung(pc: PixelCanvas) {
  const B = '#f6dcae';
  const BD = '#e2bb82';
  const ear = (cx: number) => pc.circle(cx, 3, 1.7, B);
  ear(3);
  ear(9);
  pc.ellipse(6, 7, 5, 4.2, (dx, dy) => (dx + dy > 0.6 ? BD : dx + dy < -0.8 ? '#fff0d2' : B));
  pc.set(3, 3, '#ffb1c2');
  pc.set(9, 3, '#ffb1c2');
  pc.set(4, 6, OUT);
  pc.set(8, 6, OUT);
  pc.set(3, 8, '#ff9f9a');
  pc.set(9, 8, '#ff9f9a');
  pc.set(6, 8, '#8a3a4a');
}

function drawTakoyaki(pc: PixelCanvas) {
  for (let y = 8; y <= 10; y++) pc.hline(1 + (y - 8), 10 - (y - 8), y, y === 8 ? '#fff6e4' : '#efdcc0');
  const ball = (cx: number, cy: number) =>
    pc.circle(cx, cy, 2.2, (dx, dy) => (dx + dy > 0.5 ? '#a8652f' : dx + dy < -0.7 ? '#e8b073' : '#c98a4e'));
  ball(3.5, 6.5);
  ball(8.5, 6.5);
  ball(6, 5);
  pc.hline(2, 9, 5, '#6b3a2a');
  pc.set(3, 5, '#ffffff');
  pc.set(5, 4, '#ffffff');
  pc.set(8, 5, '#ffffff');
  pc.set(6, 4, '#7fc76b');
  pc.line(9, 1, 10, 4, '#e9c79a');
}

function drawIcecream(pc: PixelCanvas) {
  for (let y = 6; y <= 11; y++) {
    const half = Math.max(0, (11 - y) * 0.5);
    for (let x = Math.round(6 - half); x <= Math.round(6 + half - 0.5); x++) pc.set(x, y, (x + y) % 2 ? '#e8b064' : '#d39445');
  }
  pc.circle(6, 6, 2.8, (dx, dy) => (dx + dy > 0.6 ? '#5cbb98' : '#8fe0c0'));
  pc.circle(6, 3.4, 2.5, (dx, dy) => (dx + dy > 0.6 ? '#f08aa8' : '#ffb7cb'));
  pc.set(5, 2, '#ffffff');
  pc.set(7, 0, '#ff5a6a');
  pc.set(7, 1, '#e8475a');
}

function drawHotdog(pc: PixelCanvas) {
  pc.vline(6, 8, 11, '#e9c79a');
  pc.ellipse(6, 5, 2.8, 4.4, (dx, dy) => (dx > 0.45 ? '#c98a3a' : dx < -0.5 ? '#f3c470' : '#e0a548'));
  for (const [x, y] of [
    [5, 3],
    [7, 6],
    [5, 7],
  ])
    pc.set(x, y, '#f7d998');
  pc.set(5, 2, '#e84a4a');
  pc.set(6, 3, '#e84a4a');
  pc.set(7, 4, '#e84a4a');
  pc.set(6, 5, '#e84a4a');
  pc.set(5, 6, '#e84a4a');
}

function drawBungeo(pc: PixelCanvas) {
  pc.ellipse(5, 6, 4.4, 3.2, (dx, dy) => (dy > 0.45 ? '#b8712f' : dy < -0.5 ? '#ecb46a' : '#d9944a'));
  for (let y = 3; y <= 9; y++) {
    const w = Math.abs(y - 6);
    for (let x = 9; x <= 9 + w; x++) pc.set(x, y, '#d9944a');
  }
  pc.set(2, 5, OUT);
  pc.set(5, 5, '#b8712f');
  pc.set(6, 6, '#b8712f');
  pc.set(5, 7, '#b8712f');
  pc.set(7, 5, '#b8712f');
  pc.set(8, 7, '#b8712f');
}

function drawCotton(pc: PixelCanvas) {
  pc.vline(6, 7, 11, '#efe4d0');
  const pink = (dx: number, dy: number) => (dx + dy > 0.6 ? '#f8a6c4' : dx + dy < -0.6 ? '#ffe3ec' : '#ffc1d6');
  pc.circle(4, 4.5, 2.6, pink);
  pc.circle(8, 4, 2.8, pink);
  pc.circle(6, 6, 2.6, pink);
  pc.circle(6, 2.5, 2.2, pink);
  pc.set(5, 2, '#ffffff');
  pc.set(8, 3, '#ffffff');
}

const DRAW: Record<FoodId, (pc: PixelCanvas) => void> = {
  sumung: drawSumung,
  takoyaki: drawTakoyaki,
  icecream: drawIcecream,
  hotdog: drawHotdog,
  bungeo: drawBungeo,
  cotton: drawCotton,
};

const cache = new Map<string, HTMLCanvasElement>();

export function buildFood(id: FoodId): HTMLCanvasElement {
  const hit = cache.get(id);
  if (hit) return hit;
  const pc = new PixelCanvas(FOOD_SIZE, FOOD_SIZE);
  DRAW[id](pc);
  pc.outline(OUT);
  const c = pc.flush();
  cache.set(id, c);
  return c;
}

// ------------------------------------------------------------------ 이펙트

export function buildHeart(): HTMLCanvasElement {
  const pc = new PixelCanvas(9, 8);
  const rows = ['.##..##..', '#######.', '#######.', '.#####..', '..###...', '...#....'];
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') pc.set(x + 1, y + 1, '#ff7a9c');
  });
  pc.set(2, 2, '#ffd0dc');
  pc.outline(OUT);
  return pc.flush();
}

export function buildStar(): HTMLCanvasElement {
  const pc = new PixelCanvas(9, 9);
  const rows = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') pc.set(x + 1, y + 1, '#ffd66e');
  });
  pc.set(4, 3, '#fff6c8');
  pc.outline(OUT);
  return pc.flush();
}

export function buildSweat(): HTMLCanvasElement {
  const pc = new PixelCanvas(5, 6);
  pc.set(2, 1, '#bfe4fb');
  pc.rect(1, 2, 3, 2, '#bfe4fb');
  pc.set(2, 4, '#86c8f2');
  pc.set(1, 2, '#ffffff');
  pc.outline('#5aa3d6');
  return pc.flush();
}

/** 하얀 김 (부드러운 원) */
export function buildSteam(size = 10): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** 입욕 중 몸 주변 물결 (2프레임) */
export function buildRippleSheet(): { canvas: HTMLCanvasElement; w: number; h: number; count: number } {
  const w = 20;
  const h = 8;
  const sheet = new PixelCanvas(w * 2, h);
  for (let f = 0; f < 2; f++) {
    const rx = f ? 9 : 8;
    const ry = f ? 3.4 : 3;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - w / 2) / rx;
        const dy = (y + 0.5 - h / 2) / ry;
        const d = dx * dx + dy * dy;
        if (d <= 1 && d > 0.55) sheet.set(f * w + x, y, d > 0.8 ? '#e9fbf7' : '#bff0e6');
        else if (d <= 0.55) sheet.set(f * w + x, y, '#8fdccd');
      }
  }
  return { canvas: sheet.flush(), w, h, count: 2 };
}

export function buildCrumb(): HTMLCanvasElement {
  const pc = new PixelCanvas(2, 2);
  pc.rect(0, 0, 2, 2, '#e8b064');
  return pc.flush();
}
