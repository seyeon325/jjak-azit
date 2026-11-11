/**
 * PPT 전용으로 새로 그리는 픽셀 아트 (UI 패널·이펙트·상품·장식)
 * 게임과 같은 PixelCanvas·팔레트·1px 외곽선 규칙으로 그려서 원본과 픽셀 크기·느낌이 같도록 합니다.
 * 1 단위 = 원본 1픽셀 (PPT 1920×1080 에서는 4배 = 4px)
 */
import { P } from '../../client/src/game/art/palette';
import { mix, PixelCanvas } from '../../client/src/game/art/pixel';
import { TEAM_SYMBOL_ROWS } from '../../shared/social';

/** 웹 UI 와 같은 잉크색 (CSS --ink) */
export const INK = '#3d3047';
export const UI = {
  ink: INK,
  ink2: '#6d5a72',
  ink3: '#9a8aa0',
  paper: '#fffaf0',
  cream: '#fff6e4',
  cream2: '#f7e8cc',
  line: '#ead9bd',
  coral: '#ff8f7a',
  coralD: '#e2715f',
  coralL: '#ffd9cf',
  sky: '#86c8f2',
  skyD: '#5aa3d6',
  skyL: '#dff1fd',
  mint: '#7fd8b6',
  mintD: '#3fa883',
  mintL: '#dcf6eb',
  lemon: '#ffd66e',
  lemonD: '#ebb94a',
  lemonL: '#fff1c4',
  lav: '#b9a3ef',
  lavD: '#957bd8',
  lavL: '#ece5fd',
  plum: '#2c2234',
  plum2: '#33283c',
};

type Grid = string[];
export function paint(pc: PixelCanvas, rows: Grid, ox: number, oy: number, colors: Record<string, string>) {
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = colors[r[x]];
      if (c) pc.set(ox + x, oy + y, c);
    }
  });
}

// ------------------------------------------------------------------ 둥근 사각형

const INSET: Record<number, number[]> = { 0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1], 5: [5, 3, 2, 1, 1], 6: [6, 4, 3, 2, 1, 1] };

export function rrect(pc: PixelCanvas, x: number, y: number, w: number, h: number, r: number, c: string) {
  const t = INSET[Math.max(0, Math.min(6, r))];
  for (let j = 0; j < h; j++) {
    const k = Math.min(j, h - 1 - j);
    const ins = k < t.length ? t[k] : 0;
    if (w - ins * 2 > 0) pc.hline(x + ins, x + w - 1 - ins, y + j, c);
  }
}

export interface PanelOpt {
  bg?: string;
  border?: string;
  /** 아래로 떨어지는 단단한 그림자 (px) */
  shadow?: number;
  r?: number;
  /** 안쪽 위 하이라이트 */
  hi?: string | null;
  /** 안쪽 테두리 (RPG 대화창 느낌) */
  inner?: string | null;
}

/** 웹 UI 패널과 같은 구성: 크림 배경 + 어두운 1px 외곽선 + 아래 단단한 그림자 */
export function panel(w: number, h: number, o: PanelOpt = {}): PixelCanvas {
  const bg = o.bg ?? UI.paper;
  const border = o.border ?? INK;
  const sh = o.shadow ?? 1;
  const r = o.r ?? 3;
  const pc = new PixelCanvas(w, h + sh);
  if (sh) rrect(pc, 0, sh, w, h, r, border);
  rrect(pc, 0, 0, w, h, r, border);
  rrect(pc, 1, 1, w - 2, h - 2, Math.max(0, r - 1), bg);
  const hi = o.hi === undefined ? '#ffffff' : o.hi;
  if (hi) {
    const t = INSET[Math.max(0, Math.min(6, r - 1))];
    const ins = t.length ? t[0] : 0;
    pc.hline(1 + ins, w - 2 - ins, 1, hi);
  }
  if (o.inner) {
    rrect(pc, 3, 3, w - 6, h - 6, Math.max(0, r - 2), o.inner);
    rrect(pc, 4, 4, w - 8, h - 8, Math.max(0, r - 3), bg);
  }
  return pc;
}

// ------------------------------------------------------------------ 버튼

export type BtnState = 'default' | 'selected' | 'highlight' | 'disabled';
export function button(w: number, h: number, st: BtnState): PixelCanvas {
  if (st === 'default') return panel(w, h, { bg: UI.paper, shadow: 1, r: 3 });
  if (st === 'selected') return panel(w, h, { bg: INK, border: INK, shadow: 1, r: 3, hi: '#5a4a66' });
  if (st === 'highlight') {
    const pc = panel(w, h, { bg: UI.coral, shadow: 1, r: 3, hi: '#ffb7a6' });
    // 아래쪽 진한 띠 (게임 강조 버튼의 그림자 글자 느낌)
    pc.hline(3, w - 4, h - 2, UI.coralD);
    return pc;
  }
  const pc = panel(w, h, { bg: UI.cream2, border: UI.ink3, shadow: 0, r: 3, hi: null });
  return pc;
}

// ------------------------------------------------------------------ 타이틀 리본

/** 리본 꼬리: 붙는 쪽(attachX)에서 바깥으로 len 만큼, 끝은 V 자로 파임 */
function ribbonTail(pc: PixelCanvas, attachX: number, y: number, len: number, h: number, dir: 1 | -1, color: string, dark: string) {
  const notch = Math.floor(h / 2);
  for (let j = 0; j < h; j++) {
    const cut = notch - Math.abs(j - (h - 1) / 2); // 가운데일수록 깊게 파임
    for (let i = 0; i < len; i++) {
      if (i >= len - Math.max(0, Math.round(cut))) continue;
      pc.set(attachX + dir * i, y + j, i < 3 ? dark : j === 0 ? mix(color, '#ffffff', 0.3) : j === h - 1 ? dark : color);
    }
  }
}

/** 양 끝이 접힌 리본 띠 (가운데 비움) */
export function ribbonBanner(w: number, h: number, color = UI.coral, dark = UI.coralD): PixelCanvas {
  const len = Math.round(h * 0.9);
  const W = w + (len - 4) * 2;
  const pc = new PixelCanvas(W, h + 6);
  const x0 = len - 4;
  // 뒤로 접혀 내려간 꼬리
  ribbonTail(pc, x0 + 3, 5, len, h - 2, -1, dark, mix(dark, INK, 0.3));
  ribbonTail(pc, x0 + w - 4, 5, len, h - 2, 1, dark, mix(dark, INK, 0.3));
  // 앞 띠
  pc.rect(x0, 0, w, h, color);
  pc.hline(x0, x0 + w - 1, 1, mix(color, '#ffffff', 0.35));
  pc.hline(x0, x0 + w - 1, h - 2, dark);
  pc.outline(INK);
  return pc;
}

/** 큰 제목 패널: 크림 패널 + 위쪽 색 띠 + 좌우 리본 꼬리 */
export function titlePanel(w: number, h: number, band = UI.coral, bandD = UI.coralD): PixelCanvas {
  const len = 16;
  const th = 14;
  const pc = new PixelCanvas(w + (len - 4) * 2, h + 2);
  const x0 = len - 4;
  const ty = Math.round(h * 0.42);
  ribbonTail(pc, x0 + 3, ty, len, th, -1, band, bandD);
  ribbonTail(pc, x0 + w - 4, ty, len, th, 1, band, bandD);
  const body = panel(w, h, { bg: UI.paper, r: 4, shadow: 2 });
  pc.blit(body, x0, 0);
  rrect(pc, x0 + 1, 1, w - 2, 7, 3, band);
  pc.hline(x0 + 3, x0 + w - 4, 2, mix(band, '#ffffff', 0.35));
  pc.hline(x0 + 1, x0 + w - 2, 8, bandD);
  for (let i = 0; i < 3; i++) pc.set(x0 + 6 + i * 3, 4, '#ffffff');
  for (let i = 0; i < 3; i++) pc.set(x0 + w - 7 - i * 3, 4, '#ffffff');
  pc.outline(INK);
  return pc;
}

// ------------------------------------------------------------------ 대화창

export function dialogBox(w: number, h: number): PixelCanvas {
  const pc = panel(w, h, { bg: UI.paper, r: 4, shadow: 2, inner: UI.line });
  // 다음 표시 ▼
  const tx = w - 12;
  const ty = h - 9;
  for (let j = 0; j < 4; j++) pc.hline(tx + j, tx + 6 - j, ty + j, UI.coral);
  pc.hline(tx, tx + 6, ty - 1, INK);
  pc.set(tx - 1, ty, INK);
  pc.set(tx + 7, ty, INK);
  for (let j = 0; j < 4; j++) {
    pc.set(tx + j - 1, ty + j, INK);
    pc.set(tx + 7 - j, ty + j, INK);
  }
  pc.set(tx + 3, ty + 4, INK);
  return pc;
}

/** 대화창 이름표 (위에 겹쳐 놓는 작은 탭) */
export function nameTab(w: number, h = 12, color = UI.lemon): PixelCanvas {
  return panel(w, h, { bg: color, r: 3, shadow: 1, hi: mix(color, '#ffffff', 0.5) });
}

export function portraitFrame(s = 40): PixelCanvas {
  const pc = panel(s, s, { bg: UI.skyL, r: 3, shadow: 2, inner: '#ffffff' });
  return pc;
}

// ------------------------------------------------------------------ 퀴즈판 (나무 액자)

export function quizBoard(w: number, h: number, slot = false): PixelCanvas {
  const pc = new PixelCanvas(w, h + 2);
  rrect(pc, 0, 2, w, h, 3, INK);
  rrect(pc, 0, 0, w, h, 3, INK);
  rrect(pc, 1, 1, w - 2, h - 2, 2, P.wood);
  // 나뭇결
  for (let y = 2; y < h - 2; y += 3) for (let x = 2; x < w - 2; x++) if ((x * 7 + y * 3) % 23 === 0) pc.set(x, y, P.woodDark);
  pc.hline(2, w - 3, 1, P.woodLight);
  // 안쪽 종이
  const m = 6;
  rrect(pc, m - 1, m - 1, w - (m - 1) * 2, h - (m - 1) * 2, 2, P.woodDeep);
  rrect(pc, m, m, w - m * 2, h - m * 2, 1, UI.paper);
  pc.hline(m + 1, w - m - 2, m, '#ffffff');
  // 모서리 못
  for (const [x, y] of [
    [3, 3],
    [w - 4, 3],
    [3, h - 4],
    [w - 4, h - 4],
  ]) {
    pc.set(x, y, P.lemon);
    pc.set(x, y + 1, P.lemonDark);
  }
  if (slot) {
    // 이미지 자리 (왼쪽 사각형, 점선 테두리)
    const s = h - m * 2 - 8;
    dashed(pc, m + 4, m + 4, s, s, UI.ink3);
  }
  return pc;
}

export function dashed(pc: PixelCanvas, x: number, y: number, w: number, h: number, c: string) {
  for (let i = 0; i < w; i++) if (i % 4 < 2) {
    pc.set(x + i, y, c);
    pc.set(x + i, y + h - 1, c);
  }
  for (let j = 0; j < h; j++) if (j % 4 < 2) {
    pc.set(x, y + j, c);
    pc.set(x + w - 1, y + j, c);
  }
}

// ------------------------------------------------------------------ 타이머

export function timerClock(s = 40): PixelCanvas {
  const pc = new PixelCanvas(s, s + 6);
  const c = s / 2;
  const cy = c + 6;
  // 위 버튼·종
  pc.rect(c - 3, 0, 6, 3, UI.coral);
  pc.rect(c - 1, 3, 2, 3, UI.ink2);
  pc.rect(c - 12, 3, 5, 3, UI.coral);
  pc.rect(c + 7, 3, 5, 3, UI.coral);
  pc.circle(c, cy, c, INK);
  pc.circle(c, cy, c - 1, UI.coral);
  pc.circle(c, cy, c - 3, INK);
  pc.circle(c, cy, c - 4, '#ffffff');
  // 눈금
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const r = c - 6;
    const x = Math.round(c + Math.sin(a) * r - 0.5);
    const y = Math.round(cy - Math.cos(a) * r - 0.5);
    pc.set(x, y, k % 3 === 0 ? INK : UI.ink3);
  }
  pc.hline(Math.round(c - 8), Math.round(c + 7), Math.round(cy - c + 5), UI.coralL);
  pc.outline(INK);
  return pc;
}

/** 시간 막대 틀 + 칸 */
export function timerBar(w: number, h = 10): PixelCanvas {
  const pc = panel(w, h, { bg: '#ffffff', r: 3, shadow: 1, hi: null });
  return pc;
}
export function timerFill(w: number, h: number, color: string, dark: string): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  rrect(pc, 0, 0, w, h, 2, color);
  pc.hline(1, w - 2, 0, mix(color, '#ffffff', 0.45));
  pc.hline(1, w - 2, h - 1, dark);
  return pc;
}

// ------------------------------------------------------------------ 점수판

export function scoreRow(w: number, h = 18): PixelCanvas {
  const pc = panel(w, h, { bg: '#ffffff', r: 3, shadow: 1, hi: null });
  // 팀 배지 자리 (점선 원)
  const cx = 10;
  const cy = Math.floor(h / 2);
  for (let a = 0; a < 24; a++) if (a % 2 === 0) {
    const t = (a / 24) * Math.PI * 2;
    pc.set(Math.round(cx + Math.cos(t) * 6), Math.round(cy + Math.sin(t) * 6), UI.ink3);
  }
  // 점수 칸
  const sw = 30;
  rrect(pc, w - sw - 3, 3, sw, h - 6, 2, UI.lemonL);
  pc.hline(w - sw - 2, w - 5, h - 4, UI.lemonD);
  return pc;
}

export function scoreBoard(w: number, rows: number): PixelCanvas {
  const rowH = 18;
  const head = 14;
  const h = head + 6 + rows * (rowH + 4) + 4;
  const pc = panel(w, h, { bg: UI.paper, r: 4, shadow: 2 });
  rrect(pc, 1, 1, w - 2, head, 3, UI.sky);
  pc.hline(3, w - 4, 2, mix(UI.sky, '#ffffff', 0.4));
  pc.hline(1, w - 2, head + 1, UI.skyD);
  for (let i = 0; i < rows; i++) pc.blit(scoreRow(w - 12), 6, head + 6 + i * (rowH + 4));
  return pc;
}

// ------------------------------------------------------------------ 시상대 · 메달

export const MEDAL = {
  gold: ['#ffd66e', '#ebb94a', '#fff3b0'],
  silver: ['#dfe3ee', '#b6bbd0', '#ffffff'],
  bronze: ['#e6a777', '#c98557', '#f6cba6'],
} as const;

export function podiumBlock(w: number, h: number, kind: keyof typeof MEDAL): PixelCanvas {
  const [c, d, l] = MEDAL[kind];
  const pc = new PixelCanvas(w, h + 2);
  rrect(pc, 0, 2, w, h, 2, INK);
  rrect(pc, 0, 0, w, h, 2, INK);
  rrect(pc, 1, 1, w - 2, h - 2, 1, c);
  pc.rect(1, 1, w - 2, 5, l);
  pc.hline(1, w - 2, 6, d);
  // 앞면 이름판 자리
  const pw = Math.round(w * 0.6);
  const plH = Math.max(6, Math.min(14, h - 18));
  rrect(pc, Math.round((w - pw) / 2), 10, pw, plH, 2, d);
  rrect(pc, Math.round((w - pw) / 2) + 1, 11, pw - 2, plH - 2, 1, UI.paper);
  // 별 하나 (공간이 있을 때)
  if (h >= 34) star5(pc, Math.round(w / 2), Math.min(h - 8, 10 + plH + 8), 3, l, d);
  return pc;
}

export function medal(kind: keyof typeof MEDAL): PixelCanvas {
  const [c, d, l] = MEDAL[kind];
  const pc = new PixelCanvas(16, 22);
  // 리본
  const rib = kind === 'gold' ? UI.coral : kind === 'silver' ? UI.sky : UI.mint;
  const ribD = kind === 'gold' ? UI.coralD : kind === 'silver' ? UI.skyD : UI.mintD;
  for (let j = 0; j < 8; j++) {
    pc.hline(3 + Math.floor(j / 2), 6 + Math.floor(j / 2), j, rib);
    pc.hline(9 - Math.floor(j / 2), 12 - Math.floor(j / 2), j, ribD);
  }
  pc.circle(8, 14, 7, c);
  pc.circle(8, 14, 5, d);
  pc.circle(8, 14, 4, c);
  pc.set(5, 10, l);
  pc.set(6, 10, l);
  pc.set(4, 11, l);
  star5(pc, 8, 14, 2, l, d);
  pc.outline(INK);
  return pc;
}

export function crown(): PixelCanvas {
  const pc = new PixelCanvas(18, 13);
  paint(
    pc,
    ['..y.....y.....y..', '.yyy...yyy...yyy.', '.yyyy.yyyyy.yyyy.', '.yyyyyyyyyyyyyyy.', '.yyyyyyyyyyyyyyy.', '.ddddddddddddddd.', '.yyyrryyyyyrryyy.', '.yyyrryyyyyrryyy.', '.ddddddddddddddd.'],
    0,
    2,
    { y: MEDAL.gold[0], d: MEDAL.gold[1], r: UI.coral },
  );
  pc.set(2, 4, MEDAL.gold[2]);
  pc.set(8, 4, MEDAL.gold[2]);
  pc.outline(INK);
  return pc;
}

// ------------------------------------------------------------------ 기호·아이콘

/** 다섯 꼭짓점 별 (반지름 r) */
export function star5(pc: PixelCanvas, cx: number, cy: number, r: number, c: string, d?: string) {
  const pts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++)
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      if (!inPoly(x + 0.5, y + 0.5, pts)) continue;
      pc.set(x, y, d && y > cy + r * 0.25 ? d : c);
    }
}
function inPoly(x: number, y: number, pts: [number, number][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function starIcon(r: number, c: string = UI.lemon, d: string = UI.lemonD, hi = '#fff6c8'): PixelCanvas {
  const s = Math.ceil(r * 2) + 3;
  const pc = new PixelCanvas(s, s);
  const cx = s / 2;
  star5(pc, cx, cx + 0.5, r, c, d);
  pc.set(Math.floor(cx) - 1, Math.floor(cx) - 1, hi);
  pc.outline(INK);
  return pc;
}

/** 4방향 반짝임 */
export function twinkle(size: number, c = '#ffffff', core = UI.lemon): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const m = Math.floor(size / 2);
  pc.vline(m, 0, size - 1, c);
  pc.hline(0, size - 1, m, c);
  pc.rect(m - 1, m - 1, 3, 3, c);
  pc.set(m, m, core);
  return pc;
}

export function heartIcon(scale = 1, c = '#ff6b8a', hi = '#ffd0dc'): PixelCanvas {
  const rows = scale === 1 ? ['.rr.rr.', 'rwrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'] : ['.rrr...rrr.', 'rrwrr.rrrrr', 'rwrrrrrrrrr', 'rrrrrrrrrrr', 'rrrrrrrrrrr', '.rrrrrrrrr.', '..rrrrrrr..', '...rrrrr...', '....rrr....', '.....r.....'];
  const pc = new PixelCanvas(rows[0].length + 2, rows.length + 2);
  paint(pc, rows, 1, 1, { r: c, w: hi });
  pc.outline(INK);
  return pc;
}

/** 굵은 O (정답) */
export function correctMark(s = 40): PixelCanvas {
  const pc = new PixelCanvas(s, s);
  const c = s / 2;
  pc.circle(c, c, c - 1, INK);
  pc.circle(c, c, c - 2, UI.mint);
  pc.circle(c, c, c - 8, INK);
  // 가운데 비우기
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (Math.hypot(x + 0.5 - c, y + 0.5 - c) < c - 9) pc.clear(x, y);
  // 하이라이트
  for (let k = 0; k < 8; k++) {
    const a = -2.4 + k * 0.12;
    pc.set(Math.round(c + Math.cos(a) * (c - 4)), Math.round(c + Math.sin(a) * (c - 4)), '#dff8ee');
  }
  return pc;
}

/** 굵은 X (오답) */
export function wrongMark(s = 36): PixelCanvas {
  const pc = new PixelCanvas(s, s);
  const t = 4;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const d1 = Math.abs(x - y);
      const d2 = Math.abs(x + y - (s - 1));
      if ((d1 <= t || d2 <= t) && x > 1 && y > 1 && x < s - 2 && y < s - 2) pc.set(x, y, UI.coral);
    }
  for (let i = 4; i < s - 4; i++) if (Math.abs(i - (s - 1) / 2) > 3) pc.set(i, i - 3, '#ffd0c4');
  pc.outline(INK);
  return pc;
}

/** 물음표 (블록 픽셀) */
export function questionIcon(color = UI.lavD, bg = UI.lavL): PixelCanvas {
  const pc = new PixelCanvas(18, 20);
  pc.circle(9, 10, 8.5, bg);
  paint(pc, ['.pppp.', 'pp..pp', '....pp', '...pp.', '..pp..', '..pp..', '......', '..pp..', '..pp..'], 6, 5, { p: color });
  pc.outline(INK);
  return pc;
}

/** 느낌표 */
export function exclaimIcon(color = UI.coral): PixelCanvas {
  const pc = new PixelCanvas(8, 18);
  paint(pc, ['.pp.', 'pppp', 'pppp', 'pppp', 'pppp', '.pp.', '.pp.', '.pp.', '....', '.pp.', '.pp.'], 2, 3, { p: color });
  pc.set(3, 4, '#ffd0c4');
  pc.outline(INK);
  return pc;
}

/** 돋보기 */
export function magnifier(): PixelCanvas {
  const pc = new PixelCanvas(20, 20);
  pc.circle(8, 8, 6.5, P.slate);
  pc.circle(8, 8, 5, UI.skyL);
  pc.set(5, 5, '#ffffff');
  pc.set(6, 5, '#ffffff');
  pc.set(5, 6, '#ffffff');
  for (let i = 0; i < 6; i++) {
    pc.rect(12 + i, 12 + i, 3, 2, P.woodDark);
    pc.set(12 + i, 12 + i, P.wood);
  }
  pc.outline(INK);
  return pc;
}

/** 깃발 (시작·종료) */
export function flag(checker: boolean, color = UI.coral): PixelCanvas {
  const pc = new PixelCanvas(18, 22);
  pc.rect(2, 1, 2, 20, P.slate);
  pc.set(2, 1, P.slateLight);
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 12; x++) {
      const wave = Math.round(Math.sin((x / 12) * Math.PI) * 1.5);
      const c = checker ? ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? INK : '#ffffff') : x < 1 ? mix(color, INK, 0.2) : color;
      pc.set(4 + x, 2 + y + wave, c);
    }
  pc.outline(INK);
  return pc;
}

/** 재생 ▶ 표시 (시작) */
export function playIcon(color = UI.mint): PixelCanvas {
  const pc = new PixelCanvas(16, 16);
  pc.circle(8, 8, 7.5, color);
  for (let j = 0; j < 8; j++) pc.hline(6, 6 + Math.min(j, 7 - j), 4 + j, '#ffffff');
  pc.outline(INK);
  return pc;
}

// ------------------------------------------------------------------ 팀 배지 심볼 (추가 3종)

export const EXTRA_SYMBOLS: Record<string, string[]> = {
  flower: ['..#.#..', '.#####.', '###.###', '.##.##.', '###.###', '.#####.', '..#.#..'],
  bolt: ['...###.', '..###..', '.###...', '#######', '...###.', '..###..', '.##....'],
  clover: ['.##.##.', '#######', '.#####.', '..###..', '.#####.', '###.###', '.#..#..'],
};

export function symbolRows(sym: string): string[] {
  return EXTRA_SYMBOLS[sym] ?? TEAM_SYMBOL_ROWS[sym as keyof typeof TEAM_SYMBOL_ROWS];
}

/** 게임의 팀 배지와 같은 원형 배지 (11×11 + 외곽선) */
export function teamBadge(color: string, sym: string): PixelCanvas {
  const pc = new PixelCanvas(13, 13);
  pc.circle(6.5, 6.5, 5, color);
  paint(pc, symbolRows(sym), 3, 3, { '#': '#ffffff' });
  pc.outline(INK);
  return pc;
}

/** 큰 사각 배지 (점수판·팀 소개용) */
export function teamBadgeBig(color: string, dark: string, sym: string): PixelCanvas {
  const pc = new PixelCanvas(22, 23);
  rrect(pc, 1, 2, 20, 20, 4, dark);
  rrect(pc, 1, 1, 20, 20, 4, color);
  pc.hline(4, 17, 2, mix(color, '#ffffff', 0.4));
  const rows = symbolRows(sym);
  // 2배 크기 심볼
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') pc.rect(4 + x * 2, 4 + y * 2, 2, 2, '#ffffff');
  });
  pc.outline(INK);
  return pc;
}

// ------------------------------------------------------------------ 상품

export function giftBox(box = UI.coral, boxD = UI.coralD, rib = UI.lemon, ribD = UI.lemonD): PixelCanvas {
  const pc = new PixelCanvas(22, 22);
  // 리본 매듭
  pc.ellipse(7, 4, 4, 3, rib);
  pc.ellipse(15, 4, 4, 3, rib);
  pc.set(7, 4, ribD);
  pc.set(15, 4, ribD);
  // 뚜껑
  pc.rect(1, 6, 20, 5, box);
  pc.hline(1, 20, 6, mix(box, '#ffffff', 0.35));
  pc.hline(1, 20, 10, boxD);
  // 상자
  pc.rect(2, 11, 18, 10, box);
  pc.rect(2, 11, 18, 1, boxD);
  pc.rect(15, 12, 5, 9, boxD);
  // 세로 리본
  pc.rect(10, 6, 3, 15, rib);
  pc.vline(12, 6, 20, ribD);
  pc.outline(INK);
  return pc;
}

/** 상품권 틀 (특정 브랜드 로고 없이 중립적인 티켓 모양) */
export function voucher(w = 72, h = 36, color = '#7fd8c8', dark = '#4fb6a6'): PixelCanvas {
  const pc = new PixelCanvas(w, h + 2);
  rrect(pc, 0, 2, w, h, 3, INK);
  rrect(pc, 0, 0, w, h, 3, INK);
  rrect(pc, 1, 1, w - 2, h - 2, 2, color);
  pc.hline(3, w - 4, 1, mix(color, '#ffffff', 0.45));
  // 오른쪽 떼는 부분
  const cut = w - 20;
  for (let y = 3; y < h - 3; y += 3) pc.set(cut, y, INK);
  // 양옆 반원 홈
  for (const y of [Math.floor(h / 2)]) {
    for (const [cx, cy] of [
      [cut, 0],
      [cut, h - 1],
    ])
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j <= 9) pc.clear(cx + i, cy + j);
    void y;
  }
  // 안쪽 흰 글자 자리
  rrect(pc, 6, 7, cut - 11, h - 14, 2, '#ffffff');
  rrect(pc, 7, 8, cut - 13, h - 16, 1, UI.paper);
  // 떼는 쪽 별
  star5(pc, cut + 10, h / 2, 5, UI.lemon, UI.lemonD);
  pc.outline(INK);
  return pc;
}

export function projector(): PixelCanvas {
  const pc = new PixelCanvas(30, 20);
  // 빛줄기
  for (let x = 0; x < 9; x++) {
    const half = 1 + Math.floor(x * 0.6);
    pc.vline(x, 8 - half, 8 + half, x % 2 ? '#fff3b0' : '#fff8d6');
  }
  // 본체
  rrect(pc, 8, 4, 20, 11, 2, '#e9ecf5');
  pc.hline(9, 26, 5, '#ffffff');
  pc.rect(9, 12, 18, 2, P.stoneDark);
  // 렌즈
  pc.circle(12, 9, 3.5, P.slate);
  pc.circle(12, 9, 2, P.skyLight);
  pc.set(11, 8, '#ffffff');
  // 버튼·통풍구
  pc.set(22, 7, UI.coral);
  pc.set(24, 7, UI.mint);
  for (let i = 0; i < 4; i++) pc.set(19 + i * 2, 10, P.stoneDark);
  // 다리
  pc.rect(10, 15, 2, 2, P.slate);
  pc.rect(24, 15, 2, 2, P.slate);
  pc.outline(INK);
  return pc;
}

/** 말랑이 (찹쌀떡 같은 말랑한 장난감) */
export function squishy(color: string, dark: string, face = true): PixelCanvas {
  const pc = new PixelCanvas(16, 13);
  pc.ellipse(8, 7.5, 7.5, 5.5, (dx, dy) => (dy > 0.45 ? dark : dx < -0.3 && dy < -0.3 ? mix(color, '#ffffff', 0.5) : color));
  if (face) {
    pc.set(5, 7, INK);
    pc.set(10, 7, INK);
    pc.set(7, 9, INK);
    pc.set(8, 9, INK);
    pc.set(4, 8, '#ff9fb0');
    pc.set(11, 8, '#ff9fb0');
  }
  pc.outline(INK);
  return pc;
}

export function squishySet(): PixelCanvas {
  const pc = new PixelCanvas(40, 24);
  const a = squishy('#ffd0dc', '#f4a9bb');
  const b = squishy('#dcf6eb', '#a9e3c9');
  const c = squishy('#fff1c4', '#f3d68a');
  pc.blit(a, 0, 10);
  pc.blit(b, 24, 10);
  pc.blit(c, 12, 2);
  return pc;
}

/** 붕어빵 모양 보조배터리 겸 손난로 (몸통 + 충전 단자 + 번개 표시) */
export function fishWarmer(): PixelCanvas {
  const pc = new PixelCanvas(28, 16);
  // 몸통 (붕어빵 색)
  pc.ellipse(12, 8, 10.5, 6, (dx, dy) => (dy > 0.5 ? '#c98557' : dy < -0.5 && dx < 0.3 ? '#f6cba6' : '#e6a777'));
  // 꼬리
  for (let j = 0; j < 9; j++) pc.hline(22, 22 + Math.min(j, 8 - j) + 1, 4 + j, j > 4 ? '#c98557' : '#e6a777');
  // 비늘 무늬
  for (const [x, y] of [
    [9, 6],
    [12, 6],
    [15, 6],
    [10.5, 9],
    [13.5, 9],
  ]) {
    pc.set(x, y, '#b9875a');
    pc.set(x + 1, y + 1, '#b9875a');
  }
  // 눈
  pc.set(5, 6, INK);
  pc.set(4, 9, '#b9875a');
  // 충전 단자
  pc.rect(0, 7, 2, 3, P.slate);
  pc.set(0, 8, P.slateLight);
  // 번개 표시 (배터리)
  paint(pc, ['..y', '.y.', 'yyy', '.y.', 'y..'], 17, 5, { y: UI.lemon });
  pc.outline(INK);
  return pc;
}

/** 당첨 로제트 배지 (두 갈래 리본 꼬리) */
export function rosette(color = UI.coral, dark = UI.coralD): PixelCanvas {
  const pc = new PixelCanvas(24, 30);
  // 리본 꼬리 두 갈래 (바깥으로 벌어짐, 끝은 V 자)
  for (const side of [-1, 1] as const) {
    for (let j = 0; j < 13; j++) {
      const cx = 12 + side * (3 + Math.floor(j / 2.2));
      for (let i = -2; i <= 2; i++) {
        const notch = j >= 11 && Math.abs(i) < 13 - j;
        if (notch) continue;
        pc.set(cx + i, 15 + j, side < 0 ? dark : color);
      }
    }
  }
  // 주름 꽃잎
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    pc.circle(12 + Math.cos(a) * 7, 10 + Math.sin(a) * 7, 2.6, k % 2 ? color : mix(color, '#ffffff', 0.3));
  }
  pc.circle(12, 10, 7, UI.lemon);
  pc.circle(12, 10, 5.5, '#ffffff');
  star5(pc, 12, 10.5, 4, UI.lemon, UI.lemonD);
  pc.outline(INK);
  return pc;
}

// ------------------------------------------------------------------ 이펙트·장식

/** 방사형 빛살 (발견 성공·점수) */
export function burst(s: number, c = UI.lemon, c2 = '#ffffff', rays = 12): PixelCanvas {
  const pc = new PixelCanvas(s, s);
  const m = s / 2;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = x + 0.5 - m;
      const dy = y + 0.5 - m;
      const d = Math.hypot(dx, dy);
      if (d > m - 1 || d < m * 0.25) continue;
      const a = Math.atan2(dy, dx);
      const k = ((a / (Math.PI * 2)) * rays + rays) % 1;
      const width = 0.18 * (1 - d / m) + 0.06;
      if (k < width || k > 1 - width) pc.set(x, y, d < m * 0.6 ? c2 : c);
    }
  return pc;
}

/** 톱니 말풍선 ('찾았다!!' 같은 외침용, 가운데 비움) */
export function shoutBubble(w: number, h: number, fill = '#ffffff', line = INK): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const spikes = 16;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / (w / 2 - 1);
      const dy = (y + 0.5 - cy) / (h / 2 - 1);
      const a = Math.atan2(dy, dx);
      const t = ((a / (Math.PI * 2)) * spikes + spikes) % 1; // 0~1 톱니
      const r = 0.7 + 0.3 * (1 - Math.abs(t * 2 - 1)); // 삼각 톱니 → 뾰족
      if (Math.hypot(dx, dy) < r) pc.set(x, y, fill);
    }
  pc.outline(line);
  return pc;
}

/** 일반 말풍선 (꼬리 포함, 가운데 비움) */
export function speechBubble(w: number, h: number, tailLeft = true): PixelCanvas {
  const pc = new PixelCanvas(w, h + 5);
  rrect(pc, 1, 1, w - 2, h - 2, 3, '#ffffff');
  const tx = tailLeft ? 6 : w - 10;
  for (let j = 0; j < 4; j++) pc.hline(tx + (tailLeft ? 0 : j), tx + 3 - (tailLeft ? j : 0), h - 1 + j, '#ffffff');
  pc.outline(INK);
  return pc;
}

/** 리본 매듭 */
export function bow(color = UI.coral, dark = UI.coralD): PixelCanvas {
  const pc = new PixelCanvas(20, 14);
  pc.ellipse(5, 5, 5, 4, (dx) => (dx > 0.4 ? dark : color));
  pc.ellipse(15, 5, 5, 4, (dx) => (dx < -0.4 ? dark : color));
  pc.rect(8, 3, 4, 5, dark);
  pc.set(9, 4, color);
  for (let j = 0; j < 5; j++) {
    pc.set(8 - j, 8 + j, color);
    pc.set(7 - j, 8 + j, dark);
    pc.set(11 + j, 8 + j, color);
    pc.set(12 + j, 8 + j, dark);
  }
  pc.set(3, 3, mix(color, '#ffffff', 0.5));
  pc.outline(INK);
  return pc;
}

export function arrow(dir: 'right' | 'left' | 'up' | 'down', color = UI.coral): PixelCanvas {
  const rows = ['....#....', '....##...', '#######..', '########.', '#########', '########.', '#######..', '....##...', '....#....'];
  const pc = new PixelCanvas(11, 11);
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      if (r[x] !== '#') continue;
      const [px, py] = dir === 'right' ? [x, y] : dir === 'left' ? [8 - x, y] : dir === 'down' ? [y, x] : [y, 8 - x];
      pc.set(1 + px, 1 + py, y < 4 && dir !== 'up' && dir !== 'down' ? mix(color, '#ffffff', 0.2) : color);
    }
  });
  pc.outline(INK);
  return pc;
}

/** 종이 꽃가루 조각 */
export function confettiPiece(kind: number, color: string): PixelCanvas {
  const shapes = [['##', '##', '##'], ['###', '###'], ['#.', '##', '.#'], ['.#', '##', '#.'], ['#..', '.#.', '..#'], ['#']];
  const rows = shapes[kind % shapes.length];
  const pc = new PixelCanvas(rows[0].length, rows.length);
  paint(pc, rows, 0, 0, { '#': color });
  return pc;
}

export const CONFETTI_COLORS = ['#ff6b6b', '#ffcb3d', '#62c46a', '#5aa3f0', '#a98bf0', '#ff8fc0', '#ffffff', '#7fd8b6'];

/** 가랜드 (삼각 깃발 줄) — w 폭 */
export function garland(w: number, sag = 6): PixelCanvas {
  const h = sag + 12;
  const pc = new PixelCanvas(w, h);
  const colors = [UI.coral, UI.lemon, UI.mint, UI.sky, UI.lav, '#ffa9c6'];
  const yAt = (x: number) => 1 + Math.round(sag * Math.sin((x / (w - 1)) * Math.PI));
  for (let x = 0; x < w; x++) pc.set(x, yAt(x), P.woodDeep);
  let i = 0;
  for (let x = 4; x < w - 8; x += 11) {
    const c = colors[i++ % colors.length];
    const y0 = yAt(x + 4) + 1;
    for (let j = 0; j < 8; j++) pc.hline(x + Math.floor(j / 2), x + 8 - Math.floor(j / 2), y0 + j, j < 2 ? mix(c, '#ffffff', 0.3) : c);
  }
  pc.outline(INK);
  return pc;
}

/** 숨바꼭질 제목 장식 (블라인드 화면 줄무늬 + 엿보는 눈, 가운데 비움) */
export function hideSeekFrame(w: number, h: number): PixelCanvas {
  const pc = new PixelCanvas(w, h + 2);
  rrect(pc, 0, 2, w, h, 4, INK);
  rrect(pc, 0, 0, w, h, 4, INK);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) if (pc.opaque(x, y)) pc.set(x, y, Math.floor((x + y) / 4) % 2 ? UI.plum : UI.plum2);
  // 엿보는 눈 (왼쪽)
  for (const ex of [8, 18]) {
    pc.rect(ex, Math.floor(h / 2) - 3, 6, 6, '#ffffff');
    pc.rect(ex + 2, Math.floor(h / 2) - 1, 3, 3, UI.plum);
  }
  // 가운데 글자 자리 (살짝 밝은 띠)
  rrect(pc, 30, 5, w - 60, h - 10, 3, '#3d3047');
  return pc;
}

/** 캐릭터 축하 고깔모자 (수뭉이 축하 버전용) */
export function partyHat(): PixelCanvas {
  const pc = new PixelCanvas(9, 11);
  for (let j = 0; j < 9; j++) {
    const half = Math.floor(j / 2);
    for (let i = -half; i <= half; i++) pc.set(4 + i, 1 + j, (j + i + 9) % 4 < 2 ? UI.coral : UI.lemon);
  }
  pc.circle(4.5, 1, 1.4, '#ffffff');
  pc.hline(0, 8, 10, UI.lavD);
  pc.outline(INK);
  return pc;
}
