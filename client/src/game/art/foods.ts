/**
 * 음식·이펙트 픽셀 아트.
 * 음식은 12×12 스프라이트로, 캐릭터 손에 붙어 다니고 메뉴판 아이콘으로도 쓰입니다.
 * 수뭉이빵은 상명대 마스코트 수뭉이 얼굴을 픽셀로 단순화한 아이콘입니다 (drawSumung).
 */
import type { FoodId } from '../../../../shared/protocol';
import { PixelCanvas } from './pixel';

const OUT = '#3d3047';
export const FOOD_SIZE = 12;

/**
 * 수뭉이 얼굴 간식: 갈색 뿔 2개(ㅅ·ㅁ 모양), 양옆 귀, 둥근 베이지 얼굴, 작은 눈·입, 분홍 볼.
 * 12×12 안에서 실루엣이 먼저 읽히도록 몸 없이 머리만 그립니다.
 */
function drawSumung(pc: PixelCanvas) {
  // 얼굴 + 귀 (외곽선 적용 대상)
  const face = [
    '............',
    '............',
    '............',
    '............',
    '...BBBBBB...',
    '.WBBLBBBBBW.',
    '.BBBBBBBBBB.',
    '..BBEBBEBB..',
    '..BPBMMBPB..',
    '..BBBBBBBB..',
    '...DDDDDD...',
    '............',
  ];
  const C: Record<string, string> = {
    B: '#fcd8b4', // 얼굴
    L: '#fff0de', // 하이라이트
    D: '#efc19a', // 아래쪽 그늘
    W: '#fff6ec', // 귀 안쪽
    E: OUT, // 눈
    M: '#e0959a', // 입 (작고 부드럽게)
    P: '#ffaaa6', // 볼
  };
  face.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (C[r[x]]) pc.set(x, y, C[r[x]]);
  });
  pc.outline(OUT);
  // 뿔은 외곽선 뒤에 그려야 가지 사이 틈이 메워지지 않아 또렷함
  // 왼쪽: ㅅ자 화살표 모양 / 오른쪽: ㅁ자 상자 모양 (수뭉이 뿔)
  const H = '#a37d64';
  const HD = '#6e4f3d';
  for (const [x, y, c] of [
    [3, 0, H],
    [2, 1, HD],
    [3, 1, H],
    [4, 1, HD],
    [3, 2, H],
    [3, 3, HD],
    [7, 0, H],
    [8, 0, H],
    [9, 0, HD],
    [7, 1, H],
    [9, 1, HD],
    [7, 2, HD],
    [8, 2, HD],
    [9, 2, HD],
    [8, 3, HD],
  ] as [number, number, string][])
    pc.set(x, y, c);
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
  // 수뭉이빵은 뿔을 또렷하게 하려고 직접 외곽선을 그림
  if (id !== 'sumung') pc.outline(OUT);
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
