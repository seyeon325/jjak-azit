/**
 * 짝선짝후 2026 PAIR — 행사 PPT용 픽셀 아트 에셋 패키지 생성기
 *
 *   npx tsx tools/ppt-assets/build.ts [출력 폴더]      (기본: PAIR_PPT_ASSETS)
 *
 * 게임 코드는 바꾸지 않습니다. 게임의 그래픽 함수(client/src/game/art)를 그대로 불러서
 * 원본 픽셀을 뽑고, 필요한 UI·이펙트·장식만 같은 규칙(같은 팔레트·1px 외곽선·같은 픽셀 크기)으로 새로 그립니다.
 * 모든 PNG 는 정수배 최근접 확대만 사용 → 흐림 없음. 1x = 원본 픽셀, 4x = 1920×1080 슬라이드 기준.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { Img, installCanvasShim, rgba, writeFile } from './img';

installCanvasShim();

const { PixelCanvas, hash2, mix } = await import('../../client/src/game/art/pixel');
const { P } = await import('../../client/src/game/art/palette');
const { buildProp, buildFlameSheet, buildSwirlSheet, buildShadow, buildSparkle, buildSwingSeat } = await import('../../client/src/game/art/props');
const { buildCharacterSheet, LOOKS, FRAME_W, FRAME_H, DIR_ROWS } = await import('../../client/src/game/art/characters');
const { buildFood, buildHeart, buildStar, buildSweat, buildCrumb } = await import('../../client/src/game/art/foods');
const { buildEmote, buildTeamBadge, buildPlane, buildBalloon, buildHammer, buildImpact } = await import('../../client/src/game/art/social');
const { bakeGround } = await import('../../client/src/game/art/ground');
const { WORLD, T, tileAt } = await import('../../shared/map');
const { TILE } = await import('../../shared/constants');
const { TEAMS, EMOTES } = await import('../../shared/social');
const { FOOD_IDS } = await import('../../shared/protocol');
const D = await import('./draw');
const { INK, UI } = D;

const ROOT = path.resolve(process.argv[2] ?? 'PAIR_PPT_ASSETS');
rmSync(ROOT, { recursive: true, force: true });

// ------------------------------------------------------------------ 저장 · 목록

interface Entry {
  file: string;
  cat: string;
  use: string;
  w: number;
  h: number;
  scales: number[];
  source: '원본 추출' | '원본 조합' | '신규 제작';
}
const entries: Entry[] = [];
const px = (pc: { w: number; h: number; buf: Uint32Array }) => Img.fromPixel(pc);
const cv = (c: unknown) => Img.fromCanvas(c);

function save(cat: string, name: string, img: Img, use: string, source: Entry['source'], scales = [1, 4, 8]) {
  for (const k of scales) writeFile(path.join(ROOT, cat, `${k}x`, `${name}.png`), img.scale(k).toPNG());
  entries.push({ file: `${cat}/{${scales.map((k) => `${k}x`).join(',')}}/${name}.png`, cat, use, w: img.w, h: img.h, scales, source });
}
function saveSvg(cat: string, name: string, img: Img, use: string) {
  writeFile(path.join(ROOT, cat, 'svg', `${name}.svg`), img.toSVG(4));
  entries.push({ file: `${cat}/svg/${name}.svg`, cat, use: `${use} (SVG, 4배 크기 픽셀 사각형)`, w: img.w, h: img.h, scales: [4], source: '신규 제작' });
}

const CAT = {
  style: '00_STYLE_GUIDE',
  bg: '01_BACKGROUNDS',
  char: '02_CHARACTERS',
  obj: '03_MAP_OBJECTS',
  ui: '04_UI_COMPONENTS',
  fx: '05_GAME_EFFECTS',
  prize: '06_EVENT_PRIZES',
  deco: '07_DECORATIONS',
  preview: '08_PREVIEW',
};

// ------------------------------------------------------------------ 원본 지형 공식 (client/src/game/art/ground.ts 와 같은 식)

/** 부드러운 값 노이즈 — period 를 주면 타일처럼 이어짐 */
function valueNoise(x: number, y: number, scale: number, seed: number, period = 0) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const w = (v: number) => (period ? ((v % period) + period) % period : v);
  const a = hash2(w(x0), w(y0), seed);
  const b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed);
  const d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
const wrap = (v: number, p: number) => (p ? ((v % p) + p) % p : v);

/** 잔디 한 픽셀 (원본과 같은 공식). tile = 반복 크기(px) */
function grassAt(x: number, y: number, tile = 0) {
  const v = tile ? valueNoise(x, y, tile / 3, 7, 3) * 0.7 + valueNoise(x, y, tile / 10, 3, 10) * 0.3 : valueNoise(x, y, 22, 7) * 0.7 + valueNoise(x, y, 7, 3) * 0.3;
  const n = hash2(wrap(x, tile), wrap(y, tile), 1);
  let c: string = v > 0.62 ? P.grassLight : v > 0.5 ? P.grass : v > 0.3 ? P.grass2 : P.grassDark;
  if (v > 0.5 && v < 0.62 && n > 0.93) c = P.grass2;
  if (n < 0.025) c = P.grassDark;
  return c;
}
function plazaAt(x: number, y: number, tile = 0) {
  const row = Math.floor(y / 8);
  const off = row % 2 ? 4 : 0;
  const lx = (x + off) % 8;
  const ly = y % 8;
  const bx = Math.floor((x + off) / 8);
  const tid = hash2(tile ? wrap(bx, tile / 8) : bx, tile ? wrap(row, tile / 8) : row, 21);
  let c: string = tid > 0.9 ? '#fbe3d3' : tid > 0.8 ? '#e9f2f1' : tid > 0.45 ? P.plaza : P.plazaAlt;
  if (lx === 0 || ly === 0) c = P.plazaGrout;
  else if (lx === 1 && ly === 1) c = mix(c, '#ffffff', 0.5);
  return c;
}
function pathAt(x: number, y: number, tile = 0) {
  const n = hash2(wrap(x, tile), wrap(y, tile), 1);
  let c: string = n > 0.94 ? P.pathLight : n < 0.05 ? P.pathDark : P.path;
  const pv = tile ? valueNoise(x, y, tile / 7, 11, 7) : valueNoise(x, y, 9, 11);
  if (pv > 0.78 && n > 0.4) c = mix(P.path, P.pathDark, 0.5);
  return c;
}
function sandAt(x: number, y: number, tile = 0) {
  const n = hash2(wrap(x, tile), wrap(y, tile), 1);
  let c: string = n > 0.93 ? P.sandLight : n < 0.06 ? P.sandDark : P.sand;
  if ((tile ? valueNoise(x, y, tile / 10, 5, 10) : valueNoise(x, y, 6, 5)) > 0.82) c = mix(P.sand, P.sandDark, 0.45);
  return c;
}
/** 나무 데크: 5px 판자, 26px 이음매 (반복용: 3장 엇갈림 주기) */
function deckAt(x: number, y: number, tileW = 0, tileH = 0) {
  const board = Math.floor(y / 5);
  const shift = tileW ? (board % 3) * 9 : board * 11;
  const seamX = (x + shift) % 26 === 0;
  const plank = Math.floor((x + shift) / 26);
  const tone = hash2(tileW ? wrap(plank, tileW / 26) : plank, tileH ? wrap(board, tileH / 5) : board, 9);
  let c: string = tone > 0.66 ? P.woodLight : tone > 0.33 ? P.wood : '#d39f6e';
  if (y % 5 === 4) c = P.woodDark;
  else if (seamX) c = P.woodDark;
  else if (y % 5 === 0) c = mix(c, '#ffffff', 0.18);
  if (hash2(wrap(x, tileW), wrap(y, tileH), 1) > 0.97) c = P.woodDark;
  return c;
}
/** 포털 앞 돌바닥 (7px 줄, 11px 돌) */
function stoneAt(x: number, y: number, tileH = 0) {
  const row = Math.floor(y / 7);
  const off = (row * 5) % 11;
  const lx = (x + off) % 11;
  const tid = hash2(Math.floor((x + off) / 11) % (tileH ? 6 : 1e9), tileH ? wrap(row, tileH / 7) : row, 4);
  let c: string = tid > 0.6 ? P.stone : tid > 0.3 ? '#dcdfec' : P.stoneLight;
  if (lx === 0 || y % 7 === 0) c = P.stoneDark;
  return c;
}
/** 온천 둘레 돌담 (5px 줄, 6px 돌) */
function rimStoneAt(x: number, y: number, tile = 0) {
  const row = Math.floor(y / 5);
  const sx = x + (row % 2) * 3;
  const tone = hash2(tile ? wrap(Math.floor(sx / 6), tile / 6) : Math.floor(sx / 6), tile ? wrap(row, tile / 5) : row, 31);
  let c = tone > 0.66 ? '#dbd2c6' : tone > 0.33 ? '#c9bfb2' : '#b8ac9f';
  if (sx % 6 === 0 || y % 5 === 0) c = '#9a8e81';
  else if (sx % 6 === 1 && y % 5 === 1) c = '#ede7dd';
  return c;
}

/** 원본 풀 장식 (풀잎 V · 꽃 · 작은 돌) — 16px 칸마다 하나 */
function grassDeco(pc: InstanceType<typeof PixelCanvas>, x0: number, y0: number, w: number, h: number, keep: (x: number, y: number) => boolean, density = 1, seed = 0) {
  for (let ty = 0; ty < Math.ceil(h / TILE); ty++)
    for (let tx = 0; tx < Math.ceil(w / TILE); tx++) {
      const r = hash2(tx + seed, ty, 99) / density;
      const x = x0 + tx * TILE + 3 + Math.floor(hash2(tx + seed, ty, 5) * 10);
      const y = y0 + ty * TILE + 4 + Math.floor(hash2(tx + seed, ty, 6) * 9);
      if (!keep(x, y)) continue;
      if (r < 0.32) {
        pc.set(x, y, P.grassDark);
        pc.set(x - 1, y - 1, P.grassDark);
        pc.set(x + 1, y - 1, P.grassDark);
        pc.set(x - 1, y - 2, P.grassLight);
        if (hash2(tx + seed, ty, 8) > 0.5) {
          pc.set(x + 4, y + 2, P.grassDark);
          pc.set(x + 3, y + 1, P.grassDark);
          pc.set(x + 5, y + 1, P.grassDark);
        }
      } else if (r < 0.43) drawFlowers(pc, x, y, tx + seed, ty);
      else if (r < 0.47) {
        pc.set(x, y, '#d9d6cf');
        pc.set(x + 1, y, '#c3bfb8');
        pc.set(x, y - 1, '#ecebe6');
      }
    }
}
const PETALS = ['#ffffff', P.lemon, P.pink, P.lavenderLight, '#ffd0c4'];
function drawFlowers(pc: InstanceType<typeof PixelCanvas>, x: number, y: number, tx: number, ty: number, forced?: string) {
  const pcol = forced ?? PETALS[Math.floor(hash2(tx, ty, 12) * PETALS.length)];
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
  if (forced || hash2(tx, ty, 13) > 0.4) flower(x + 4, y + 3);
  if (forced || hash2(tx, ty, 14) > 0.6) flower(x - 3, y + 4);
}

// ------------------------------------------------------------------ 원본 소품

type Kind = Parameters<typeof buildProp>[0];
function prop(kind: Kind, frame = 0): Img {
  const art = buildProp(kind);
  const img = cv(art.canvas);
  if (art.frames) return img.crop(frame * art.frames.w, 0, art.frames.w, art.frames.h);
  return img;
}
const flame = (f = 0) => cv(buildFlameSheet().canvas).crop(f * 16, 0, 16, 20);
const swirl = (f = 0) => cv(buildSwirlSheet().canvas).crop(f * 34, 0, 34, 46);

/** 소품을 바닥 중심(x)·바닥(y) 기준으로 놓기 (게임과 같은 origin 0.5, 1) */
function place(dst: Img, src: Img, x: number, y: number, flip = false) {
  dst.blit(src, Math.round(x - src.w / 2), Math.round(y - src.h), flip);
}

/** 그네: 프레임 + 좌석 2개 + 줄 (게임 장면과 같은 배치, 멈춘 상태) */
function swingComposite(dst: Img, x: number, y: number) {
  place(dst, prop('swing'), x, y);
  const seat = cv(buildSwingSeat());
  const pivotY = y - 40;
  const restY = pivotY + 28;
  for (const sx of [-7, 6]) {
    const rx = x + sx + 0.5;
    for (let yy = pivotY; yy <= restY - 4; yy++) {
      dst.over(Math.floor(rx - 3.5), yy, rgba('#55526d'));
      dst.over(Math.floor(rx + 3.5), yy, rgba('#55526d'));
      dst.over(Math.floor(rx - 2.5), yy, rgba('#b6bbd0'));
      dst.over(Math.floor(rx + 4.5), yy, rgba('#b6bbd0'));
    }
    dst.blit(seat, Math.round(rx - seat.w / 2), Math.round(restY - seat.h / 2));
  }
}
function campfireComposite(dst: Img, x: number, y: number) {
  place(dst, prop('campfire'), x, y);
  place(dst, flame(0), x, y - 5);
}
function portalComposite(dst: Img, x: number, y: number) {
  place(dst, swirl(0), x, y - 5);
  place(dst, prop('portal'), x, y);
}

/** 개별 오브젝트 (투명 배경, 여백 2px) */
function objectImg(kind: Kind | 'swingSet' | 'campfireLit' | 'portalOpen'): Img {
  const big = new Img(140, 120);
  const bx = 70;
  const by = 116;
  if (kind === 'swingSet') swingComposite(big, bx, by);
  else if (kind === 'campfireLit') campfireComposite(big, bx, by);
  else if (kind === 'portalOpen') portalComposite(big, bx, by);
  else place(big, prop(kind), bx, by);
  return big.trim().pad(2);
}

// ------------------------------------------------------------------ 전체 지도 (게임 화면 그대로, 글자 없는 간판)

function mapRender(): Img {
  const img = cv(bakeGround());
  const props = [...WORLD.props].sort((a, b) => (a.flat === b.flat ? a.y - b.y : a.flat ? -1 : 1));
  for (const p of props) {
    if (p.kind === 'portal') portalComposite(img, p.x, p.y);
    else if (p.kind === 'campfire') campfireComposite(img, p.x, p.y);
    else if (p.kind === 'swing') swingComposite(img, p.x, p.y);
    else place(img, prop(p.kind), p.x, p.y, !!p.flip);
  }
  return img;
}

// ==================================================================== 01 배경

const BW = 480;
const BH = 270;

/** 글자 뒤에 깔기 좋은 차분한 잔디 (같은 잔디 색 중 가운데 두 톤만, 얼룩 대비를 낮춤) */
function softGrassAt(x: number, y: number) {
  const v = valueNoise(x, y, 22, 7) * 0.7 + valueNoise(x, y, 7, 3) * 0.3;
  const n = hash2(x, y, 1);
  let c: string = v > 0.58 ? P.grassLight : v > 0.36 ? P.grass : P.grass2;
  if (n < 0.015) c = P.grassDark;
  return mix(c, P.grass, 0.45);
}

function grassBg(seed: number, density = 1, clear?: (x: number, y: number) => boolean, w = BW, h = BH, soft = false) {
  const pc = new PixelCanvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pc.set(x, y, (soft ? softGrassAt : grassAt)(x + seed * 37, y + seed * 11));
  grassDeco(pc, 0, 0, w, h, (x, y) => !clear || !clear(x, y), density, seed * 13);
  return pc;
}

/** 큰 픽셀(8배) 배경: 240×135 → 1920×1080 */
const SW = 240;
const SH = 135;
function awardsSmall(): Img {
  const img = px(grassBg(5, 0.7, inEllipse(120, 78, 95, 52), SW, SH, true));
  const g = px(D.garland(130, 6));
  img.blit(g, -6, 1);
  img.blit(g, 116, 1);
  confettiScatter(img, 5, (x, y) => !inEllipse(120, 78, 100, 56)(x, y), 34);
  for (const [x, y, r] of [
    [10, 34, 3],
    [222, 40, 3],
    [16, 104, 2.5],
    [218, 100, 2.5],
  ])
    img.blit(px(D.starIcon(r)), x, y);
  return img;
}
const inEllipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;

function buildBackgrounds() {
  // BG_01 기본 잔디: 가운데 비우고 가장자리에 나무·덤불
  {
    const img = px(grassBg(1, 1, inEllipse(240, 135, 170, 95)));
    const edge: [Kind, number, number, boolean?][] = [
      ['tree', 22, 70],
      ['blossom', 54, 40],
      ['bush', 30, 120],
      ['treeRound', 452, 64],
      ['bush', 420, 40, true],
      ['fern', 466, 110],
      ['bush', 26, 262],
      ['tree', 60, 268],
      ['blossom', 430, 266],
      ['bush', 462, 230, true],
      ['fern', 120, 262],
      ['fern', 360, 260, true],
    ];
    for (const [k, x, y, f] of edge) place(img, prop(k), x, y, f);
    save(CAT.bg, 'bg_01_grass_1920x1080', img, '기본 잔디 배경 (가운데 글자 영역 비움)', '원본 조합', [1, 4]);
    save(CAT.bg, 'bg_01_grass_plain_1920x1080', px(grassBg(1, 0.6, inEllipse(240, 135, 200, 110))), '장식 최소 잔디 배경', '원본 조합', [1, 4]);
    save(CAT.bg, 'bg_01_grass_soft_1920x1080', px(grassBg(1, 0.5, inEllipse(240, 135, 200, 110), BW, BH, true)), '차분한 잔디 (얼룩 대비 낮춤, 글자 많은 슬라이드용)', '원본 조합', [1, 4]);
    save(CAT.bg, 'bg_01_grass_bigpixel_1920x1080', px(grassBg(1, 0.6, inEllipse(120, 68, 95, 50), SW, SH, true)), '큰 픽셀 잔디 (240×135 를 8배 — 8x 에셋과 함께)', '원본 조합', [1, 8]);
  }

  // BG_02 중앙 광장: 광장 타일 + 두 고리 문양 + 가장자리 잔디·가로등·벤치
  {
    const pc = grassBg(2, 0.8);
    const m = { x: 28, y: 22 };
    const inPlaza = (x: number, y: number) => {
      const r = 10;
      const cx = Math.min(Math.max(x, m.x + r), BW - m.x - r);
      const cy = Math.min(Math.max(y, m.y + r), BH - m.y - r);
      return Math.hypot(x - cx, y - cy) <= r;
    };
    const cx = BW / 2;
    const cy = BH / 2 + 4;
    for (let y = 0; y < BH; y++)
      for (let x = 0; x < BW; x++) {
        if (!inPlaza(x, y)) {
          if (inPlaza(x, y - 1)) pc.set(x, y, P.grassDark); // 원본: 길 아래 풀 그늘
          continue;
        }
        let c = plazaAt(x, y);
        const edge = !inPlaza(x - 1, y) || !inPlaza(x + 1, y) || !inPlaza(x, y - 1) || !inPlaza(x, y + 1);
        if (edge) c = '#dcc6a6';
        // 원본 광장 가운데 문양 (두 고리, 크기 그대로)
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d0 = Math.hypot(dx, dy);
        if (d0 < 34) {
          const row = Math.floor(y / 8);
          const lx = (x + (row % 2 ? 4 : 0)) % 8;
          const ly = y % 8;
          c = d0 > 31 ? '#e3cba9' : d0 > 29 ? '#f3dfc2' : lx === 0 || ly === 0 ? '#ead8bf' : '#fbf3e6';
          const dA = Math.hypot(dx + 8, dy);
          const dB = Math.hypot(dx - 8, dy);
          const inA = dA > 11 && dA < 15;
          const inB = dB > 11 && dB < 15;
          if (inB) c = dB < 12 || dB > 14 ? P.skyDark : P.sky;
          if (inA && (!inB || dy < 0)) c = dA < 12 || dA > 14 ? P.coralDark : P.coral;
        }
        pc.set(x, y, c);
      }
    const img = px(pc);
    for (const [x, y] of [
      [16, 30],
      [464, 30],
      [16, 262],
      [464, 262],
    ])
      place(img, prop('lamp'), x, y);
    for (const [x, y] of [
      [96, 258],
      [384, 258],
    ])
      place(img, prop('bench'), x, y);
    for (const [k, x, y] of [
      ['bush', 240 - 140, 18],
      ['bush', 240 + 140, 18],
      ['blossom', 6, 150],
      ['blossom', 474, 150],
    ] as [Kind, number, number][])
      place(img, prop(k), x, y);
    save(CAT.bg, 'bg_02_plaza_1920x1080', img, '중앙 광장 배경 (원본 광장 타일·두 고리 문양)', '원본 조합', [1, 4]);
  }

  // BG_03 나무 데크 (푸드트럭 앞) 16:9
  {
    const pc = new PixelCanvas(BW, BH);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) pc.set(x, y, deckAt(x, y));
    const img = px(pc);
    const bunting = prop('bunting');
    for (let x = 0; x < BW + bunting.w; x += bunting.w) img.blit(bunting, x - 10, 2);
    place(img, prop('picnic'), 60, 262);
    place(img, prop('picnic'), 420, 262, true);
    place(img, prop('pot'), 22, 200);
    place(img, prop('pot'), 458, 200);
    save(CAT.bg, 'bg_03_deck_1920x1080', img, '푸드트럭 나무 데크 배경', '원본 조합', [1, 4]);
  }

  // 반복 타일
  const tile = (name: string, w: number, h: number, f: (x: number, y: number) => string, use: string) => {
    const pc = new PixelCanvas(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pc.set(x, y, f(x, y));
    save(CAT.bg, name, px(pc), `${use} · 이어 붙여도 끊김 없는 반복 타일`, '원본 조합', [1, 4]);
  };
  tile('tile_grass_64', 64, 64, (x, y) => grassAt(x, y, 64), '잔디');
  tile('tile_plaza_64', 64, 64, (x, y) => plazaAt(x, y, 64), '광장 바닥');
  tile('tile_path_64', 64, 64, (x, y) => pathAt(x, y, 64), '흙길');
  tile('tile_sand_64', 64, 64, (x, y) => sandAt(x, y, 64), '놀이터 모래');
  tile('tile_deck_78x60', 78, 60, (x, y) => deckAt(x, y, 78, 60), '나무 데크');
  tile('tile_stone_66x70', 66, 70, (x, y) => stoneAt(x, y, 70), '포털 돌바닥');
  tile('tile_brick_60x60', 60, 60, (x, y) => rimStoneAt(x, y, 60), '돌담·벽돌 (온천 둘레 돌)');

  // BG_04 퀴즈: 장식 최소, 가운데 넓게 비움
  {
    const img = px(grassBg(4, 0.45, (x, y) => x > 60 && x < 420 && y > 30 && y < 240, BW, BH, true));
    place(img, prop('bush'), 22, 266);
    place(img, prop('bush'), 458, 266, true);
    place(img, prop('fern'), 52, 268);
    place(img, prop('fern'), 428, 268, true);
    save(CAT.bg, 'bg_04_quiz_1920x1080', img, '퀴즈 전용 배경 (차분한 잔디, 가운데 문제 영역 비움)', '원본 조합', [1, 4]);
    const big = px(grassBg(4, 0.4, (x, y) => x > 30 && x < 210 && y > 16 && y < 120, SW, SH, true));
    place(big, prop('bush'), 12, 134);
    place(big, prop('bush'), 228, 134, true);
    save(CAT.bg, 'bg_04_quiz_bigpixel_1920x1080', big, '퀴즈 배경 큰 픽셀 (8배)', '원본 조합', [1, 8]);
  }

  // BG_05 시상식: 가랜드 + 별 + 꽃가루, 가운데 비움
  {
    const img = px(grassBg(5, 0.7, inEllipse(240, 150, 190, 100)));
    const g = px(D.garland(250, 10));
    img.blit(g, -6, 2);
    img.blit(g, 236, 2);
    const g2 = px(D.garland(200, 8));
    img.blit(g2, 140, 14);
    const stars = [
      [24, 60, 4],
      [452, 70, 4],
      [60, 110, 2.5],
      [420, 120, 2.5],
      [30, 200, 3],
      [446, 210, 3],
    ];
    for (const [x, y, r] of stars) img.blit(px(D.starIcon(r)), x, y);
    confettiScatter(img, 5, (x, y) => !inEllipse(240, 150, 200, 110)(x, y), 70);
    place(img, prop('blossom'), 16, 270);
    place(img, prop('blossom'), 464, 270, true);
    save(CAT.bg, 'bg_05_awards_1920x1080', img, '시상식 배경 (가랜드·별·꽃가루, 가운데 수상자 영역 비움)', '원본 조합', [1, 4]);
    save(CAT.bg, 'bg_05_awards_bigpixel_1920x1080', awardsSmall(), '시상식 배경 큰 픽셀 (8배)', '원본 조합', [1, 8]);
  }

  // 아지트 전체 지도 (온라인 아지트 안내용)
  const map = mapRender();
  save(CAT.bg, 'bg_map_full_960x544', map, '아지트 전체 지도 (게임 화면 그대로, 간판 글자는 비움)', '원본 추출', [1, 2, 4]);
  // 16:9 로 잘라낸 지도 (가로 960 중 가운데)
  save(CAT.bg, 'bg_map_crop_1920x1080', map.crop(0, 4, 960, 540).crop(0, 0, 960, 540), '아지트 지도 16:9 (2배 = 1920×1080)', '원본 추출', [1, 2]);
}

function confettiScatter(img: Img, seed: number, where: (x: number, y: number) => boolean, n: number) {
  for (let i = 0; i < n * 3 && n > 0; i++) {
    const x = Math.floor(hash2(i, seed, 71) * img.w);
    const y = Math.floor(hash2(i, seed, 72) * img.h);
    if (!where(x, y)) continue;
    const c = D.CONFETTI_COLORS[Math.floor(hash2(i, seed, 73) * D.CONFETTI_COLORS.length)];
    img.blit(px(D.confettiPiece(Math.floor(hash2(i, seed, 74) * 6), c)), x, y);
    n--;
  }
}

// ==================================================================== 02 캐릭터

const LOOK_SLUG = ['saenaegi', 'hoodie', 'catbeanie', 'frog', 'bookworm', 'sleepy', 'classrep', 'mushroom', 'coolsenior', 'bear', 'bunny', 'designer'];
const sheets = LOOKS.map((_, i) => cv(buildCharacterSheet(i)));
function frame(look: number, name: string): Img {
  const row = DIR_ROWS.indexOf(name[0] as (typeof DIR_ROWS)[number]);
  const col = Number(name.slice(1));
  return sheets[look].crop(col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H);
}
const charPad = (f: Img) => f.pad(4, 4, 4, 2);

function withEmote(look: number, base: string, emote: (typeof EMOTES)[number], extra?: (img: Img) => void): Img {
  const f = frame(look, base);
  const bubble = cv(buildEmote(emote));
  const img = new Img(30, FRAME_H + bubble.h - 3);
  img.blit(f, 5, bubble.h - 3);
  img.blit(bubble, 12, 0);
  extra?.(img);
  return img.pad(2);
}

function groupImg(looks: number[], poses: string[], spacing = 18, rows = 1): Img {
  const perRow = Math.ceil(looks.length / rows);
  const shadow = cv(buildShadow());
  const w = perRow * spacing + 10;
  const h = FRAME_H + (rows - 1) * 16 + 6;
  const img = new Img(w, h);
  // 뒤 줄부터 (위가 먼저)
  for (let r = rows - 1; r >= 0; r--) {
    const line = looks.slice(r * perRow, (r + 1) * perRow);
    const offX = r % 2 ? spacing / 2 : 0;
    line.forEach((look, i) => {
      const x = 4 + i * spacing + offX;
      const y = (rows - 1 - r) * 16 + 2;
      img.blit(shadow, x + 1, y + 21);
      img.blit(frame(look, poses[(r * perRow + i) % poses.length]), x, y);
    });
  }
  return img.trim().pad(3);
}

function buildCharacters() {
  const poses: [string, string, string][] = [
    ['stand', 'd0', '정면 서 있기'],
    ['stand_blink', 'd1', '정면 눈 깜빡'],
    ['walk_1', 'd2', '걷기 1/4'],
    ['walk_2', 'd3', '걷기 2/4'],
    ['walk_3', 'd4', '걷기 3/4'],
    ['walk_4', 'd5', '걷기 4/4'],
    ['back', 'u0', '뒷모습'],
    ['side', 's0', '옆모습 (왼쪽 보기, 좌우 반전해서 오른쪽)'],
    ['side_walk_1', 's2', '옆으로 걷기 1/4'],
    ['side_walk_2', 's3', '옆으로 걷기 2/4'],
    ['side_walk_3', 's4', '옆으로 걷기 3/4'],
    ['side_walk_4', 's5', '옆으로 걷기 4/4'],
    ['sit', 'p0', '앉아 있기 (정면)'],
    ['sit_back', 'q0', '앉아 있기 (뒷모습)'],
    ['wave_1', 'p1', '손 흔들기 1/2'],
    ['wave_2', 'p2', '손 흔들기 2/2'],
    ['happy', 'p3', '기뻐하기 (브이)'],
    ['surprised', 'p4', '놀람'],
    ['smile', 'e0', '활짝 웃기'],
    ['dance_1', 'p1', '춤추기 1/4'],
    ['dance_2', 'd2', '춤추기 2/4'],
    ['dance_3', 'p4', '춤추기 3/4'],
    ['dance_4', 'd4', '춤추기 4/4'],
  ];
  LOOKS.forEach((L, i) => {
    const id = `a${String(i + 1).padStart(2, '0')}_${LOOK_SLUG[i]}`;
    for (const [name, f, use] of poses) save(CAT.char, `char_${id}_${name}`, charPad(frame(i, f)), `${L.name} · ${use}`, '원본 추출');
    save(CAT.char, `char_${id}_side_right`, charPad(frame(i, 's0').flipX()), `${L.name} · 옆모습 (오른쪽 보기)`, '원본 추출');
    save(CAT.char, `char_${id}_clap`, withEmote(i, 'e0', 'clap'), `${L.name} · 박수 (웃는 얼굴 + 박수 말풍선)`, '원본 조합');
    save(CAT.char, `char_${id}_heart`, withEmote(i, 'p3', 'heart'), `${L.name} · 하트 표현`, '원본 조합');
    save(
      CAT.char,
      `char_${id}_celebrate`,
      withEmote(i, 'p3', 'star', (img) => {
        const sp = cv(buildSparkle());
        img.blit(sp, 0, 10);
        img.blit(sp, 3, 24);
      }),
      `${L.name} · 축하하기 (브이 + 별 + 반짝임)`,
      '원본 조합',
    );
  });
  save(CAT.char, 'char_shadow', cv(buildShadow()).pad(1), '캐릭터 발밑 그림자 (반투명)', '원본 추출');

  // 단체 구성
  save(CAT.char, 'char_group_3', groupImg([0, 7, 1], ['p1', 'p3', 'd0']), '3명 단체', '원본 조합');
  save(CAT.char, 'char_group_6', groupImg([0, 1, 2, 3, 4, 5], ['p1', 'p3', 'd0', 'e0', 'p2', 'p3']), '6명 단체 (한 줄)', '원본 조합');
  save(CAT.char, 'char_group_6b', groupImg([6, 7, 8, 9, 10, 11], ['p3', 'e0', 'p1', 'd0', 'p3', 'p2']), '6명 단체 (다른 캐릭터)', '원본 조합');
  save(CAT.char, 'char_group_12', groupImg([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], ['p1', 'p3', 'e0', 'd0', 'p2', 'p3'], 18, 2), '12명 단체 (두 줄, 모든 캐릭터)', '원본 조합');
  save(CAT.char, 'char_group_cheer_6', groupImg([3, 8, 0, 10, 5, 2], ['p3']), '6명 모두 브이 (축하)', '원본 조합');

  // 수뭉이
  const face = cv(buildFood('sumung'));
  save(CAT.char, 'char_sumung_face', face.pad(2), '수뭉이 기본 얼굴 (수뭉이빵 원본)', '원본 추출');
  {
    const img = new Img(26, 26);
    img.blit(face, 7, 12);
    img.blit(px(D.partyHat()), 10, 1);
    const sp = cv(buildSparkle());
    img.blit(sp, 1, 6);
    img.blit(sp, 20, 4);
    img.blit(px(D.confettiPiece(0, '#ff6b6b')), 3, 18);
    img.blit(px(D.confettiPiece(1, '#5aa3f0')), 21, 15);
    img.blit(px(D.confettiPiece(2, '#62c46a')), 20, 21);
    img.blit(px(D.confettiPiece(4, '#ffcb3d')), 2, 22);
    save(CAT.char, 'char_sumung_party', img.trim().pad(2), '수뭉이 축하 버전 (고깔모자·꽃가루)', '원본 조합');
  }
  // 숨은 캐릭터 실루엣
  [0, 7, 10].forEach((i, k) => {
    save(CAT.fx, `hs_silhouette_${k + 1}`, charPad(frame(i, 'd0').fill(rgba(INK))), '숨은 캐릭터 실루엣', '원본 조합');
  });
}

// ==================================================================== 03 공간 오브젝트

function hotSpringObject(): Img {
  const ground = cv(bakeGround());
  const z = WORLD.zones.find((zz) => zz.id === 'spring')!.rect;
  const x0 = z.x - 8;
  const y0 = z.y - 8;
  const w = z.w + 16;
  const h = z.h + 16;
  const W = WORLD.cols * TILE;
  const H = WORLD.rows * TILE;
  const ter = (x: number, y: number) => tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
  const isSpring = (x: number, y: number) => ter(x, y) === T.SPRING;
  const img = new Img(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = x0 + x;
      const gy = y0 + y;
      // 온천물까지의 거리 (원본과 같은 4방향 거리, 6px 이내 = 돌 테두리)
      let d = isSpring(gx, gy) && gy < H ? 0 : -1;
      for (let r = 1; r <= 6 && d < 0; r++)
        for (let k = -r; k <= r && d < 0; k++) {
          const j = r - Math.abs(k);
          if ((isSpring(gx + k, gy + j) && gy + j < H) || (isSpring(gx + k, gy - j) && gy - j < H)) d = r;
        }
      if (d < 0) continue;
      const inMap = gx >= 0 && gy >= 0 && gx < W && gy < H;
      if (d === 0 && inMap) {
        img.d[y * w + x] = ground.d[gy * W + gx];
        continue;
      }
      // 지도 가장자리(숲)에 가려 그려지지 않은 테두리는 같은 돌 무늬로 채워 닫음
      if (inMap && ter(gx, gy) !== T.WALL && gy < (WORLD.rows - 2) * TILE) img.d[y * w + x] = ground.d[gy * W + gx];
      else img.d[y * w + x] = rgba(d === 1 ? '#8c8175' : d === 6 ? '#867a6e' : rimStoneAt(gx, gy));
    }
  for (const p of WORLD.props) if ((p.kind === 'capyBath' || p.kind === 'capyRest' || p.kind === 'bucket') && p.x > x0 && p.x < x0 + w && p.y > y0 && p.y < y0 + h + 10) place(img, prop(p.kind), p.x - x0, p.y - y0, !!p.flip);
  return img.trim().pad(2);
}

function buildObjects() {
  const list: [string, Kind | 'swingSet' | 'campfireLit' | 'portalOpen', string][] = [
    ['object_foodtruck', 'foodtruck', '푸드트럭 (간판 글자 비움)'],
    ['object_bunting', 'bunting', '푸드트럭 삼각 깃발'],
    ['object_menu_sign', 'menuSign', '메뉴판 입간판 (글자 비움)'],
    ['object_picnic_table', 'picnic', '피크닉 테이블'],
    ['object_campfire', 'campfireLit', '모닥불 (불꽃 포함)'],
    ['object_campfire_base', 'campfire', '모닥불 받침 (불꽃 없이)'],
    ['object_log_bench', 'log', '통나무 벤치'],
    ['object_tent', 'tent', '텐트'],
    ['object_lantern', 'lantern', '랜턴'],
    ['object_board', 'board', '메시지 게시판 (머리판 글자 비움)'],
    ['object_tree_leafy', 'tree', '나무'],
    ['object_tree_round', 'treeRound', '동그란 나무'],
    ['object_tree_blossom', 'blossom', '벚꽃 나무'],
    ['object_bush', 'bush', '덤불'],
    ['object_fern', 'fern', '고사리 풀'],
    ['object_reed', 'reed', '갈대'],
    ['object_pot', 'pot', '화분'],
    ['object_swing', 'swingSet', '그네 (좌석·줄 포함)'],
    ['object_swing_frame', 'swing', '그네 틀만'],
    ['object_slide', 'slide', '미끄럼틀'],
    ['object_seesaw', 'seesaw', '시소'],
    ['object_spring_duck', 'spring', '스프링 오리'],
    ['object_sandcastle', 'castle', '모래성'],
    ['object_bench', 'bench', '벤치'],
    ['object_lamp', 'lamp', '가로등'],
    ['object_portal', 'portalOpen', '게임 포털 (소용돌이 포함)'],
    ['object_portal_frame', 'portal', '게임 포털 틀만'],
    ['object_crystal', 'crystal', '포털 수정'],
    ['object_barrier', 'barrier', '포털 앞 차단봉 (글자 비움)'],
    ['object_sign', 'sign', '나무 표지판 (글자 비움)'],
    ['object_banner', 'banner', '본관 현수막 (글자 비움)'],
    ['object_door', 'door', '본관 문'],
    ['object_bucket', 'bucket', '온천 나무 물통'],
  ];
  for (const [name, kind, use] of list) save(CAT.obj, name, objectImg(kind), use, kind === 'swingSet' || kind === 'campfireLit' || kind === 'portalOpen' ? '원본 조합' : '원본 추출');
  for (const f of [0, 1, 2, 3]) save(CAT.obj, `object_flame_${f + 1}`, flame(f).trim().pad(1), `모닥불 불꽃 애니메이션 ${f + 1}/4`, '원본 추출');
  for (const f of [0, 1]) {
    save(CAT.obj, `object_capybara_bath_${f + 1}`, prop('capyBath', f).trim().pad(2), `온천 속 카피바라 ${f + 1}/2`, '원본 추출');
    save(CAT.obj, `object_capybara_rest_${f + 1}`, prop('capyRest', f).trim().pad(2), `쉬는 카피바라 ${f + 1}/2`, '원본 추출');
  }
  save(CAT.obj, 'object_hot_spring', hotSpringObject(), '카피바라 온천 (온천물·돌 테두리·카피바라, 게임 지도에서 추출)', '원본 추출');
  // 음식 (수뭉이빵 포함)
  const FOOD_NAME: Record<string, string> = { sumung: '수뭉이빵', takoyaki: '타코야키', icecream: '아이스크림', hotdog: '핫도그', bungeo: '붕어빵', cotton: '솜사탕' };
  for (const id of FOOD_IDS) save(CAT.obj, `food_${id}`, cv(buildFood(id)).pad(2), `${FOOD_NAME[id]} (푸드트럭 메뉴)`, '원본 추출');
  // 꽃·풀 장식 (원본 잔디 장식과 같은 모양)
  PETALS.forEach((c, i) => {
    const pc = new PixelCanvas(12, 12);
    drawFlowers(pc, 5, 3, 0, 0, c);
    save(CAT.obj, `object_flowers_${i + 1}`, px(pc).trim().pad(1), '잔디 꽃 무리 (원본 꽃 모양)', '원본 조합');
  });
  {
    const pc = new PixelCanvas(10, 6);
    const x = 2;
    const y = 3;
    pc.set(x, y, P.grassDark);
    pc.set(x - 1, y - 1, P.grassDark);
    pc.set(x + 1, y - 1, P.grassDark);
    pc.set(x - 1, y - 2, P.grassLight);
    pc.set(x + 4, y + 2, P.grassDark);
    pc.set(x + 3, y + 1, P.grassDark);
    pc.set(x + 5, y + 1, P.grassDark);
    save(CAT.obj, 'object_grass_tuft', px(pc).trim().pad(1), '풀잎 (잔디 위 장식, 배경과 같은 색)', '원본 조합');
  }
}

// ==================================================================== 04 UI

function buildUI() {
  const sizes: [string, number, number][] = [
    ['s', 64, 32],
    ['m', 120, 60],
    ['l', 200, 100],
    ['xl', 300, 150],
    ['wide', 400, 56],
    ['tall', 120, 200],
  ];
  for (const [n, w, h] of sizes) save(CAT.ui, `ui_panel_basic_${n}_${w}x${h}`, px(D.panel(w, h)), `UI_01 기본 정보 패널 ${w}×${h}`, '신규 제작', [1, 4]);
  saveSvg(CAT.ui, 'ui_panel_basic_m_120x60', px(D.panel(120, 60)), 'UI_01 기본 정보 패널');
  const tints: [string, string][] = [
    ['cream', UI.cream],
    ['sky', UI.skyL],
    ['mint', UI.mintL],
    ['lemon', UI.lemonL],
    ['coral', UI.coralL],
    ['lavender', UI.lavL],
  ];
  for (const [n, c] of tints) save(CAT.ui, `ui_panel_${n}_120x60`, px(D.panel(120, 60, { bg: c })), `UI_01 색 패널 (${n})`, '신규 제작', [1, 4]);
  // 9-slice (Figma 에서 늘려 쓰기: 모서리는 그대로, 가장자리는 한 방향으로만 늘리기)
  {
    const base = px(D.panel(24, 24));
    const e = 6;
    const parts: [string, number, number, number, number][] = [
      ['tl', 0, 0, e, e],
      ['t', e, 0, 24 - e * 2, e],
      ['tr', 24 - e, 0, e, e],
      ['l', 0, e, e, 24 - e * 2],
      ['c', e, e, 24 - e * 2, 24 - e * 2],
      ['r', 24 - e, e, e, 24 - e * 2],
      ['bl', 0, 24 - e, e, e + 1],
      ['b', e, 24 - e, 24 - e * 2, e + 1],
      ['br', 24 - e, 24 - e, e, e + 1],
    ];
    for (const [n, x, y, w, h] of parts) save(CAT.ui, `ui_panel_basic_9slice_${n}`, base.crop(x, y, w, h), `UI_01 9분할 조각 (${n})`, '신규 제작', [1, 4]);
  }
  // 타이틀
  save(CAT.ui, 'ui_title_panel_l_340x64', px(D.titlePanel(340, 64)), 'UI_02 메인 타이틀 패널', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_title_panel_m_240x44', px(D.titlePanel(240, 44, UI.sky, UI.skyD)), 'UI_02 섹션 제목 패널 (하늘)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_title_panel_m_mint_240x44', px(D.titlePanel(240, 44, UI.mint, UI.mintD)), 'UI_02 섹션 제목 패널 (민트)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_title_ribbon_200x22', px(D.ribbonBanner(200, 22)), 'UI_02 리본형 제목 띠', '신규 제작', [1, 4]);
  saveSvg(CAT.ui, 'ui_title_panel_l_340x64', px(D.titlePanel(340, 64)), 'UI_02 메인 타이틀 패널');
  // 대화창
  save(CAT.ui, 'ui_dialog_l_420x80', px(D.dialogBox(420, 80)), 'UI_03 RPG 대화창 (큰)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_dialog_m_300x64', px(D.dialogBox(300, 64)), 'UI_03 RPG 대화창', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_dialog_nametab_64x12', px(D.nameTab(64)), 'UI_03 대화창 이름표 (대화창 왼쪽 위에 겹치기)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_dialog_portrait_40', px(D.portraitFrame(40)), 'UI_03 말하는 캐릭터 얼굴 틀', '신규 제작', [1, 4]);
  saveSvg(CAT.ui, 'ui_dialog_l_420x80', px(D.dialogBox(420, 80)), 'UI_03 RPG 대화창');
  // 버튼
  const states = ['default', 'selected', 'highlight', 'disabled'] as const;
  const bsizes: [string, number, number][] = [
    ['s', 40, 14],
    ['m', 72, 18],
    ['l', 120, 24],
  ];
  for (const st of states) for (const [n, w, h] of bsizes) save(CAT.ui, `ui_button_${st}_${n}_${w}x${h}`, px(D.button(w, h, st)), `UI_04 버튼 · ${{ default: '기본', selected: '선택', highlight: '강조', disabled: '비활성' }[st]} 상태`, '신규 제작', [1, 4]);
  // 퀴즈
  save(CAT.ui, 'ui_quiz_board_400x210', px(D.quizBoard(400, 210)), 'UI_05 퀴즈 문제판 (나무 액자)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_quiz_board_image_400x210', px(D.quizBoard(400, 210, true)), 'UI_05 퀴즈 문제판 (왼쪽 이미지 자리)', '신규 제작', [1, 4]);
  for (const [n, c] of [
    ['sky', UI.skyL],
    ['mint', UI.mintL],
    ['lemon', UI.lemonL],
    ['coral', UI.coralL],
  ] as const)
    save(CAT.ui, `ui_quiz_answer_${n}_180x30`, px(D.panel(180, 30, { bg: c })), `UI_05 보기 카드 (${n})`, '신규 제작', [1, 4]);
  // 타이머
  save(CAT.ui, 'ui_timer_clock', px(D.timerClock(44)), 'UI_06 시계형 타이머 (가운데 숫자 자리)', '신규 제작');
  save(CAT.ui, 'ui_timer_bar_frame_200x12', px(D.timerBar(200, 12)), 'UI_06 막대 타이머 틀', '신규 제작', [1, 4]);
  for (const [n, c, d] of [
    ['mint', UI.mint, UI.mintD],
    ['lemon', UI.lemon, UI.lemonD],
    ['coral', UI.coral, UI.coralD],
  ] as const)
    save(CAT.ui, `ui_timer_bar_fill_${n}_196x8`, px(D.timerFill(196, 8, c, d)), `UI_06 막대 타이머 채움 (${n}) — 가로로 줄여서 남은 시간 표현`, '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_timer_dot_on', px(D.timerFill(12, 12, UI.coral, UI.coralD)).pad(1), 'UI_06 5초 카운트 칸 (켜짐)', '신규 제작');
  save(CAT.ui, 'ui_timer_dot_off', px(D.timerFill(12, 12, UI.cream2, UI.line)).pad(1), 'UI_06 5초 카운트 칸 (꺼짐)', '신규 제작');
  // 점수판
  save(CAT.ui, 'ui_scoreboard_6teams', px(D.scoreBoard(240, 6)), 'UI_07 점수판 6팀 (배지 자리·점수 칸)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_scoreboard_3teams', px(D.scoreBoard(240, 3)), 'UI_07 점수판 3팀', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_score_row_228x18', px(D.scoreRow(228)), 'UI_07 점수판 한 줄 (자유 배치)', '신규 제작', [1, 4]);
  // 시상
  save(CAT.ui, 'ui_podium_1st', px(D.podiumBlock(52, 70, 'gold')), 'UI_08 시상대 1등 (금, 앞면 글자 자리)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_podium_2nd', px(D.podiumBlock(52, 52, 'silver')), 'UI_08 시상대 2등 (은)', '신규 제작', [1, 4]);
  save(CAT.ui, 'ui_podium_3rd', px(D.podiumBlock(52, 40, 'bronze')), 'UI_08 시상대 3등 (동)', '신규 제작', [1, 4]);
  for (const k of ['gold', 'silver', 'bronze'] as const) save(CAT.ui, `ui_medal_${k}`, px(D.medal(k)).pad(1), `UI_08 메달 (${k})`, '신규 제작');
  save(CAT.ui, 'ui_crown', px(D.crown()).pad(1), 'UI_08 왕관', '신규 제작');
  {
    const row = px(D.panel(200, 24));
    save(CAT.ui, 'ui_rank_row_200x24', row, 'UI_08 순위 한 줄 (메달은 따로 얹기)', '신규 제작', [1, 4]);
  }
  // 알림 팝업
  const pops: [string, string, string, () => InstanceType<typeof PixelCanvas>, string][] = [
    ['start', UI.sky, UI.skyD, () => D.playIcon(), '게임 시작'],
    ['correct', UI.mint, UI.mintD, () => D.correctMark(24), '정답'],
    ['wrong', UI.coral, UI.coralD, () => D.wrongMark(22), '오답'],
    ['congrats', UI.lemon, UI.lemonD, () => D.starIcon(9), '축하'],
    ['end', UI.lav, UI.lavD, () => D.flag(true), '이벤트 종료'],
  ];
  for (const [n, c, d, icon, label] of pops) {
    const body = D.panel(180, 96, { r: 4, shadow: 2 });
    D.rrect(body, 1, 1, 178, 22, 3, c);
    body.hline(3, 176, 2, mix(c, '#ffffff', 0.4));
    body.hline(1, 178, 23, d);
    const img = new Img(180, 112);
    img.blit(px(body), 0, 14);
    const ic = px(icon()).trim();
    img.blit(ic, Math.round(90 - ic.w / 2), Math.max(0, 22 - ic.h));
    save(CAT.ui, `ui_popup_${n}`, img.trim().pad(1), `UI_09 알림 팝업 · ${label} (위 띠·아래 글자 자리 비움)`, '신규 제작', [1, 4]);
  }
  // 팀 배지
  const symbols = ['star', 'heart', 'moon', 'flower', 'bolt', 'clover', 'drop', 'leaf', 'sun'];
  for (const t of TEAMS) {
    save(CAT.ui, `ui_team_badge_original_${t.key}`, cv(buildTeamBadge(t.id)), `UI_10 게임 속 팀 배지 원본 (${t.defaultName})`, '원본 추출');
    for (const s of symbols) {
      save(CAT.ui, `ui_badge_${t.key}_${s}`, px(D.teamBadge(t.color, s)), `UI_10 원형 배지 ${t.defaultName}·${s}`, '신규 제작');
      save(CAT.ui, `ui_badge_big_${t.key}_${s}`, px(D.teamBadgeBig(t.color, t.dark, s)), `UI_10 큰 사각 배지 ${t.defaultName}·${s}`, '신규 제작');
    }
  }
}

// ==================================================================== 05 게임 이펙트

function buildEffects() {
  save(CAT.fx, 'effect_round_banner', px(D.ribbonBanner(180, 24)), 'ROUND 시작 리본 (가운데 글자 자리)', '신규 제작', [1, 4]);
  save(CAT.fx, 'effect_round_banner_sky', px(D.ribbonBanner(180, 24, UI.sky, UI.skyD)), 'ROUND 시작 리본 (하늘)', '신규 제작', [1, 4]);
  {
    const img = new Img(72, 72);
    const pc = new PixelCanvas(64, 64);
    pc.circle(32, 32, 31, INK);
    pc.circle(32, 32, 30, UI.lemon);
    pc.circle(32, 32, 26, INK);
    pc.circle(32, 32, 25, '#ffffff');
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      pc.set(Math.round(32 + Math.cos(a) * 28), Math.round(32 + Math.sin(a) * 28), k % 2 ? UI.lemonD : '#fff6c8');
    }
    img.blit(px(pc), 4, 4);
    const tw = px(D.twinkle(7));
    img.blit(tw, 0, 6);
    img.blit(tw, 64, 58);
    save(CAT.fx, 'effect_countdown_frame', img, '카운트다운 프레임 (가운데 숫자 자리)', '신규 제작');
  }
  const withTwinkles = (base: Img, n = 3) => {
    const img = base.pad(6);
    const tw = px(D.twinkle(7));
    const sp = cv(buildSparkle());
    img.blit(tw, 0, 2);
    img.blit(sp, img.w - 6, 4);
    if (n > 2) img.blit(tw, img.w - 8, img.h - 9);
    return img;
  };
  save(CAT.fx, 'effect_correct', withTwinkles(px(D.correctMark(44))), '정답 이펙트 (O + 반짝임)', '신규 제작');
  {
    const img = px(D.wrongMark(40)).pad(6);
    const sw = cv(buildSweat());
    img.blit(sw, 2, 4);
    img.blit(sw, img.w - 8, 8);
    save(CAT.fx, 'effect_wrong', img, '오답 이펙트 (X + 땀방울)', '신규 제작');
  }
  {
    const img = px(D.burst(48, UI.lemon, '#ffffff', 12));
    const st = px(D.starIcon(9));
    img.blit(st, Math.round(24 - st.w / 2), Math.round(24 - st.h / 2));
    save(CAT.fx, 'effect_score', img, '점수 획득 이펙트 (별 + 빛살)', '신규 제작');
  }
  {
    const img = new Img(34, 40);
    img.blit(px(D.rosette(UI.lemon, UI.lemonD)), 6, 10);
    img.blit(px(D.crown()), 8, 0);
    save(CAT.fx, 'effect_victory_badge', img.trim().pad(1), '승리 배지 (왕관 + 로제트)', '신규 제작');
  }
  {
    const img = new Img(44, 30);
    img.blit(px(D.flag(true)), 2, 4);
    img.blit(px(D.flag(true)).flipX(), 22, 4);
    confettiScatter(img, 9, () => true, 10);
    save(CAT.fx, 'effect_game_end', img.trim().pad(1), '게임 종료 장식 (체크 깃발 + 꽃가루)', '신규 제작');
  }
  save(CAT.fx, 'effect_flag_start', px(D.flag(false, UI.mint)).pad(1), '시작 깃발', '신규 제작');
  save(CAT.fx, 'effect_play', px(D.playIcon()).pad(1), '시작 아이콘 (▶)', '신규 제작');
  save(CAT.fx, 'effect_impact', cv(buildImpact()).pad(1), '부딪힘·뿅! 이펙트 (게임 원본)', '원본 추출');
  save(CAT.fx, 'effect_star_original', cv(buildStar()).pad(1), '별 (게임 원본)', '원본 추출');
  save(CAT.fx, 'effect_heart_original', cv(buildHeart()).pad(1), '하트 (게임 원본)', '원본 추출');
  save(CAT.fx, 'effect_crumb_original', cv(buildCrumb()).pad(1), '부스러기 (게임 원본)', '원본 추출');
  // 숨바꼭질
  save(CAT.fx, 'hs_title_frame', px(D.hideSeekFrame(240, 40)), '학회장을 찾아라! 제목 장식 (블라인드 줄무늬·엿보는 눈, 가운데 글자 자리)', '신규 제작', [1, 4]);
  save(CAT.fx, 'hs_question', px(D.questionIcon()), '물음표 아이콘', '신규 제작');
  save(CAT.fx, 'hs_question_bubble', cv(buildEmote('question')).trim().pad(1), '물음표 말풍선 (게임 원본 이모티콘)', '원본 추출');
  save(CAT.fx, 'hs_magnifier', px(D.magnifier()).pad(1), '돋보기 아이콘', '신규 제작');
  save(CAT.fx, 'hs_exclaim', px(D.exclaimIcon()).pad(1), '느낌표 아이콘 (찾았다!! 연출)', '신규 제작');
  save(CAT.fx, 'hs_found_burst', px(D.burst(64, UI.lemon, '#ffffff', 16)), '발견 성공 빛살', '신규 제작');
  save(CAT.fx, 'hs_found_shout_120x60', px(D.shoutBubble(120, 60)), "'찾았다!!' 외침 말풍선 (가운데 글자 자리)", '신규 제작', [1, 4]);
  save(CAT.fx, 'hs_found_shout_lemon_120x60', px(D.shoutBubble(120, 60, UI.lemon)), "'찾았다!!' 외침 말풍선 (노랑)", '신규 제작', [1, 4]);
  {
    const pc = new PixelCanvas(20, 8);
    for (const ex of [1, 12]) {
      pc.rect(ex, 1, 6, 6, '#ffffff');
      pc.rect(ex + 2, 3, 3, 3, UI.plum);
    }
    save(CAT.fx, 'hs_peek_eyes', px(pc), '엿보는 눈 (블라인드 화면과 같은 모양)', '원본 조합');
  }
}

// ==================================================================== 06 상품

function buildPrizes() {
  save(CAT.prize, 'prize_giftbox_coral', px(D.giftBox()).pad(1), '선물 상자 (코랄)', '신규 제작');
  save(CAT.prize, 'prize_giftbox_mint', px(D.giftBox(UI.mint, UI.mintD, UI.coral, UI.coralD)).pad(1), '선물 상자 (민트)', '신규 제작');
  save(CAT.prize, 'prize_giftbox_lavender', px(D.giftBox(UI.lav, UI.lavD, UI.lemon, UI.lemonD)).pad(1), '선물 상자 (라벤더)', '신규 제작');
  save(CAT.prize, 'prize_voucher_mint', px(D.voucher()).pad(1), '상품권 프레임 (중립적인 티켓 모양, 글자·로고 자리 비움)', '신규 제작');
  save(CAT.prize, 'prize_voucher_coral', px(D.voucher(72, 36, UI.coralL, UI.coral)).pad(1), '상품권 프레임 (코랄)', '신규 제작');
  save(CAT.prize, 'prize_beam_projector', px(D.projector()).pad(1), '빔프로젝터 (일반 아이콘)', '신규 제작');
  save(CAT.prize, 'prize_squishy_set', px(D.squishySet()).pad(1), '말랑이 세트 (일반 아이콘)', '신규 제작');
  [
    ['pink', '#ffd0dc', '#f4a9bb'],
    ['mint', '#dcf6eb', '#a9e3c9'],
    ['yellow', '#fff1c4', '#f3d68a'],
  ].forEach(([n, c, d]) => save(CAT.prize, `prize_squishy_${n}`, px(D.squishy(c, d)).pad(1), `말랑이 1개 (${n})`, '신규 제작'));
  save(CAT.prize, 'prize_fish_warmer', px(D.fishWarmer()).pad(1), '붕어빵 보조배터리 손난로 (일반 아이콘)', '신규 제작');
  save(CAT.prize, 'prize_winner_rosette', px(D.rosette()).pad(1), '당첨 배지 (로제트)', '신규 제작');
  save(CAT.prize, 'prize_winner_rosette_gold', px(D.rosette(UI.lemon, UI.lemonD)).pad(1), '당첨 배지 (금색)', '신규 제작');
  {
    const img = new Img(64, 64);
    confettiScatter(img, 21, () => true, 26);
    for (const [x, y, r] of [
      [26, 24, 5],
      [8, 10, 3],
      [48, 42, 3],
    ])
      img.blit(px(D.starIcon(r)), x, y);
    save(CAT.prize, 'prize_stars_confetti', img, '별과 종이 폭죽 (추첨 화면 장식)', '신규 제작');
  }
}

// ==================================================================== 07 장식

function buildDecorations() {
  const starColors: [string, string, string][] = [
    ['yellow', UI.lemon, UI.lemonD],
    ['pink', '#ffa9c6', '#ff7aa6'],
    ['sky', UI.sky, UI.skyD],
    ['white', '#ffffff', '#e9ecf5'],
  ];
  for (const [n, c, d] of starColors)
    for (const [s, r] of [
      ['s', 2.5],
      ['m', 4],
      ['l', 6.5],
    ] as const)
      save(CAT.deco, `deco_star_${n}_${s}`, px(D.starIcon(r, c, d)), `픽셀 별 (${n}, ${s})`, '신규 제작');
  for (const [s, size] of [
    ['s', 5],
    ['m', 7],
    ['l', 11],
  ] as const)
    save(CAT.deco, `deco_twinkle_${s}`, px(D.twinkle(size)).pad(1), `반짝임 (${s})`, '신규 제작');
  save(CAT.deco, 'deco_sparkle_original', cv(buildSparkle()).pad(1), '반짝임 (게임 원본)', '원본 추출');
  save(CAT.deco, 'deco_heart_s', px(D.heartIcon(1)), '하트 (작은, 게임 이모티콘과 같은 모양)', '원본 조합');
  save(CAT.deco, 'deco_heart_l', px(D.heartIcon(2)), '하트 (큰)', '신규 제작');
  save(CAT.deco, 'deco_heart_l_coral', px(D.heartIcon(2, UI.coral, '#ffd0c4')), '하트 (큰, 코랄)', '신규 제작');
  D.CONFETTI_COLORS.forEach((c, i) => save(CAT.deco, `deco_confetti_${i + 1}`, px(D.confettiPiece(i, c)).pad(1), '종이 꽃가루 조각', '신규 제작'));
  {
    const img = new Img(BW, BH);
    confettiScatter(img, 33, (x, y) => !inEllipse(240, 135, 190, 105)(x, y), 120);
    for (const [x, y, r] of [
      [18, 18, 4],
      [450, 22, 4],
      [30, 236, 3],
      [440, 230, 3],
    ])
      img.blit(px(D.starIcon(r)), x, y);
    save(CAT.deco, 'deco_confetti_overlay_1920x1080', img, '꽃가루 오버레이 (가장자리만, 아무 배경 위에 얹기)', '신규 제작', [1, 4]);
  }
  save(CAT.deco, 'deco_ribbon_coral', px(D.bow()).pad(1), '리본 매듭 (코랄)', '신규 제작');
  save(CAT.deco, 'deco_ribbon_sky', px(D.bow(UI.sky, UI.skyD)).pad(1), '리본 매듭 (하늘)', '신규 제작');
  for (const d of ['right', 'left', 'up', 'down'] as const) save(CAT.deco, `deco_arrow_${d}`, px(D.arrow(d)).pad(1), `화살표 (${d})`, '신규 제작');
  save(CAT.deco, 'deco_arrow_right_mint', px(D.arrow('right', UI.mint)).pad(1), '화살표 (민트)', '신규 제작');
  save(CAT.deco, 'deco_bubble_s_32x16', px(D.speechBubble(32, 16)).pad(1), '작은 말풍선 (글자 자리)', '신규 제작', [1, 4]);
  save(CAT.deco, 'deco_bubble_m_64x24', px(D.speechBubble(64, 24)).pad(1), '말풍선 (글자 자리)', '신규 제작', [1, 4]);
  save(CAT.deco, 'deco_bubble_l_120x36', px(D.speechBubble(120, 36, false)).pad(1), '큰 말풍선 (꼬리 오른쪽)', '신규 제작', [1, 4]);
  for (const e of EMOTES) save(CAT.deco, `deco_emote_${e}`, cv(buildEmote(e)).trim().pad(1), `이모티콘 말풍선 (게임 원본: ${e})`, '원본 추출');
  save(CAT.deco, 'deco_garland_250', px(D.garland(250, 10)), '가랜드 (삼각 깃발 줄)', '신규 제작', [1, 4]);
  save(CAT.deco, 'deco_bunting_original', prop('bunting').trim().pad(1), '삼각 깃발 (게임 원본, 푸드트럭)', '원본 추출');
  save(CAT.deco, 'deco_paper_plane', cv(buildPlane()).pad(1), '종이비행기 (게임 원본)', '원본 추출');
  save(CAT.deco, 'deco_water_balloon', cv(buildBalloon()).pad(1), '물풍선 (게임 원본)', '원본 추출');
  save(CAT.deco, 'deco_toy_hammer', cv(buildHammer()).pad(1), '뿅망치 (게임 원본)', '원본 추출');
}

// ==================================================================== 08 시안 (조합 예시)

/** 글자 자리 표시 (실제 글자 대신 연한 막대) */
function placeholder(img: Img, x: number, y: number, w: number, h: number, c = '#3d304733') {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!((j === 0 || j === h - 1) && (i === 0 || i === w - 1))) img.over(x + i, y + j, rgba(c));
}
const center = (img: Img, src: Img, cy: number) => img.blit(src, Math.round((img.w - src.w) / 2), Math.round(cy - src.h / 2));

function buildPreviews() {
  // 1) 메인 타이틀 — 큰 픽셀(240×135 × 8): 배경·패널·캐릭터 모두 같은 픽셀 크기
  {
    const img = px(grassBg(2, 0.6, inEllipse(120, 60, 100, 40), SW, SH, true));
    const g = px(D.garland(130, 6));
    img.blit(g, -6, 1);
    img.blit(g, 116, 1);
    const title = px(D.titlePanel(150, 40));
    center(img, title, 50);
    placeholder(img, 120 - 55, 44, 110, 8);
    placeholder(img, 120 - 35, 57, 70, 4, '#3d304722');
    const group = groupImg([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], ['p1', 'p3', 'e0', 'd0', 'p2', 'p3'], 18, 2);
    center(img, group, 106);
    const face = cv(buildFood('sumung'));
    img.blit(px(D.partyHat()), 208, 18);
    img.blit(face, 206, 27);
    for (const [x, y, r] of [
      [14, 30, 3],
      [24, 96, 2.5],
      [212, 92, 2.5],
    ])
      img.blit(px(D.starIcon(r)), x, y);
    place(img, prop('bush'), 12, 134);
    place(img, prop('bush'), 228, 134, true);
    save(CAT.preview, 'preview_01_main_title', img, '시안: 메인 타이틀 (큰 픽셀 8배, 회색 막대 = 글자 자리)', '원본 조합', [8]);
  }
  // 2) 레크리에이션 퀴즈
  {
    const img = px(grassBg(4, 0.45, (x, y) => x > 60 && x < 420 && y > 30 && y < 240));
    const rib = px(D.ribbonBanner(150, 20, UI.sky, UI.skyD));
    center(img, rib, 22);
    placeholder(img, 240 - 40, 15, 80, 8, '#ffffff88');
    const board = px(D.quizBoard(330, 130, true));
    center(img, board, 108);
    placeholder(img, 240 - 165 + 6 + 4 + 118 + 12, 70, 150, 12);
    placeholder(img, 240 - 165 + 6 + 4 + 118 + 12, 92, 120, 8, '#3d304722');
    placeholder(img, 240 - 165 + 6 + 4 + 118 + 12, 106, 136, 8, '#3d304722');
    const tm = px(D.timerClock(40));
    img.blit(tm, 412, 46);
    const cols: [string, string][] = [
      ['sky', UI.skyL],
      ['mint', UI.mintL],
      ['lemon', UI.lemonL],
      ['coral', UI.coralL],
    ];
    cols.forEach(([, c], i) => {
      const p = px(D.panel(158, 22, { bg: c }));
      const x = i % 2 ? 244 : 78;
      const y = 184 + Math.floor(i / 2) * 30;
      img.blit(p, x, y);
      img.blit(px(D.teamBadge(TEAMS[i].color, ['star', 'heart', 'moon', 'flower'][i])), x + 4, y + 4);
      placeholder(img, x + 22, y + 8, 90, 6, '#3d304722');
    });
    img.blit(charPad(frame(3, 'p4')), 22, 200);
    img.blit(charPad(frame(9, 's0').flipX()), 432, 200);
    save(CAT.preview, 'preview_02_quiz', img, '시안: 레크리에이션 퀴즈', '원본 조합', [4]);
  }
  // 3) 시상식 — 큰 픽셀(240×135 × 8)
  {
    const img = awardsSmall();
    const title = px(D.titlePanel(116, 24, UI.lemon, UI.lemonD));
    center(img, title, 22);
    placeholder(img, 120 - 40, 22, 80, 6);
    const base = 128;
    const blocks: [keyof typeof D.MEDAL, number, number, number, string][] = [
      ['silver', 86, 30, 1, 'e0'],
      ['gold', 120, 42, 7, 'p3'],
      ['bronze', 154, 22, 10, 'p1'],
    ];
    const shadow = cv(buildShadow());
    for (const [k, cx, h, look, f] of blocks) {
      const b = px(D.podiumBlock(30, h, k));
      img.blit(b, cx - 15, base - b.h);
      const top = base - b.h;
      img.blit(shadow, cx - 7, top - 4);
      img.blit(frame(look, f), cx - 8, top - 24);
    }
    img.blit(px(D.crown()), 120 - 9, base - 44 - 36);
    img.blit(px(D.voucher(44, 22)), 18, 92);
    img.blit(px(D.giftBox()), 196, 98);
    save(CAT.preview, 'preview_03_awards', img, '시안: 시상식 (큰 픽셀 8배)', '원본 조합', [8]);
  }
}

// ==================================================================== 00 스타일 가이드

function buildStyleGuide() {
  const groups: [string, [string, string][]][] = [
    ['UI (웹 화면)', Object.entries(UI)],
    ['게임 팔레트', Object.entries(P).filter(([k]) => k !== 'shadow') as [string, string][]],
    ['팀 컬러', TEAMS.map((t) => [t.key, t.color] as [string, string])],
  ];
  // 색 견본 (글자 없음, 순서는 STYLE_GUIDE.md 표와 같음)
  const rowsN = groups.reduce((n, [, l]) => n + Math.ceil(l.length / 12), 0);
  const img = new Img(12 * 14 + 2, rowsN * 14 + groups.length * 6 + 2);
  let y = 2;
  for (const [, list] of groups) {
    list.forEach(([, c], i) => {
      const x = 2 + (i % 12) * 14;
      const yy = y + Math.floor(i / 12) * 14;
      for (let j = 0; j < 12; j++) for (let k = 0; k < 12; k++) img.set(x + k, yy + j, j === 0 || j === 11 || k === 0 || k === 11 ? rgba(INK) : rgba(c));
    });
    y += Math.ceil(list.length / 12) * 14 + 6;
  }
  save(CAT.style, 'palette_swatches', img, '색 견본 (순서는 STYLE_GUIDE.md 표 참고)', '신규 제작', [1, 4]);

  const md = `# 짝선짝후 2026 PAIR — 픽셀 아트 스타일 가이드

아지트 게임 그래픽은 **외부 이미지 없이 코드로 그린 픽셀 아트**입니다 (\`client/src/game/art/\`).
이 패키지의 원본 에셋은 그 코드를 그대로 실행해서 뽑았고, 새로 만든 에셋도 같은 도구·팔레트·규칙으로 그렸습니다.

## 1. 해상도와 픽셀 크기

| 항목 | 값 |
|---|---|
| 원본 1픽셀 | 게임 화면에서 휴대폰 2~3배, PC 3~4배로 확대 |
| **PPT 기준** | **1920×1080 = 원본 480×270 을 4배** → 원본 1픽셀 = 4px |
| 맵 타일 | 16×16 px (원본) |
| 캐릭터 한 칸 | 16×26 px (발 위치 y=24), 머리 2등신 |
| 음식·아이콘 | 12×12 px 안팎 |
| 외곽선 | 원본 1px (4배에서 4px) |

**Figma 에서 크기를 바꿀 때는 반드시 정수배(×1, ×2, ×3…)로만.** 4x 폴더 파일을 100% 로 놓으면 배경과 픽셀 크기가 같아집니다.
확대 설정은 Figma 이미지 채우기의 *Image smoothing* 을 끄거나(Pixelated) 4x/8x 파일을 그대로 쓰세요.
**한 슬라이드 안에서는 한 배율만** 쓰세요. 그래야 픽셀 크기가 모두 같아 보입니다.

| 슬라이드 종류 | 배경 | 에셋 폴더 | 예시 |
|---|---|---|---|
| 정보가 많은 화면 (타임테이블·규칙·퀴즈·점수) | \`bg_*_1920x1080\` (4x 폴더) | **4x** | preview_02_quiz |
| 크게 보여주는 화면 (타이틀·시상식·이벤트 시작) | \`bg_*_bigpixel_1920x1080\` (8x 폴더) | **8x** | preview_01 · preview_03 |

## 2. 색상 팔레트

밝고 부드러운 파스텔: 크림 바탕 · 연두 잔디 · 하늘 · 코랄 · 레몬 · 라벤더. 검정 대신 **보랏빛 잉크(#3d3047 / #4a3a52)** 로 외곽선을 씁니다.

${groups.map(([title, list]) => `### ${title}\n\n| 이름 | 색 |\n|---|---|\n${list.map(([k, c]) => `| ${k} | \`${c}\` |`).join('\n')}`).join('\n\n')}

## 3. 캐릭터

- 16×26 px, 큰 머리(머리 ≈ 전체의 절반) + 작은 몸, 2등신 치비 비율
- 1px 잉크 외곽선, 볼 터치(분홍 점), 눈은 1~2px
- 12종: 새내기·후드티·냥냥 비니·개굴이·공부벌레·잠꾸러기·과대표·버섯돌이·쿨한 선배·곰돌이 탈·토끼 후드·디자이너 (\`a01\`~\`a12\`)
- 동작은 게임에 있는 프레임만 사용 (서기·걷기·앉기·손 흔들기·브이·놀람·웃음·춤). 박수·하트·축하는 원본 이모티콘 말풍선을 머리 위에 얹어 표현

## 4. 자연 오브젝트

- 잔디: 4단계 연두(\`grassLight · grass · grass2 · grassDark\`)를 부드러운 노이즈로 섞고, 16px 칸마다 풀잎 V·꽃(5색 꽃잎 + 노랑/코랄 꽃심)·작은 돌
- 나무: 둥근 덩어리 잎 3~4톤 + 진한 초록 외곽선(\`#3f5a48\`), 갈색 줄기
- 흙길·모래: 단색 바탕에 밝은/어두운 점을 흩뿌림, 재질 경계에 1px 진한 테두리 + 아래쪽 풀 그늘
- 광장: 8px 벽돌을 반 칸씩 엇갈림, 줄눈 \`#e5d3bb\`, 가운데 **맞물린 두 고리(코랄·하늘 = 선배·후배)**
- 나무 데크: 5px 판자, 26px 마다 이음매

## 5. UI 패널 (웹 화면과 같은 규칙)

| 요소 | 웹 화면 (CSS) | PPT 픽셀 에셋 (4배 기준) |
|---|---|---|
| 바탕 | \`#fffaf0\` (paper) / \`#fff6e4\` (cream) | 같음 |
| 외곽선 | 3px \`#3d3047\` | 원본 1px = 4px |
| 그림자 | 아래로 4px, 흐림 없음 (\`0 4px 0 #3d3047\`) | 원본 1~2px 아래 단단한 그림자 |
| 모서리 | 둥근 10~16px | 계단식 둥근 모서리 (원본 3~4px) |
| 강조 | 코랄 \`#ff8f7a\` 바탕 + 흰 글자 + 진한 코랄 글자 그림자 | ui_button_highlight |
| 선택 | 잉크 바탕 + 흰 글자 | ui_button_selected |
| 비활성 | 크림2 바탕, 연한 테두리, 그림자 없음 | ui_button_disabled |

Figma 에서 패널을 직접 만들 때(4배 기준): 사각형 · 채우기 \`#fffaf0\` · 선 4px \`#3d3047\`(안쪽) · 모서리 12~16 · 드롭 섀도 X0 Y4~8 Blur0 \`#3d3047\` 100%.
길이를 자유롭게 바꾸려면 \`ui_panel_basic_9slice_*\` 조각을 쓰세요 (모서리 4개는 그대로, 가장자리는 한 방향으로만 늘리기 — 픽셀이 한 방향으로 늘어나도 또렷함).

## 6. 아이콘

- 7×7 ~ 20×20 px, 1px 잉크 외곽선, 2~3톤(밝은 면 1px 하이라이트 + 아래쪽 진한 면)
- 팀 심볼 7×7: 별·물방울·잎·해·달·하트 (+ 이번에 꽃·번개·클로버 추가)

## 7. 타이포그래피

- 제목·버튼·숫자: **Galmuri11 Bold** / 본문 픽셀 글자: **Galmuri11** (SIL 오픈 폰트, 무료) — https://github.com/quiple/galmuri
- 긴 설명 문장: **Pretendard**
- 갈무리는 12px 의 정수배(24·36·48·60·72px)로 쓰면 가장 또렷합니다
- 에셋 이미지에는 글자를 넣지 않았습니다. 간판·게시판 머리판·현수막 글자 자리도 비워 두었어요.

## 8. 파일 규칙

- \`1x/\` 원본 픽셀 · \`4x/\` 1920×1080 슬라이드 기준 · \`8x/\` 크게 강조할 때 (모두 최근접 정수배 확대, 흐림 없음)
- 모든 개별 에셋은 투명 배경 PNG (배경 \`bg_*\` 와 타일 \`tile_*\` 만 불투명)
- \`svg/\` 의 SVG 는 픽셀을 사각형으로 옮긴 것이라 Figma 에서 벡터로 색을 바꿀 수 있어요
- 전체 목록과 용도: \`ASSET_LIST.md\` / \`asset_list.csv\`
`;
  writeFile(path.join(ROOT, CAT.style, 'STYLE_GUIDE.md'), md);
}

// ==================================================================== 실행

buildBackgrounds();
buildCharacters();
buildObjects();
buildUI();
buildEffects();
buildPrizes();
buildDecorations();
buildPreviews();
buildStyleGuide();

// 목록
const csv = ['파일,분류,용도,원본 크기(px),제공 배율,출처', ...entries.map((e) => [e.file, e.cat, e.use, `${e.w}x${e.h}`, e.scales.map((k) => `${k}x`).join(' '), e.source].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
writeFile(path.join(ROOT, 'asset_list.csv'), '﻿' + csv.join('\r\n'));
const byCat = new Map<string, Entry[]>();
for (const e of entries) byCat.set(e.cat, [...(byCat.get(e.cat) ?? []), e]);
const listMd = [
  '# PAIR PPT 에셋 목록',
  '',
  `총 ${entries.length}종 · 각 에셋은 \`1x\`(원본) · \`4x\`(1920×1080 기준) · \`8x\` 폴더에 같은 이름으로 들어 있어요. (배경·큰 패널은 1x·4x)`,
  '',
  '| 출처 | 뜻 |',
  '|---|---|',
  '| 원본 추출 | 게임 그래픽 코드를 그대로 실행해서 뽑음 (모양 그대로) |',
  '| 원본 조합 | 원본 그래픽을 배치·조합 (예: 캐릭터 + 원본 이모티콘) |',
  '| 신규 제작 | 게임에 없던 요소를 같은 팔레트·픽셀 규칙으로 새로 그림 |',
  '',
  ...[...byCat.entries()].flatMap(([cat, list]) => [
    `## ${cat} (${list.length})`,
    '',
    '| 파일 | 용도 | 원본 크기 | 4배 크기 | 출처 |',
    '|---|---|---|---|---|',
    ...list.map((e) => `| \`${e.file.split('/').pop()}\` | ${e.use} | ${e.w}×${e.h} | ${e.scales.includes(4) ? `${e.w * 4}×${e.h * 4}` : '-'} | ${e.source} |`),
    '',
  ]),
].join('\n');
writeFile(path.join(ROOT, 'ASSET_LIST.md'), listMd);
writeFile(
  path.join(ROOT, 'README.md'),
  `# PAIR_PPT_ASSETS\n\n짝선짝후 아지트 게임 그래픽으로 만든 행사 PPT 에셋 패키지입니다.\n\n- 시작은 \`08_PREVIEW\`(조합 예시) → \`00_STYLE_GUIDE/STYLE_GUIDE.md\` → \`ASSET_LIST.md\`\n- Figma 에는 **4x 폴더** 파일을 끌어다 놓으면 1920×1080 슬라이드와 픽셀 크기가 맞아요.\n- 다시 만들기: 프로젝트 폴더에서 \`npx tsx tools/ppt-assets/build.ts\`\n- 과제 괴물 레이드 에셋은 3차 개발 때 같은 생성기에 추가할 예정이에요.\n`,
);
console.log(`에셋 ${entries.length}종 생성 → ${ROOT}`);
