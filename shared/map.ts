/**
 * 메인 광장 맵 정의 (클라이언트 렌더링 + 서버 충돌 검사 공용).
 * 좌표 단위: 타일(16px) 또는 픽셀. 함수 이름에 명시합니다.
 */
import { COLLISION_CELL, FOOT_H, FOOT_W, INTERACT_RANGE, MAP_COLS, MAP_ROWS, TILE, WORLD_H, WORLD_W } from './constants';

export const T = {
  GRASS: 0,
  PATH: 1,
  PLAZA: 2,
  SAND: 3,
  WATER: 4,
  WALL: 5,
  DECK: 6,
  STONE: 7,
  DIRT: 8,
  /** 온천물 */
  SPRING: 9,
} as const;
export type TileType = (typeof T)[keyof typeof T];

export type PropKind =
  | 'tree'
  | 'treeRound'
  | 'blossom'
  | 'bush'
  | 'lamp'
  | 'bench'
  | 'board'
  | 'pot'
  | 'sign'
  | 'campfire'
  | 'log'
  | 'logV'
  | 'tent'
  | 'lantern'
  | 'slide'
  | 'swing'
  | 'seesaw'
  | 'castle'
  | 'spring'
  | 'portal'
  | 'crystal'
  | 'barrier'
  | 'banner'
  | 'door'
  | 'reed'
  | 'foodtruck'
  | 'bunting'
  | 'picnic'
  | 'menuSign'
  | 'capyBath'
  | 'capyRest'
  | 'bucket'
  | 'fern';

export interface Prop {
  kind: PropKind;
  /** 바닥 중심 x (px) */
  x: number;
  /** 바닥 y (px) — 깊이 정렬 기준 */
  y: number;
  /** 충돌 영역 [가로, 세로] — x 중앙, y 바닥 기준 */
  foot?: [number, number];
  flip?: boolean;
  /** 표지판 문구 등 */
  label?: string;
  /** 바닥에 깔리는 장식 (항상 캐릭터 아래) */
  flat?: boolean;
  /** 온천 안 소품 (온천 이동 충돌에만 적용) */
  inBath?: boolean;
}

export type ZoneId = 'plaza' | 'board' | 'foodtruck' | 'campfire' | 'playground' | 'portal' | 'spring';

export interface Zone {
  id: ZoneId;
  name: string;
  desc: string;
  /** 1 = 지금 이용 가능, 2·3 = 해당 차수 개발 예정 */
  phase: 1 | 2 | 3;
  /** 영역 (px) */
  rect: { x: number; y: number; w: number; h: number };
  /** 관전 화면 라벨 위치 (px) */
  label: { x: number; y: number };
}

/** 상호작용 지점 */
export interface Spot {
  x: number;
  y: number;
  r: number;
}

export interface WorldMap {
  cols: number;
  rows: number;
  tiles: Uint8Array;
  props: Prop[];
  zones: Zone[];
  /** 걸어 다닐 때의 충돌 */
  collision: CollisionGrid;
  /** 온천 안에서의 충돌 (물 안쪽만 이동 가능) */
  bathGrid: CollisionGrid;
  spawn: { x: number; y: number; w: number; h: number };
  spots: { foodtruck: Spot; board: Spot; spring: Spot };
}

// ---------------------------------------------------------------- 충돌 격자

export class CollisionGrid {
  readonly cols: number;
  readonly rows: number;
  readonly data: Uint8Array;
  constructor(readonly worldW: number, readonly worldH: number, readonly cell = COLLISION_CELL) {
    this.cols = Math.ceil(worldW / cell);
    this.rows = Math.ceil(worldH / cell);
    this.data = new Uint8Array(this.cols * this.rows);
  }
  private fillRect(x: number, y: number, w: number, h: number, v: 0 | 1) {
    const c0 = Math.max(0, Math.floor(x / this.cell));
    const r0 = Math.max(0, Math.floor(y / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + w - 0.001) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((y + h - 0.001) / this.cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.data[r * this.cols + c] = v;
  }
  blockRect(x: number, y: number, w: number, h: number) {
    this.fillRect(x, y, w, h, 1);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    this.fillRect(x, y, w, h, 0);
  }
  blockedAt(px: number, py: number): boolean {
    if (px < 0 || py < 0 || px >= this.worldW || py >= this.worldH) return true;
    return this.data[Math.floor(py / this.cell) * this.cols + Math.floor(px / this.cell)] === 1;
  }
  /** 발 박스(캐릭터 좌표 기준)가 놓일 수 있는지 */
  canStand(x: number, y: number): boolean {
    const l = x - FOOT_W / 2;
    const r = x + FOOT_W / 2 - 0.01;
    const t = y - FOOT_H;
    const b = y - 0.01;
    for (let py = t; ; py = Math.min(py + this.cell, b)) {
      for (let px = l; ; px = Math.min(px + this.cell, r)) {
        if (this.blockedAt(px, py)) return false;
        if (px >= r) break;
      }
      if (py >= b) break;
    }
    return true;
  }
  /** 축 분리 이동 — 벽을 따라 미끄러지듯 움직입니다 */
  move(x: number, y: number, dx: number, dy: number): { x: number; y: number } {
    let nx = x;
    let ny = y;
    if (dx !== 0) {
      if (this.canStand(x + dx, y)) nx = x + dx;
      else {
        // 모서리에 살짝 걸렸을 때 자연스럽게 비켜가기
        for (const nudge of [2, -2, 4, -4]) {
          if (this.canStand(x + dx, y + nudge) && this.canStand(x, y + nudge)) {
            nx = x + dx;
            ny = y + nudge * 0.5;
            break;
          }
        }
      }
    }
    if (dy !== 0) {
      if (this.canStand(nx, ny + dy)) ny = ny + dy;
      else {
        for (const nudge of [2, -2, 4, -4]) {
          if (this.canStand(nx + nudge, ny + dy) && this.canStand(nx + nudge, ny)) {
            ny = ny + dy;
            nx = nx + nudge * 0.5;
            break;
          }
        }
      }
    }
    return { x: nx, y: ny };
  }
  /** (x,y) 에서 가장 가까운 설 수 있는 위치 */
  nearest(x: number, y: number, maxR = 72): { x: number; y: number } | null {
    if (this.canStand(x, y)) return { x, y };
    for (let r = 2; r <= maxR; r += 2) {
      let best: { x: number; y: number; d: number } | null = null;
      const steps = Math.max(8, Math.round(r * 1.5));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const cx = Math.round(x + Math.cos(a) * r);
        const cy = Math.round(y + Math.sin(a) * r);
        if (!this.canStand(cx, cy)) continue;
        const d = Math.hypot(cx - x, cy - y);
        if (!best || d < best.d) best = { x: cx, y: cy, d };
      }
      if (best) return { x: best.x, y: best.y };
    }
    return null;
  }
}

// ---------------------------------------------------------------- 결정적 난수

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 맵 빌드

const px = (t: number) => t * TILE;

function buildMap(): WorldMap {
  const cols = MAP_COLS;
  const rows = MAP_ROWS;
  const tiles = new Uint8Array(cols * rows);
  const set = (x: number, y: number, t: TileType) => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) tiles[y * cols + x] = t;
  };
  const fill = (x: number, y: number, w: number, h: number, t: TileType) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, t: TileType) => {
    for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++)
      for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
        const dx = (i + 0.5 - cx) / rx;
        const dy = (j + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) set(i, j, t);
      }
  };
  const roundRect = (x: number, y: number, w: number, h: number, r: number, t: TileType) => {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) {
        const cx = Math.max(x + r, Math.min(i + 0.5, x + w - r));
        const cy = Math.max(y + r, Math.min(j + 0.5, y + h - r));
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) set(i, j, t);
      }
  };

  // 바닥
  fill(0, 0, cols, rows, T.GRASS);
  fill(0, 0, cols, 3, T.WALL);

  // 길
  fill(29, 3, 2, 9, T.PATH); // 광장 → 본관
  fill(12, 16, 11, 2, T.PATH); // 광장 → 서쪽
  fill(10, 9, 2, 9, T.PATH); // → 푸드트럭
  fill(10, 16, 2, 7, T.PATH); // → 모닥불
  fill(37, 16, 12, 2, T.PATH); // 광장 → 동쪽
  fill(48, 11, 2, 7, T.PATH); // → 포털
  fill(48, 16, 2, 6, T.PATH); // → 놀이터
  fill(29, 23, 2, 2, T.PATH); // → 온천

  roundRect(23, 12, 14, 11, 2.2, T.PLAZA); // 중앙 광장
  fill(4, 3, 14, 7, T.DECK); // 푸드트럭 앞 나무 데크
  ellipse(11, 26.5, 4.6, 3.8, T.DIRT); // 모닥불 터
  roundRect(41, 21, 16, 10, 2.5, T.SAND); // 놀이터 모래밭
  ellipse(49, 8.5, 4.8, 4, T.STONE); // 포털 단상
  ellipse(30, 28.6, 4.6, 3.05, T.SPRING); // 카피바라 온천

  // ------------------------------------------------------------ 소품
  const props: Prop[] = [];
  const add = (p: Prop) => props.push(p);

  // 본관 벽 장식
  add({ kind: 'banner', x: px(30), y: px(1) + 8, flat: true });
  add({ kind: 'door', x: px(30), y: px(3), flat: true });

  // 중앙 광장 + 게시판
  for (const [x, y] of [
    [px(23) + 10, px(12) + 14],
    [px(37) - 10, px(12) + 14],
    [px(23) + 10, px(23) - 6],
    [px(37) - 10, px(23) - 6],
  ])
    add({ kind: 'lamp', x, y, foot: [6, 4] });
  add({ kind: 'board', x: px(30), y: px(15) + 2, foot: [74, 8] });
  add({ kind: 'bench', x: px(25) + 8, y: px(13) + 2, foot: [24, 6] });
  add({ kind: 'bench', x: px(35) - 8, y: px(13) + 2, foot: [24, 6] });
  add({ kind: 'bench', x: px(26) + 8, y: px(22) + 4, foot: [24, 6] });
  add({ kind: 'bench', x: px(34) - 8, y: px(22) + 4, foot: [24, 6] });

  // 푸드트럭 존
  add({ kind: 'bunting', x: px(11), y: px(3) + 10 });
  add({ kind: 'foodtruck', x: px(11), y: px(6) + 8, foot: [90, 16] });
  add({ kind: 'menuSign', x: px(4) + 12, y: px(8) + 2, foot: [14, 5] });
  add({ kind: 'picnic', x: px(6), y: px(11) + 4, foot: [34, 10] });
  add({ kind: 'picnic', x: px(16), y: px(11) + 4, foot: [34, 10], flip: true });
  add({ kind: 'pot', x: px(17) + 10, y: px(7) + 6, foot: [10, 5] });
  add({ kind: 'sign', x: px(13) + 6, y: px(13) + 4, foot: [4, 4], label: '푸드트럭' });

  // 모닥불 쉼터
  const fx = px(11) + 8;
  const fy = px(26) + 12;
  add({ kind: 'campfire', x: fx, y: fy, foot: [16, 8] });
  add({ kind: 'log', x: fx, y: fy - 30, foot: [28, 6] });
  add({ kind: 'log', x: fx, y: fy + 30, foot: [28, 6] });
  add({ kind: 'logV', x: fx - 42, y: fy + 10, foot: [8, 20] });
  add({ kind: 'logV', x: fx + 42, y: fy + 10, foot: [8, 20], flip: true });
  add({ kind: 'tent', x: px(5) + 6, y: px(23) + 4, foot: [34, 12] });
  add({ kind: 'lantern', x: px(16) + 8, y: px(23), foot: [4, 4] });
  add({ kind: 'lantern', x: px(6), y: px(30) + 4, foot: [4, 4] });
  add({ kind: 'sign', x: px(13) + 6, y: px(21) + 2, foot: [4, 4], label: '모닥불 쉼터' });

  // 놀이터
  add({ kind: 'slide', x: px(44) + 4, y: px(24) + 8, foot: [36, 12] });
  add({ kind: 'swing', x: px(53), y: px(24) + 8, foot: [56, 5] });
  add({ kind: 'seesaw', x: px(45), y: px(29) + 4, foot: [42, 6] });
  add({ kind: 'castle', x: px(53) + 4, y: px(29) + 6, foot: [22, 8] });
  add({ kind: 'spring', x: px(49), y: px(27) + 6, foot: [10, 5] });
  add({ kind: 'sign', x: px(46) + 6, y: px(21) - 2, foot: [4, 4], label: '놀이터' });

  // 게임 포털
  add({ kind: 'portal', x: px(49), y: px(8) + 8, foot: [48, 10] });
  add({ kind: 'barrier', x: px(49), y: px(10) + 2, foot: [44, 4] });
  add({ kind: 'crystal', x: px(44) + 6, y: px(9) + 4, foot: [8, 5] });
  add({ kind: 'crystal', x: px(54) + 10, y: px(9) + 4, foot: [8, 5], flip: true });
  add({ kind: 'sign', x: px(46) + 6, y: px(14), foot: [4, 4], label: '게임 포털' });

  // 카피바라 온천
  add({ kind: 'capyBath', x: px(33) + 4, y: px(28) + 10, foot: [20, 8], inBath: true });
  add({ kind: 'capyRest', x: px(24) + 8, y: px(29) + 2, foot: [22, 7] });
  add({ kind: 'bucket', x: px(35) + 12, y: px(26) + 6, foot: [10, 5] });
  add({ kind: 'fern', x: px(25) + 2, y: px(26) + 4 });
  add({ kind: 'fern', x: px(35) + 4, y: px(30) + 4, flip: true });
  add({ kind: 'reed', x: px(24) + 4, y: px(31) + 4 });
  add({ kind: 'sign', x: px(27), y: px(24) + 6, foot: [4, 4], label: '카피바라 온천' });

  // 광장 주변 나무·덤불
  const trees: [number, number, PropKind][] = [
    [px(20), px(6), 'tree'],
    [px(22) - 4, px(9) + 8, 'blossom'],
    [px(25) + 4, px(5) + 8, 'treeRound'],
    [px(35), px(5) + 4, 'tree'],
    [px(38) + 8, px(9) + 8, 'blossom'],
    [px(40), px(6), 'tree'],
    [px(16), px(14) - 2, 'treeRound'],
    [px(43), px(15) - 2, 'treeRound'],
    [px(20), px(25), 'tree'],
    [px(22) + 4, px(29) + 8, 'treeRound'],
    [px(39) + 4, px(25), 'tree'],
    [px(38), px(30) + 4, 'treeRound'],
    [px(19), px(19) + 8, 'blossom'],
    [px(41), px(19) + 8, 'blossom'],
  ];
  for (const [x, y, kind] of trees) add({ kind, x, y, foot: [10, 6] });
  const bushes: [number, number][] = [
    [px(27) + 8, px(7)],
    [px(33) - 8, px(7) + 6],
    [px(19) + 6, px(11)],
    [px(42) - 4, px(12) - 6],
    [px(7) + 4, px(15)],
    [px(53), px(16) + 2],
    [px(36) + 8, px(24) + 2],
    [px(15) + 6, px(31) - 2],
    [px(41) + 6, px(31) - 2],
    [px(3) + 8, px(19) + 4],
    [px(56) + 4, px(18) + 4],
  ];
  for (const [x, y] of bushes) add({ kind: 'bush', x, y, foot: [12, 5] });

  // 가장자리 숲 (울타리 역할)
  const rnd = mulberry32(20260);
  for (let y = px(3) + 14; y < px(32); y += 22) {
    add({ kind: rnd() > 0.5 ? 'tree' : 'treeRound', x: 10 + rnd() * 4, y: y + rnd() * 6 });
    add({ kind: rnd() > 0.5 ? 'tree' : 'treeRound', x: WORLD_W - 10 - rnd() * 4, y: y + 11 + rnd() * 6, flip: true });
  }
  for (let x = 26; x < WORLD_W - 20; x += 24) {
    add({ kind: rnd() > 0.4 ? 'treeRound' : 'tree', x: x + rnd() * 6, y: WORLD_H - 2 - rnd() * 4, flip: rnd() > 0.5 });
  }

  // ------------------------------------------------------------ 충돌
  const collision = new CollisionGrid(WORLD_W, WORLD_H);
  const bathGrid = new CollisionGrid(WORLD_W, WORLD_H);
  bathGrid.data.fill(1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const t = tiles[j * cols + i];
      if (t === T.WALL || t === T.WATER || t === T.SPRING) collision.blockRect(px(i), px(j), TILE, TILE);
      if (t === T.SPRING) bathGrid.clearRect(px(i), px(j), TILE, TILE);
    }
  collision.blockRect(0, 0, px(2), WORLD_H); // 왼쪽 숲
  collision.blockRect(WORLD_W - px(2), 0, px(2), WORLD_H); // 오른쪽 숲
  collision.blockRect(0, px(32) - 6, WORLD_W, WORLD_H); // 아래쪽 숲
  for (const p of props) {
    if (!p.foot) continue;
    const [w, h] = p.foot;
    (p.inBath ? bathGrid : collision).blockRect(p.x - w / 2, p.y - h, w, h);
  }

  // ------------------------------------------------------------ 구역 (앞쪽이 우선)
  const zones: Zone[] = [
    {
      id: 'board',
      name: '메시지 게시판',
      desc: '선후배에게 한마디를 남기고, 다른 사람의 쪽지를 읽어보세요.',
      phase: 1,
      rect: { x: px(27), y: px(11), w: px(6), h: px(6) },
      label: { x: px(30), y: px(11) - 4 },
    },
    {
      id: 'foodtruck',
      name: '푸드트럭',
      desc: '축제 간식을 받아 들고 다니다 먹어보세요.',
      phase: 1,
      rect: { x: px(2), y: px(3), w: px(17), h: px(10) },
      label: { x: px(11), y: px(2) + 4 },
    },
    {
      id: 'portal',
      name: '게임 포털',
      desc: "'과제 괴물' 협동 레이드 입구예요. 3차 업데이트에서 열려요.",
      phase: 3,
      rect: { x: px(42), y: px(3), w: px(16), h: px(11) },
      label: { x: px(49), y: px(3) + 4 },
    },
    {
      id: 'campfire',
      name: '모닥불 쉼터',
      desc: '모닥불 곁에 모여 쉬어가요. 대화 기능은 2차 업데이트 예정이에요.',
      phase: 2,
      rect: { x: px(2), y: px(21), w: px(17), h: px(11) },
      label: { x: px(11), y: px(21) + 4 },
    },
    {
      id: 'playground',
      name: '놀이터',
      desc: '장난 기믹과 상호작용은 2차 업데이트에서 추가돼요.',
      phase: 2,
      rect: { x: px(40), y: px(20), w: px(18), h: px(12) },
      label: { x: px(49), y: px(20) + 6 },
    },
    {
      id: 'spring',
      name: '카피바라 온천',
      desc: '따끈한 온천에 몸을 담그고 카피바라와 함께 쉬어가요.',
      phase: 1,
      rect: { x: px(23), y: px(24), w: px(15), h: px(8) },
      label: { x: px(30), y: px(32) + 2 },
    },
    {
      id: 'plaza',
      name: '중앙 광장',
      desc: '모두가 모이는 아지트의 한가운데예요.',
      phase: 1,
      rect: { x: px(22), y: px(11), w: px(16), h: px(13) },
      label: { x: px(30), y: px(23) - 2 },
    },
  ];

  return {
    cols,
    rows,
    tiles,
    props,
    zones,
    collision,
    bathGrid,
    spawn: { x: px(25), y: px(17), w: px(10), h: px(4) },
    spots: {
      foodtruck: { x: px(11), y: px(7) + 2, r: INTERACT_RANGE + 18 },
      board: { x: px(30), y: px(15) + 10, r: INTERACT_RANGE + 6 },
      spring: { x: px(30), y: px(28) + 8, r: 92 },
    },
  };
}

export const WORLD: WorldMap = buildMap();

export function tileAt(x: number, y: number): TileType {
  if (x < 0 || y < 0 || x >= WORLD.cols || y >= WORLD.rows) return T.GRASS;
  return WORLD.tiles[y * WORLD.cols + x] as TileType;
}

export function zoneAt(x: number, y: number): Zone | null {
  for (const z of WORLD.zones) {
    const r = z.rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return z;
  }
  return null;
}

export function nearSpot(spot: Spot, x: number, y: number) {
  return Math.hypot(spot.x - x, spot.y - y) <= spot.r;
}

/** 온천 가장자리(물에서 36px 이내)에 서 있는지 */
export function nearSpringEdge(x: number, y: number) {
  if (!nearSpot(WORLD.spots.spring, x, y)) return false;
  for (let r = 0; r <= 36; r += 4)
    for (let a = 0; a < 16; a++) {
      const cx = x + Math.cos((a / 16) * Math.PI * 2) * r;
      const cy = y - 3 + Math.sin((a / 16) * Math.PI * 2) * r;
      if (tileAt(Math.floor(cx / TILE), Math.floor(cy / TILE)) === T.SPRING) return true;
    }
  return false;
}

/** 스폰 영역에서 서 있을 수 있는 무작위 위치 */
export function randomSpawn(rand: () => number = Math.random): { x: number; y: number } {
  const s = WORLD.spawn;
  for (let i = 0; i < 50; i++) {
    const x = Math.round(s.x + rand() * s.w);
    const y = Math.round(s.y + rand() * s.h);
    if (WORLD.collision.canStand(x, y)) return { x, y };
  }
  return { x: px(30), y: px(19) };
}
