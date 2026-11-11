/**
 * 레이드 픽셀 아트: 과제 괴물(살아 움직이는 노트북) · 전투장 바닥 · 연필/과제 파일
 * 무섭지 않고 둥글고 귀여운 인디게임 보스. 화면(얼굴)으로 표정을 보여주고,
 * 체력이 줄면 노트북 '화면'에만 균열·글리치가 생깁니다.
 */
import { RAID } from '../../../../shared/raid';
import { P } from './palette';
import { hash2, mix, PixelCanvas } from './pixel';

const INK = '#3d3047';
export type BossMood = 'idle' | 'angry' | 'hurt' | 'broken' | 'off';
export const BOSS_W = 84;
export const BOSS_H = 74;

function rr(pc: PixelCanvas, x: number, y: number, w: number, h: number, c: string) {
  pc.rect(x + 1, y, w - 2, h, c);
  pc.rect(x, y + 1, w, h - 2, c);
}

/**
 * 보스 한 장면. crack: 0(멀쩡) 1(75%↓ 오류 표시) 2(50%↓ 균열·글리치) 3(25%↓ 균열 많음)
 */
export function bossFrame(mood: BossMood, crack: number, step = 0): HTMLCanvasElement {
  const pc = new PixelCanvas(BOSS_W, BOSS_H);
  const sx = 14;
  const sy = 4;
  const sw = 56;
  const sh = 38;
  // ---- 다리 (짧고 통통)
  for (const lx of [28, 50]) {
    pc.rect(lx, 64 + (step && lx === 28 ? -1 : 0), 6, 7, P.slate);
    pc.rect(lx - 1, 70, 8, 3, P.slateDark);
  }
  // ---- 케이블 팔 (양옆으로 구불)
  const armY = 50;
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? 12 : 72;
    for (let i = 0; i < 9; i++) pc.set(x0 + side * i, armY - Math.round(Math.sin((i + step * 2) * 0.8) * 2) - (mood === 'angry' ? i : 0), INK);
    const hx = x0 + side * 9;
    const hy = armY - (mood === 'angry' ? 10 : 0) - Math.round(Math.sin((9 + step * 2) * 0.8) * 2);
    // 플러그 손
    pc.rect(hx - 2, hy - 2, 5, 4, '#e9ecf5');
    pc.set(hx + side * 3, hy - 1, P.lemonDark);
    pc.set(hx + side * 3, hy + 1, P.lemonDark);
  }
  // ---- 키보드 몸통 (본체)
  rr(pc, 10, 44, 64, 21, '#d5d9e8');
  pc.hline(11, 72, 44, '#e9ecf5');
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 12; c++) {
      const kx = 14 + c * 5 - r;
      const ky = 47 + r * 4;
      const wob = mood === 'angry' && (c + r + step) % 3 === 0 ? -1 : 0;
      pc.rect(kx, ky + wob, 4, 3, '#ffffff');
      pc.hline(kx, kx + 3, ky + 2 + wob, '#c4c9da');
    }
  pc.rect(32, 59, 20, 3, '#ffffff'); // 스페이스바
  pc.rect(36, 62, 12, 2, '#c4c9da'); // 터치패드
  // ---- 화면 (뚜껑)
  rr(pc, sx - 2, sy - 2, sw + 4, sh + 4, P.slate);
  const on = mood !== 'off';
  const base = !on ? '#22202b' : mood === 'angry' ? '#ffd0c4' : mood === 'hurt' ? '#fff1c4' : '#dff1fd';
  pc.rect(sx, sy, sw, sh, base);
  if (on) {
    // 화면 위쪽 상태 표시줄
    pc.rect(sx, sy, sw, 4, mood === 'angry' ? '#ff8f7a' : '#86c8f2');
    for (let i = 0; i < 3; i++) pc.set(sx + 2 + i * 2, sy + 1, '#ffffff');
    drawFace(pc, mood, sx, sy, sw, step);
  }
  // ---- 체력별 화면 손상 (화면 안쪽에만)
  if (on && crack >= 1) {
    // 작은 오류 창
    pc.rect(sx + sw - 16, sy + 6, 12, 7, '#ffffff');
    pc.rect(sx + sw - 16, sy + 6, 12, 2, '#ff6b6b');
    pc.set(sx + sw - 11, sy + 9, INK);
    pc.set(sx + sw - 11, sy + 11, INK);
  }
  if (crack >= 2) crackLines(pc, sx, sy, sw, sh, crack === 2 ? 1 : 3, mood === 'off' ? '#8c89a6' : INK);
  if (on && crack >= 2)
    for (let i = 0; i < (crack === 2 ? 2 : 5); i++) {
      // 글리치 줄
      const gy = sy + 5 + Math.floor(hash2(i, step + crack, 7) * (sh - 7));
      const gx = sx + Math.floor(hash2(i, step, 9) * 20);
      pc.hline(gx, Math.min(sx + sw - 1, gx + 10 + Math.floor(hash2(i, step, 3) * 22)), gy, i % 2 ? '#ff8fc0' : '#7fd8b6');
    }
  if (mood === 'broken') crackLines(pc, sx, sy, sw, sh, 6, INK);
  // ---- 포스트잇·과제 파일
  pc.rect(sx - 4, sy + 10, 7, 7, '#ffe680');
  pc.hline(sx - 3, sx + 1, sy + 13, '#d9b84a');
  pc.rect(sx + sw - 2, sy + 22, 6, 6, '#ffb3c8');
  pc.hline(sx - 1 + sw, sx + 2 + sw, sy + 25, '#e58aa6');
  pc.outline(INK);
  return pc.flush();
}

function drawFace(pc: PixelCanvas, mood: BossMood, sx: number, sy: number, sw: number, step: number) {
  const cx = sx + sw / 2;
  const ey = sy + 15;
  const ink = INK;
  if (mood === 'idle') {
    // 짜증 난 반쯤 감은 눈
    for (const ex of [cx - 12, cx + 6]) {
      pc.rect(ex, ey, 7, 2, ink);
      pc.rect(ex + 2, ey + 2, 3, 2, ink);
    }
    pc.hline(cx - 4, cx + 3, ey + 10, ink);
    pc.set(cx + 4, ey + 9, ink);
  } else if (mood === 'angry') {
    // 화난 눈썹 + 경고 느낌표
    for (const [ex, dir] of [
      [cx - 13, 1],
      [cx + 6, -1],
    ] as const) {
      for (let i = 0; i < 7; i++) pc.set(ex + i, ey - 2 + (dir > 0 ? Math.floor(i / 2) : 3 - Math.floor(i / 2)), ink);
      pc.rect(ex + 2, ey + 2, 3, 3, ink);
    }
    pc.rect(cx - 5, ey + 9, 10, 3, ink);
    pc.hline(cx - 4, cx + 3, ey + 10, '#ff6b6b');
    pc.rect(sx + 4, sy + 7, 2, 5, '#ff6b6b');
    pc.rect(sx + 4, sy + 13, 2, 2, '#ff6b6b');
  } else if (mood === 'hurt') {
    // 깜짝 놀란 동그란 눈 + O 입
    for (const ex of [cx - 11, cx + 6]) {
      pc.rect(ex, ey - 1, 5, 5, ink);
      pc.rect(ex + 1, ey, 3, 3, '#ffffff');
      pc.set(ex + 2, ey + 1, ink);
    }
    pc.rect(cx - 2, ey + 8, 5, 5, ink);
    pc.rect(cx - 1, ey + 9, 3, 3, '#ff8f7a');
  } else if (mood === 'broken') {
    // X 눈
    for (const ex of [cx - 12, cx + 6]) for (let i = 0; i < 5; i++) {
      pc.set(ex + i, ey + i - 1, ink);
      pc.set(ex + 4 - i, ey + i - 1, ink);
    }
    for (let i = 0; i < 9; i++) pc.set(cx - 4 + i, ey + 10 + (i % 2), ink);
  }
  void step;
}

function crackLines(pc: PixelCanvas, sx: number, sy: number, sw: number, sh: number, n: number, color: string) {
  const starts: [number, number][] = [
    [sx + 6, sy + 6],
    [sx + sw - 8, sy + sh - 6],
    [sx + sw / 2, sy + sh / 2],
    [sx + 10, sy + sh - 8],
    [sx + sw - 12, sy + 8],
    [sx + sw / 2 - 10, sy + 10],
  ];
  for (let k = 0; k < n; k++) {
    let [x, y] = starts[k % starts.length];
    for (let i = 0; i < 14; i++) {
      pc.set(Math.round(x), Math.round(y), color);
      x += hash2(k, i, 41) * 4 - 2;
      y += hash2(k, i, 43) * 3 - 1;
      x = Math.max(sx, Math.min(sx + sw - 1, x));
      y = Math.max(sy, Math.min(sy + sh - 1, y));
    }
  }
}

/** 방어막 (반투명 하늘색 거품) */
export function bossShield(): HTMLCanvasElement {
  const pc = new PixelCanvas(BOSS_W + 20, BOSS_H + 16);
  const cx = (BOSS_W + 20) / 2;
  const cy = (BOSS_H + 16) / 2;
  pc.ellipse(cx, cy, cx - 1, cy - 1, (dx, dy) => {
    const d = dx * dx + dy * dy;
    if (d > 0.86) return '#86c8f2cc';
    if (dx < -0.4 && dy < -0.4 && d > 0.5) return '#ffffffaa';
    return '#bfe4fb33';
  });
  return pc.flush();
}

/** 전투장 바닥: 위쪽은 칠판 벽, 아래는 광장 벽돌 */
export function arena(): HTMLCanvasElement {
  const W = RAID.W;
  const H = RAID.H;
  const pc = new PixelCanvas(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (y < 34) {
        // 벽 + 칠판
        let c: string = y < 30 ? P.plaster : P.plasterDark;
        if (x > 120 && x < 360 && y > 4 && y < 27) c = x < 122 || x > 357 || y < 6 || y > 25 ? P.woodDark : '#4f7a63';
        pc.set(x, y, c);
        continue;
      }
      const row = Math.floor(y / 8);
      const off = row % 2 ? 4 : 0;
      const lx = (x + off) % 8;
      const ly = y % 8;
      const tid = hash2(Math.floor((x + off) / 8), row, 21);
      let c: string = tid > 0.9 ? '#fbe3d3' : tid > 0.8 ? '#e9f2f1' : tid > 0.45 ? P.plaza : P.plazaAlt;
      if (lx === 0 || ly === 0) c = P.plazaGrout;
      else if (lx === 1 && ly === 1) c = mix(c, '#ffffff', 0.5);
      pc.set(x, y, c);
    }
  // 벽 아래 그림자
  pc.hline(0, W - 1, 34, '#dcc6a6');
  pc.hline(0, W - 1, 35, '#e8d6ba');
  // 칠판 분필 낙서 (글자 대신 선)
  for (let i = 0; i < 5; i++) pc.hline(140 + i * 40, 160 + i * 40, 12 + (i % 3) * 4, '#e9f5ee');
  return pc.flush();
}

/** 날아가는 연필 · 과제 파일 */
export function pencil(): HTMLCanvasElement {
  const pc = new PixelCanvas(12, 4);
  pc.rect(0, 1, 2, 2, '#ff9fb0');
  pc.rect(2, 1, 7, 2, P.lemon);
  pc.hline(2, 8, 1, '#fff1c4');
  pc.rect(9, 1, 2, 2, '#f6cba6');
  pc.set(11, 1, INK);
  pc.outline(INK);
  return pc.flush();
}
export function paperFile(color = '#ffffff'): HTMLCanvasElement {
  const pc = new PixelCanvas(9, 11);
  pc.rect(0, 0, 9, 11, color);
  pc.rect(6, 0, 3, 3, '#d5d9e8');
  for (let i = 0; i < 3; i++) pc.hline(2, 6, 4 + i * 2, '#b6bbd0');
  pc.outline(INK);
  return pc.flush();
}
