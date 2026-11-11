/**
 * 경품 무대용 픽셀 아트: 캡슐 뽑기 기계 · 캡슐 · 상품 아이콘 (빔프로젝터 · 말랑이 세트 · 붕어빵 손난로 · 상품권)
 * 아지트와 같은 PixelCanvas · 팔레트 · 1px 잉크 외곽선 규칙.
 */
import { ITEM } from '../../../../shared/events';
import { P } from './palette';
import { mix, PixelCanvas } from './pixel';

const INK = '#3d3047';

function rrect(pc: PixelCanvas, x: number, y: number, w: number, h: number, r: number, c: string) {
  const T: Record<number, number[]> = { 0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1] };
  const t = T[Math.max(0, Math.min(4, r))];
  for (let j = 0; j < h; j++) {
    const k = Math.min(j, h - 1 - j);
    const ins = k < t.length ? t[k] : 0;
    if (w - ins * 2 > 0) pc.hline(x + ins, x + w - 1 - ins, y + j, c);
  }
}

export function star5(pc: PixelCanvas, cx: number, cy: number, r: number, c: string, d?: string) {
  const pts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++)
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) pc.set(x, y, d && y > cy + r * 0.25 ? d : c);
    }
}

export function starIcon(r = 5): HTMLCanvasElement {
  const s = Math.ceil(r * 2) + 3;
  const pc = new PixelCanvas(s, s);
  star5(pc, s / 2, s / 2 + 0.5, r, '#ffd66e', '#ebb94a');
  pc.outline(INK);
  return pc.flush();
}

export const CAPSULE_COLORS: [string, string][] = [
  ['#ff8f7a', '#e2715f'],
  ['#86c8f2', '#5aa3d6'],
  ['#7fd8b6', '#3fa883'],
  ['#ffd66e', '#ebb94a'],
  ['#b9a3ef', '#957bd8'],
  ['#ffa9c6', '#ff7aa6'],
];

/** 캡슐 (위 반쪽 색, 아래 반쪽 흰색). open = 뚜껑이 열린 모습 */
export function capsule(i: number, open = false): HTMLCanvasElement {
  const [c, d] = CAPSULE_COLORS[i % CAPSULE_COLORS.length];
  const pc = new PixelCanvas(16, open ? 20 : 16);
  const oy = open ? 4 : 0;
  // 아래 반쪽
  pc.ellipse(8, 8 + oy, 7, 7, (dx, dy) => (dy > 0 ? (dy > 0.6 ? '#e9ecf5' : '#ffffff') : null));
  pc.hline(1, 14, 8 + oy, '#d5d9e8');
  // 위 반쪽 (열리면 위로 떠 있음)
  const ty = open ? -3 : 0;
  pc.ellipse(8, 8 + ty, 7, 7, (dx, dy) => (dy <= 0 ? (dx < -0.3 && dy < -0.4 ? mix(c, '#ffffff', 0.5) : dy > -0.25 ? d : c) : null));
  pc.outline(INK);
  return pc.flush();
}

/** 캡슐 뽑기 기계 (유리 돔 + 몸통 + 손잡이 + 배출구). 캡슐은 따로 그려서 움직임 */
export function gachaMachine(): HTMLCanvasElement {
  const pc = new PixelCanvas(64, 84);
  // 받침
  rrect(pc, 6, 70, 52, 12, 2, P.coralDark);
  pc.hline(8, 55, 71, P.coral);
  // 몸통
  rrect(pc, 8, 40, 48, 32, 3, P.coral);
  pc.hline(10, 53, 41, P.coralLight);
  pc.rect(10, 66, 44, 3, P.coralDark);
  // 손잡이 자리 (원판)
  pc.circle(22, 54, 7, '#ffffff');
  pc.circle(22, 54, 5, '#e9ecf5');
  pc.rect(17, 53, 11, 3, P.lemon);
  pc.rect(17, 53, 11, 1, '#fff1c4');
  // 배출구
  rrect(pc, 36, 50, 14, 12, 2, INK);
  rrect(pc, 37, 51, 12, 10, 1, '#55526d');
  pc.hline(38, 47, 52, '#6b6884');
  // 동전 투입구
  pc.rect(40, 44, 6, 2, INK);
  // 유리 돔 (안이 비쳐 보이도록 연한 하늘색)
  pc.ellipse(32, 22, 24, 20, (dx, dy) => (dy > 0.85 ? null : dx < -0.45 && dy < -0.2 && dx > -0.7 ? '#ffffff' : '#dff4fdcc'));
  pc.rect(10, 37, 44, 4, P.lemon);
  pc.hline(10, 53, 37, '#fff1c4');
  // 꼭대기 장식
  pc.rect(28, 0, 8, 3, P.lemon);
  pc.outline(INK);
  return pc.flush();
}

/** 손잡이 (돌리는 부분, 회전 연출용으로 따로) */
export function gachaHandle(): HTMLCanvasElement {
  const pc = new PixelCanvas(13, 13);
  pc.rect(0, 5, 13, 3, P.lemon);
  pc.rect(0, 5, 13, 1, '#fff1c4');
  pc.circle(6.5, 6.5, 2.5, P.lemonDark);
  pc.outline(INK);
  return pc.flush();
}

export function giftBox(box = '#ff8f7a', boxD = '#e2715f', rib = '#ffd66e', ribD = '#ebb94a'): HTMLCanvasElement {
  const pc = new PixelCanvas(22, 22);
  pc.ellipse(7, 4, 4, 3, rib);
  pc.ellipse(15, 4, 4, 3, rib);
  pc.set(7, 4, ribD);
  pc.set(15, 4, ribD);
  pc.rect(1, 6, 20, 5, box);
  pc.hline(1, 20, 6, mix(box, '#ffffff', 0.35));
  pc.hline(1, 20, 10, boxD);
  pc.rect(2, 11, 18, 10, box);
  pc.rect(2, 11, 18, 1, boxD);
  pc.rect(15, 12, 5, 9, boxD);
  pc.rect(10, 6, 3, 15, rib);
  pc.vline(12, 6, 20, ribD);
  pc.outline(INK);
  return pc.flush();
}

function projectorPc(): PixelCanvas {
  const pc = new PixelCanvas(30, 20);
  for (let x = 0; x < 9; x++) {
    const half = 1 + Math.floor(x * 0.6);
    pc.vline(x, 8 - half, 8 + half, x % 2 ? '#fff3b0' : '#fff8d6');
  }
  rrect(pc, 8, 4, 20, 11, 2, '#e9ecf5');
  pc.hline(9, 26, 5, '#ffffff');
  pc.rect(9, 12, 18, 2, P.stoneDark);
  pc.circle(12, 9, 3.5, P.slate);
  pc.circle(12, 9, 2, P.skyLight);
  pc.set(11, 8, '#ffffff');
  pc.set(22, 7, P.coral);
  pc.set(24, 7, P.mint);
  for (let i = 0; i < 4; i++) pc.set(19 + i * 2, 10, P.stoneDark);
  pc.rect(10, 15, 2, 2, P.slate);
  pc.rect(24, 15, 2, 2, P.slate);
  pc.outline(INK);
  return pc;
}

function squishyPc(color: string, dark: string): PixelCanvas {
  const pc = new PixelCanvas(16, 13);
  pc.ellipse(8, 7.5, 7.5, 5.5, (dx, dy) => (dy > 0.45 ? dark : dx < -0.3 && dy < -0.3 ? mix(color, '#ffffff', 0.5) : color));
  pc.set(5, 7, INK);
  pc.set(10, 7, INK);
  pc.set(7, 9, INK);
  pc.set(8, 9, INK);
  pc.set(4, 8, '#ff9fb0');
  pc.set(11, 8, '#ff9fb0');
  pc.outline(INK);
  return pc;
}

function squishySetPc(): PixelCanvas {
  const pc = new PixelCanvas(40, 24);
  pc.blit(squishyPc('#ffd0dc', '#f4a9bb'), 0, 10);
  pc.blit(squishyPc('#dcf6eb', '#a9e3c9'), 24, 10);
  pc.blit(squishyPc('#fff1c4', '#f3d68a'), 12, 2);
  return pc;
}

function fishWarmerPc(): PixelCanvas {
  const pc = new PixelCanvas(28, 16);
  pc.ellipse(12, 8, 10.5, 6, (dx, dy) => (dy > 0.5 ? '#c98557' : dy < -0.5 && dx < 0.3 ? '#f6cba6' : '#e6a777'));
  for (let j = 0; j < 9; j++) pc.hline(22, 22 + Math.min(j, 8 - j) + 1, 4 + j, j > 4 ? '#c98557' : '#e6a777');
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
  pc.set(5, 6, INK);
  pc.rect(0, 7, 2, 3, P.slate);
  pc.set(0, 8, P.slateLight);
  const bolt = ['..y', '.y.', 'yyy', '.y.', 'y..'];
  bolt.forEach((r, y) => [...r].forEach((ch, x) => ch === 'y' && pc.set(17 + x, 5 + y, '#ffd66e')));
  pc.outline(INK);
  return pc;
}

function voucherPc(): PixelCanvas {
  const w = 44;
  const h = 24;
  const color = '#7fd8c8';
  const pc = new PixelCanvas(w, h + 2);
  rrect(pc, 0, 2, w, h, 3, INK);
  rrect(pc, 0, 0, w, h, 3, INK);
  rrect(pc, 1, 1, w - 2, h - 2, 2, color);
  pc.hline(3, w - 4, 1, mix(color, '#ffffff', 0.45));
  const cut = w - 14;
  for (let y = 3; y < h - 3; y += 3) pc.set(cut, y, INK);
  rrect(pc, 5, 6, cut - 9, h - 12, 2, '#ffffff');
  star5(pc, cut + 7, h / 2, 4, '#ffd66e', '#ebb94a');
  pc.outline(INK);
  return pc;
}

/** 상품 아이콘 (id → 캔버스). silhouette = 정체를 가린 실루엣 */
export function prizeIcon(id: string, silhouette = false): HTMLCanvasElement {
  const pc = id === ITEM.projector ? projectorPc() : id === ITEM.squishy ? squishySetPc() : id === ITEM.fishwarmer ? fishWarmerPc() : voucherPc();
  if (silhouette) for (let i = 0; i < pc.buf.length; i++) if (pc.buf[i] >>> 24) pc.buf[i] = 0xff47303d;
  return pc.flush();
}

/** 캔버스를 DOM 이미지처럼 (픽셀 그대로 확대) */
export function pixelEl(c: HTMLCanvasElement, scale: number, cls = ''): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  out.getContext('2d')!.drawImage(c, 0, 0);
  out.className = `px-img ${cls}`;
  out.style.width = `${c.width * scale}px`;
  out.style.height = `${c.height * scale}px`;
  return out;
}
