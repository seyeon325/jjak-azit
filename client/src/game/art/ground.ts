/**
 * 바닥(지형) 전체를 한 장의 텍스처로 굽습니다.
 * 모바일에서 타일 수백 개를 따로 그리는 것보다 훨씬 가볍습니다.
 */
import { TILE, WORLD_H, WORLD_W } from '../../../../shared/constants';
import { T, tileAt, WORLD, type TileType } from '../../../../shared/map';
import { P } from './palette';
import { hash2, mix, PixelCanvas } from './pixel';
import { PROP_SHADOW } from './props';

const W = WORLD_W;
const H = WORLD_H;

// 경계 우선순위 (높을수록 위에 깔린 재질)
const PRIORITY: Record<number, number> = {
  [T.GRASS]: 0,
  [T.DIRT]: 1,
  [T.SAND]: 2,
  [T.PATH]: 3,
  [T.STONE]: 4,
  [T.PLAZA]: 5,
  [T.DECK]: 6,
  [T.WATER]: -1,
  [T.SPRING]: -1,
  [T.WALL]: 9,
};

const RIM: Record<number, string> = {
  [T.DIRT]: P.dirtDark,
  [T.SAND]: P.sandDark,
  [T.PATH]: P.pathDark,
  [T.STONE]: P.stoneDark,
  [T.PLAZA]: '#dcc6a6',
  [T.DECK]: P.woodDeep,
};

/** 부드러운 값 노이즈 */
function valueNoise(x: number, y: number, scale: number, seed: number) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}

export function bakeGround(): HTMLCanvasElement {
  const pc = new PixelCanvas(W, H);
  const ter = new Uint8Array(W * H);

  // 1) 타일 → 픽셀 지형 + 모서리 둥글리기
  for (let ty = 0; ty < WORLD.rows; ty++)
    for (let tx = 0; tx < WORLD.cols; tx++) {
      const t = tileAt(tx, ty);
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) ter[(ty * TILE + y) * W + tx * TILE + x] = t;
    }
  const R = 5;
  for (let ty = 0; ty < WORLD.rows; ty++)
    for (let tx = 0; tx < WORLD.cols; tx++) {
      const t = tileAt(tx, ty);
      if (t === T.GRASS || t === T.WALL) continue;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const nx = tileAt(tx + sx, ty);
        const ny = tileAt(tx, ty + sy);
        if (nx === t || ny === t || tileAt(tx + sx, ty + sy) === t) continue;
        if (ty + sy < 0 || ty + sy >= WORLD.rows || tx + sx < 0 || tx + sx >= WORLD.cols) continue;
        const fillT = PRIORITY[nx] < PRIORITY[ny] ? nx : ny;
        if (fillT === T.WALL) continue;
        // 코너 사분원 바깥을 주변 재질로
        const cx = sx < 0 ? R : TILE - R;
        const cy = sy < 0 ? R : TILE - R;
        for (let y = 0; y < TILE; y++)
          for (let x = 0; x < TILE; x++) {
            const inCorner = (sx < 0 ? x < cx : x >= cx) && (sy < 0 ? y < cy : y >= cy);
            if (!inCorner) continue;
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            if (dx * dx + dy * dy > R * R) ter[(ty * TILE + y) * W + tx * TILE + x] = fillT;
          }
      }
    }
  const terAt = (x: number, y: number): TileType =>
    (x < 0 || y < 0 || x >= W || y >= H ? T.GRASS : ter[y * W + x]) as TileType;

  // 2) 재질별 픽셀 칠하기
  const plazaCx = 30 * TILE;
  const plazaCy = 17.5 * TILE;
  const portalCx = 49 * TILE;
  const portalCy = 8.5 * TILE;
  const fireCx = 11 * TILE + 8;
  const fireCy = 26 * TILE + 8;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = ter[y * W + x];
      const n = hash2(x, y, 1);
      let c: string;
      switch (t) {
        case T.GRASS: {
          const v = valueNoise(x, y, 22, 7) * 0.7 + valueNoise(x, y, 7, 3) * 0.3;
          c = v > 0.62 ? P.grassLight : v > 0.5 ? P.grass : v > 0.3 ? P.grass2 : P.grassDark;
          if (v > 0.5 && v < 0.62 && n > 0.93) c = P.grass2;
          if (n < 0.025) c = P.grassDark;
          break;
        }
        case T.PATH: {
          c = n > 0.94 ? P.pathLight : n < 0.05 ? P.pathDark : P.path;
          const pv = valueNoise(x, y, 9, 11);
          if (pv > 0.78 && n > 0.4) c = mix(P.path, P.pathDark, 0.5);
          break;
        }
        case T.PLAZA: {
          const row = Math.floor(y / 8);
          const off = row % 2 ? 4 : 0;
          const lx = (x + off) % 8;
          const ly = y % 8;
          const tid = hash2(Math.floor((x + off) / 8), row, 21);
          c = tid > 0.9 ? '#fbe3d3' : tid > 0.8 ? '#e9f2f1' : tid > 0.45 ? P.plaza : P.plazaAlt;
          if (lx === 0 || ly === 0) c = P.plazaGrout;
          else if (lx === 1 && ly === 1) c = mix(c, '#ffffff', 0.5);
          // 가운데 문양: 서로 맞물린 두 고리 (선배·후배)
          const dx = x + 0.5 - plazaCx;
          const dy = y + 0.5 - plazaCy;
          const d0 = Math.sqrt(dx * dx + dy * dy);
          if (d0 < 34) {
            if (d0 > 31) c = '#e3cba9';
            else if (d0 > 29) c = '#f3dfc2';
            else c = lx === 0 || ly === 0 ? '#ead8bf' : '#fbf3e6';
            const dA = Math.hypot(dx + 8, dy);
            const dB = Math.hypot(dx - 8, dy);
            const inA = dA > 11 && dA < 15;
            const inB = dB > 11 && dB < 15;
            if (inB) c = dB < 12 || dB > 14 ? P.skyDark : P.sky;
            // 맞물림 효과: 위쪽 교차점은 코랄이 위로
            if (inA && (!inB || dy < 0)) c = dA < 12 || dA > 14 ? P.coralDark : P.coral;
          }
          break;
        }
        case T.SAND: {
          c = n > 0.93 ? P.sandLight : n < 0.06 ? P.sandDark : P.sand;
          if (valueNoise(x, y, 6, 5) > 0.82) c = mix(P.sand, P.sandDark, 0.45);
          break;
        }
        case T.DIRT: {
          c = n > 0.92 ? '#e8c9a4' : n < 0.07 ? P.dirtDark : P.dirt;
          const fd = Math.hypot(x - fireCx, (y - fireCy) * 1.3);
          if (fd < 11) c = mix(c, '#8a6a55', 0.45);
          else if (fd < 15 && n > 0.5) c = mix(c, '#a7856a', 0.3);
          break;
        }
        case T.DECK: {
          const board = Math.floor(y / 5);
          const seamX = (x + board * 11) % 26 === 0;
          const tone = hash2(Math.floor((x + board * 11) / 26), board, 9);
          c = tone > 0.66 ? P.woodLight : tone > 0.33 ? P.wood : '#d39f6e';
          if (y % 5 === 4) c = P.woodDark;
          else if (seamX) c = P.woodDark;
          else if (y % 5 === 0) c = mix(c, '#ffffff', 0.18);
          if (n > 0.97) c = P.woodDark;
          break;
        }
        case T.STONE: {
          const row = Math.floor(y / 7);
          const off = (row * 5) % 11;
          const lx = (x + off) % 11;
          const tid = hash2(Math.floor((x + off) / 11), row, 4);
          c = tid > 0.6 ? P.stone : tid > 0.3 ? '#dcdfec' : P.stoneLight;
          if (lx === 0 || y % 7 === 0) c = P.stoneDark;
          const pd = Math.hypot(x + 0.5 - portalCx, (y + 0.5 - portalCy - 6) * 1.25);
          if (pd > 47 && pd < 49) c = '#c7b6f2';
          if (pd > 52 && pd < 53.2) c = '#c7b6f2';
          break;
        }
        case T.WATER: {
          const depth = valueNoise(x, y, 14, 2);
          c = depth > 0.55 ? P.waterDeep : P.water;
          const wave = Math.sin(x * 0.35 + Math.sin(y * 0.6) * 2 + y * 0.9);
          if (wave > 0.96 && n > 0.3) c = P.waterLight;
          break;
        }
        case T.SPRING: {
          // 따뜻한 온천물 (청록 + 살짝 복숭아빛 반짝임)
          const depth = valueNoise(x, y, 12, 4);
          c = depth > 0.6 ? '#7fd3c5' : depth > 0.34 ? '#93ded0' : '#a8e7d9';
          const wave = Math.sin(x * 0.3 + Math.sin(y * 0.7) * 2 + y * 1.1);
          if (wave > 0.95 && n > 0.35) c = '#d8f7ef';
          else if (n > 0.996) c = '#ffe4d3';
          break;
        }
        case T.WALL:
        default:
          c = P.plaster;
      }
      pc.set(x, y, c);
    }

  // 3) 경계선 (재질이 바뀌는 곳)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = ter[y * W + x];
      if (t === T.WALL || t === T.SPRING) continue;
      const nb = [terAt(x - 1, y), terAt(x + 1, y), terAt(x, y - 1), terAt(x, y + 1)];
      if (nb.some((v) => v === T.SPRING)) continue;
      if (t === T.WATER) {
        // 물가 하이라이트
        if (nb.some((v) => v !== T.WATER && v !== T.DECK)) pc.set(x, y, '#d9f4fe');
        else if (
          [terAt(x - 2, y), terAt(x + 2, y), terAt(x, y - 2), terAt(x, y + 2)].some((v) => v !== T.WATER && v !== T.DECK)
        )
          pc.set(x, y, P.waterLight);
        continue;
      }
      if (nb.some((v) => v === T.WATER)) {
        pc.set(x, y, t === T.DECK ? P.woodDeep : '#7fb46a');
        continue;
      }
      const pr = PRIORITY[t];
      if (pr > 0 && nb.some((v) => PRIORITY[v] < pr && v !== T.WALL)) {
        pc.set(x, y, RIM[t] ?? P.pathDark);
      } else if (t === T.GRASS && pr === 0) {
        // 길 가장자리 아래쪽에 풀 그늘
        if (PRIORITY[terAt(x, y - 1)] > 0 && terAt(x, y - 1) !== T.WALL) pc.set(x, y, P.grassDark);
      }
    }

  // 3-2) 온천 돌 테두리 (물에서 6px 이내의 땅을 돌로)
  {
    const RIM_W = 6;
    const dist = new Uint8Array(W * H).fill(255);
    let frontier: number[] = [];
    for (let i = 0; i < W * H; i++)
      if (ter[i] === T.SPRING) {
        dist[i] = 0;
        frontier.push(i);
      }
    for (let d = 1; d <= RIM_W && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % W;
        const y = (i / W) | 0;
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (dist[j] !== 255) continue;
          dist[j] = d;
          next.push(j);
        }
      }
      frontier = next;
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = dist[i];
        if (ter[i] === T.SPRING) {
          // 물가 거품
          let edge = 0;
          for (const [nx, ny] of [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ])
            if (terAt(nx, ny) !== T.SPRING) edge = 1;
          if (edge) pc.set(x, y, '#ecfcf8');
          continue;
        }
        if (d === 255 || ter[i] === T.WALL) continue;
        const row = Math.floor(y / 5);
        const sx = x + (row % 2) * 3;
        const tone = hash2(Math.floor(sx / 6), row, 31);
        let c = tone > 0.66 ? '#dbd2c6' : tone > 0.33 ? '#c9bfb2' : '#b8ac9f';
        const seam = sx % 6 === 0 || y % 5 === 0;
        if (seam) c = '#9a8e81';
        else if (sx % 6 === 1 && y % 5 === 1) c = '#ede7dd';
        if (d === 1) c = '#8c8175';
        if (d === RIM_W) c = '#867a6e';
        pc.set(x, y, c);
      }
  }

  // 4) 풀 장식 (풀잎·꽃)
  const deco = (tx: number, ty: number) => {
    if (tileAt(tx, ty) !== T.GRASS) return;
    const r = hash2(tx, ty, 99);
    const x = tx * TILE + 3 + Math.floor(hash2(tx, ty, 5) * 10);
    const y = ty * TILE + 4 + Math.floor(hash2(tx, ty, 6) * 9);
    if (ter[y * W + x] !== T.GRASS) return;
    let nearOther = false;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (tileAt(tx + i, ty + j) !== T.GRASS) nearOther = true;
    if (r < 0.32) {
      // 풀잎 V
      pc.set(x, y, P.grassDark);
      pc.set(x - 1, y - 1, P.grassDark);
      pc.set(x + 1, y - 1, P.grassDark);
      pc.set(x - 1, y - 2, P.grassLight);
      if (hash2(tx, ty, 8) > 0.5) {
        pc.set(x + 4, y + 2, P.grassDark);
        pc.set(x + 3, y + 1, P.grassDark);
        pc.set(x + 5, y + 1, P.grassDark);
      }
    } else if (r < 0.43 && !nearOther) {
      const petals = ['#ffffff', P.lemon, P.pink, P.lavenderLight, '#ffd0c4'];
      const pcol = petals[Math.floor(hash2(tx, ty, 12) * petals.length)];
      const center = pcol === P.lemon ? P.coral : P.lemon;
      const flower = (fx: number, fy: number) => {
        pc.set(fx, fy - 1, pcol);
        pc.set(fx - 1, fy, pcol);
        pc.set(fx + 1, fy, pcol);
        pc.set(fx, fy + 1, pcol);
        pc.set(fx, fy, center);
        pc.set(fx, fy + 2, P.grassDark);
      };
      flower(x, y);
      if (hash2(tx, ty, 13) > 0.4) flower(x + 4, y + 3);
      if (hash2(tx, ty, 14) > 0.6) flower(x - 3, y + 4);
    } else if (r < 0.47) {
      // 작은 돌
      pc.set(x, y, '#d9d6cf');
      pc.set(x + 1, y, '#c3bfb8');
      pc.set(x, y - 1, '#ecebe6');
    }
  };
  for (let ty = 3; ty < WORLD.rows; ty++) for (let tx = 0; tx < WORLD.cols; tx++) deco(tx, ty);

  // 5) 본관 벽면 (위쪽 3줄)
  paintWall(pc);

  // 6) 소품 그림자
  for (const p of WORLD.props) {
    const s = PROP_SHADOW[p.kind];
    if (!s || p.flat) continue;
    const [rx, ry] = s;
    for (let y = Math.floor(p.y - ry - 1); y <= Math.ceil(p.y + ry - 1); y++)
      for (let x = Math.floor(p.x - rx); x <= Math.ceil(p.x + rx); x++) {
        const dx = (x + 0.5 - p.x) / rx;
        const dy = (y + 0.5 - (p.y - 1)) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1 || y < 48) continue;
        pc.tint(x, y, P.shadow, d < 0.5 ? 0.2 : 0.12);
      }
  }

  return pc.flush();
}

function paintWall(pc: PixelCanvas) {
  const wallBottom = 48;
  for (let y = 0; y < wallBottom; y++)
    for (let x = 0; x < W; x++) {
      let c: string;
      if (y < 12) {
        // 지붕 기와
        const row = Math.floor(y / 4);
        const off = row % 2 ? 5 : 0;
        const lx = (x + off) % 10;
        const ly = y % 4;
        const tone = hash2(Math.floor((x + off) / 10), row, 17);
        c = tone > 0.75 ? P.roofLight : tone > 0.2 ? P.roof : '#ec8a74';
        if (ly === 3) c = P.roofDark;
        else if (lx === 0) c = mix(P.roof, P.roofDark, 0.6);
        else if (ly === 0 && lx > 1 && lx < 8) c = mix(c, '#ffffff', 0.15);
      } else if (y < 15) {
        c = y === 12 ? P.woodLight : y === 13 ? P.wood : P.woodDeep;
      } else if (y < 43) {
        c = hash2(x, y, 2) > 0.95 ? P.plasterDark : P.plaster;
        const bx = x % 96;
        if (bx < 4) c = bx === 0 ? P.woodDeep : bx === 3 ? P.woodDark : P.wood;
        if (y === 15) c = mix(P.plaster, P.ink, 0.12);
      } else {
        // 돌 기단
        const lx = (x + (y > 45 ? 6 : 0)) % 12;
        c = y === 43 ? P.stoneLight : lx === 0 ? P.stoneDark : P.stone;
        if (y === 47) c = P.stoneDark;
      }
      pc.set(x, y, c);
    }
  // 창문
  for (let wx = 48; wx < W; wx += 96) {
    if (Math.abs(wx - 480) < 60) continue;
    const x0 = wx - 12;
    const y0 = 19;
    pc.rect(x0 - 1, y0 - 1, 26, 19, P.woodDeep);
    pc.rect(x0, y0, 24, 17, P.woodDark);
    pc.rect(x0 + 2, y0 + 2, 20, 13, P.glass);
    for (let i = 0; i < 6; i++) pc.set(x0 + 4 + i, y0 + 3 + i, P.glassLight);
    for (let i = 0; i < 4; i++) pc.set(x0 + 12 + i, y0 + 3 + i, P.glassLight);
    pc.vline(x0 + 11, y0 + 2, y0 + 14, P.woodDark);
    pc.hline(x0 + 2, x0 + 21, y0 + 8, P.woodDark);
    // 화분 상자
    pc.rect(x0 - 2, y0 + 18, 28, 4, P.wood);
    pc.hline(x0 - 2, x0 + 25, y0 + 21, P.woodDeep);
    const cols = [P.coral, P.pink, P.lemon, '#ffffff', P.lavender];
    for (let i = 0; i < 7; i++) {
      const fx = x0 + i * 4;
      pc.set(fx, y0 + 17, P.leafDark);
      pc.set(fx + 1, y0 + 16, cols[(i + wx) % cols.length]);
      pc.set(fx + 1, y0 + 17, P.leaf);
    }
  }
  // 벽 아래 그림자
  for (let x = 0; x < W; x++) {
    pc.tint(x, 48, P.shadow, 0.22);
    pc.tint(x, 49, P.shadow, 0.14);
    pc.tint(x, 50, P.shadow, 0.07);
  }
}
