/**
 * 픽셀 캐릭터 생성기.
 * 외형(8종) × 옷 색상(8종) 조합으로 스프라이트 시트를 즉석에서 그립니다.
 *
 * 시트 구성: 가로 6프레임 [대기, 눈깜빡, 걷기1~4] × 세로 3방향 [아래, 위, 옆(왼쪽)]
 * 오른쪽은 옆 방향을 좌우 반전해서 사용합니다.
 */
import { COLOR_COUNT, LOOK_COUNT } from '../../../../shared/constants';
import { mix, PixelCanvas } from './pixel';

export const FRAME_W = 16;
export const FRAME_H = 24;
/** 스프라이트 원점 y (발바닥 위치 비율) */
export const ORIGIN_Y = 22 / FRAME_H;
export const SHEET_COLS = 6;
export const DIR_ROWS = ['d', 'u', 's'] as const;

type Style = 'bob' | 'pony' | 'cap' | 'cat' | 'sprout' | 'glasses' | 'beanie' | 'buns';

export interface LookDef {
  name: string;
  style: Style;
  hair: string;
  skin: 0 | 1 | 2;
  pants: string;
  shoes: string;
}

export const LOOKS: LookDef[] = [
  { name: '단발', style: 'bob', hair: '#8a5a44', skin: 0, pants: '#5f6b94', shoes: '#fdf8ef' },
  { name: '포니테일', style: 'pony', hair: '#4f3b4a', skin: 1, pants: '#6a5f86', shoes: '#fdf8ef' },
  { name: '캡모자', style: 'cap', hair: '#5b4136', skin: 2, pants: '#4f5a7c', shoes: '#fdf8ef' },
  { name: '고양이귀', style: 'cat', hair: '#e2b873', skin: 0, pants: '#6b6884', shoes: '#fdf8ef' },
  { name: '새싹', style: 'sprout', hair: '#7a5238', skin: 1, pants: '#5d7a6e', shoes: '#fdf8ef' },
  { name: '동글 안경', style: 'glasses', hair: '#3f3548', skin: 0, pants: '#59617f', shoes: '#fdf8ef' },
  { name: '털모자', style: 'beanie', hair: '#a8654a', skin: 2, pants: '#665a7a', shoes: '#fdf8ef' },
  { name: '양갈래', style: 'buns', hair: '#c97b52', skin: 0, pants: '#5f6b94', shoes: '#fdf8ef' },
];

export const COLORS: { name: string; base: string; dark: string }[] = [
  { name: '코랄', base: '#ff8f7a', dark: '#e0705e' },
  { name: '민트', base: '#7fd8b6', dark: '#5cbb98' },
  { name: '하늘', base: '#86c8f2', dark: '#62a8d8' },
  { name: '레몬', base: '#ffd66e', dark: '#e8b64a' },
  { name: '라벤더', base: '#b9a3ef', dark: '#957bd8' },
  { name: '체리', base: '#ffa1bf', dark: '#e57f9f' },
  { name: '크림', base: '#fff1d6', dark: '#e6cfa8' },
  { name: '네이비', base: '#5f6fa3', dark: '#4a5785' },
];

if (LOOKS.length !== LOOK_COUNT || COLORS.length !== COLOR_COUNT) {
  console.warn('캐릭터 외형/색상 개수가 shared/constants.ts 와 다릅니다.');
}

const SKINS = [
  { base: '#ffe1c8', dark: '#f3c3a3' },
  { base: '#f7cfab', dark: '#e6b28b' },
  { base: '#e9bb93', dark: '#d39f77' },
];

const OUTLINE = '#3d3047';
const EYE = '#3b2e44';
const BLUSH = '#ff9f9a';

type DirKey = (typeof DIR_ROWS)[number];

function paintFrame(pc: PixelCanvas, look: LookDef, color: (typeof COLORS)[number], dir: DirKey, frame: number) {
  const walk = frame >= 2 ? frame - 2 : -1;
  const bob = walk === 0 || walk === 2 ? 1 : 0;
  const blink = frame === 1;
  const skin = SKINS[look.skin];
  const hair = look.hair;
  const hairDark = mix(look.hair, '#2a1f30', 0.28);
  const hairLight = mix(look.hair, '#ffffff', 0.22);
  const shirt = color.base;
  const shirtDark = color.dark;
  const shirtLight = mix(color.base, '#ffffff', 0.35);
  const pants = look.pants;
  const pantsDark = mix(look.pants, '#20182a', 0.25);
  const shoe = look.shoes;

  const HY = 4 + bob; // 머리 시작 y
  const BY = 14 + bob; // 몸 시작 y
  const H = (x: number, r: number, c: string) => pc.set(x, HY + r, c);
  const headRow = (r: number): [number, number] | null =>
    r === 0 ? [4, 11] : r === 1 ? [3, 12] : r >= 2 && r <= 8 ? [2, 13] : r === 9 ? [3, 12] : null;
  const hairRow = (r: number, x0: number, x1: number, c = hair) => {
    const span = headRow(r);
    if (!span) return;
    for (let x = Math.max(x0, span[0]); x <= Math.min(x1, span[1]); x++) H(x, r, c);
  };

  // ---------------------------------------------------------- 다리
  if (dir === 's') {
    const stride = walk === 0 || walk === 2;
    const back = walk === 2 ? pants : pantsDark;
    const front = walk === 2 ? pantsDark : pants;
    if (stride) {
      pc.rect(9, 19, 2, 2, back);
      pc.rect(9, 21, 2, 1, shoe);
      pc.rect(5, 19, 2, 2, front);
      pc.rect(4, 21, 3, 1, shoe);
      pc.rect(7, 19, 2, 1, pants);
    } else {
      pc.rect(6, 19, 4, 2, pants);
      pc.vline(8, 20, 20, pantsDark);
      pc.rect(5, 21, 5, 1, shoe);
    }
  } else {
    const liftL = walk === 0;
    const liftR = walk === 2;
    pc.rect(5, 19, 6, 1, pants);
    pc.rect(5, 20, 2, liftL ? 0 : 1, pants);
    pc.rect(9, 20, 2, liftR ? 0 : 1, pants);
    pc.rect(5, liftL ? 20 : 21, 2, 1, shoe);
    pc.rect(9, liftR ? 20 : 21, 2, 1, shoe);
  }

  // ---------------------------------------------------------- 몸통 + 팔
  if (dir === 's') {
    pc.rect(5, BY, 6, 5, shirt);
    pc.vline(10, BY, BY + 4, shirtDark);
    pc.hline(5, 10, BY + 4, shirtDark);
    const ax = walk === 0 ? 6 : walk === 2 ? 8 : 7;
    pc.rect(ax, BY + 1, 2, 3, shirtDark);
    pc.rect(ax, BY + 4, 2, 1, skin.base);
    pc.set(ax, BY + 1, shirt);
  } else {
    pc.rect(4, BY, 8, 5, shirt);
    pc.vline(11, BY, BY + 4, shirtDark);
    pc.hline(4, 11, BY + 4, shirtDark);
    if (dir === 'd') {
      pc.set(7, BY, skin.base);
      pc.set(8, BY, skin.base);
      pc.set(6, BY, shirtLight);
      pc.set(9, BY, shirtLight);
      pc.set(7, BY + 1, shirtLight);
      pc.set(8, BY + 1, shirtLight);
    }
    const aL = walk === 0 ? -1 : walk === 2 ? 1 : 0;
    const aR = -aL;
    pc.rect(3, BY + 1 + aL, 1, 2, shirtDark);
    pc.set(3, BY + 3 + aL, skin.base);
    pc.rect(12, BY + 1 + aR, 1, 2, shirtDark);
    pc.set(12, BY + 3 + aR, skin.base);
  }

  // ---------------------------------------------------------- 머리(피부)
  for (let r = 0; r <= 9; r++) {
    const span = headRow(r)!;
    for (let x = span[0]; x <= span[1]; x++) H(x, r, skin.base);
  }
  // 턱 그림자
  for (let x = 4; x <= 11; x++) H(x, 9, skin.dark);

  // 포니테일 꼬리 (머리 뒤로 먼저 그리기)
  if (look.style === 'pony') {
    if (dir === 's') {
      for (let r = 2; r <= 8; r++) H(14, r, r > 6 ? hairDark : hair);
      for (let r = 3; r <= 6; r++) H(13, r, hair);
      H(14, 9, hairDark);
    }
  }

  // ---------------------------------------------------------- 머리카락
  const style = look.style;
  const long = style === 'bob' || style === 'cat' || style === 'buns';
  if (dir === 'u') {
    const lastHair = long ? 9 : 8;
    for (let r = 0; r <= lastHair; r++) hairRow(r, 0, 15, r >= 7 ? hairDark : hair);
    hairRow(0, 5, 8, hairLight);
    hairRow(1, 6, 7, hairLight);
    if (style === 'pony') {
      for (let r = 6; r <= 12; r++) {
        H(7, r, r > 10 ? hairDark : hair);
        H(8, r, hairDark);
      }
      H(7, 6, shirt);
      H(8, 6, shirt);
    }
  } else if (dir === 'd') {
    hairRow(0, 0, 15);
    hairRow(1, 0, 15);
    hairRow(2, 0, 15);
    hairRow(0, 6, 9, hairLight);
    hairRow(1, 5, 7, hairLight);
    if (style === 'bob' || style === 'cat') {
      hairRow(3, 2, 13);
      hairRow(3, 7, 7, skin.base);
      H(4, 4, hair);
      H(10, 4, hair);
      for (let r = 4; r <= 8; r++) {
        H(2, r, hair);
        H(3, r, r >= 6 ? hairDark : hair);
        H(13, r, hair);
        H(12, r, r >= 6 ? hairDark : hair);
      }
      H(3, 9, hairDark);
      H(12, 9, hairDark);
    } else if (style === 'buns') {
      hairRow(3, 2, 13);
      hairRow(3, 6, 8, skin.base);
      for (let r = 4; r <= 7; r++) {
        H(2, r, hair);
        H(13, r, hair);
      }
      H(3, 4, hair);
      H(12, 4, hair);
    } else {
      // 짧은 머리 (포니테일·모자 계열)
      hairRow(3, 2, 5);
      hairRow(3, 8, 13);
      H(2, 4, hair);
      H(3, 4, hair);
      H(12, 4, hair);
      H(13, 4, hair);
      H(2, 5, hairDark);
      H(13, 5, hairDark);
      if (style === 'pony') {
        H(13, 6, hairDark);
        H(2, 6, hairDark);
      }
    }
  } else {
    // 옆모습(왼쪽을 봄): 뒷머리는 오른쪽
    hairRow(0, 0, 15);
    hairRow(1, 0, 15);
    hairRow(2, 0, 15);
    hairRow(0, 5, 8, hairLight);
    hairRow(1, 4, 6, hairLight);
    const backTo = long ? 8 : 6;
    for (let r = 3; r <= backTo; r++) hairRow(r, long ? 7 : 8, 15, r >= 6 ? hairDark : hair);
    hairRow(3, 2, 4);
    if (long) H(13, 9, hairDark);
    if (!long) {
      // 귀
      H(8, 5, skin.dark);
      H(8, 6, skin.dark);
    }
  }

  // ---------------------------------------------------------- 얼굴
  if (dir === 'd') {
    if (blink) {
      H(4, 6, EYE);
      H(5, 6, EYE);
      H(10, 6, EYE);
      H(11, 6, EYE);
    } else {
      H(5, 5, EYE);
      H(5, 6, EYE);
      H(10, 5, EYE);
      H(10, 6, EYE);
    }
    H(4, 7, BLUSH);
    H(11, 7, BLUSH);
  } else if (dir === 's') {
    if (blink) {
      H(3, 6, EYE);
      H(4, 6, EYE);
    } else {
      H(4, 5, EYE);
      H(4, 6, EYE);
    }
    H(5, 7, BLUSH);
  }

  // ---------------------------------------------------------- 액세서리
  const ACC_DARK = '#4b4360';
  if (style === 'cat') {
    const ear = (x0: number, dirX: 1 | -1) => {
      // 삼각형 귀: 위로 3줄
      H(x0, -3, ACC_DARK);
      H(x0, -2, ACC_DARK);
      H(x0 + dirX, -2, ACC_DARK);
      H(x0, -1, ACC_DARK);
      H(x0 + dirX, -1, '#ff9fb6');
      H(x0 + dirX * 2, -1, ACC_DARK);
    };
    if (dir === 's') {
      ear(6, 1);
      ear(11, 1);
    } else {
      ear(3, 1);
      ear(12, -1);
    }
    if (dir !== 'u') hairRow(1, 3, 12, ACC_DARK);
  }
  if (style === 'buns') {
    const bun = (cx: number) => {
      pc.circle(cx, HY - 0.5, 2.6, (dx, dy) => (dx + dy > 0.5 ? hairDark : dx + dy < -0.7 ? hairLight : hair));
    };
    if (dir === 's') {
      bun(11);
      H(10, 1, shirt);
      H(11, 1, shirt);
      H(12, 1, shirtDark);
    } else {
      bun(3);
      bun(12.5);
      H(4, 1, shirt);
      H(5, 1, shirtDark);
      H(11, 1, shirt);
      H(10, 1, shirtDark);
    }
  }
  if (style === 'sprout') {
    const L = '#7cc96a';
    const LD = '#58a656';
    H(8, -1, LD);
    H(8, -2, LD);
    H(6, -3, L);
    H(7, -3, L);
    H(7, -2, LD);
    H(9, -3, L);
    H(10, -3, L);
    H(10, -4, L);
    H(9, -4, '#a5e08b');
  }
  if (style === 'cap') {
    const capC = shirt;
    const capD = shirtDark;
    const capL = shirtLight;
    for (let r = -1; r <= 2; r++) {
      const [a, b] = r === -1 ? [4, 11] : r === 0 ? [3, 12] : [2, 13];
      for (let x = a; x <= b; x++) H(x, r, capC);
    }
    H(5, 0, capL);
    H(6, 0, capL);
    H(5, -1, capL);
    if (dir === 'd') {
      for (let x = 2; x <= 13; x++) H(x, 3, capD);
      H(7, 0, '#ffffff');
      H(8, 0, '#ffffff');
    } else if (dir === 's') {
      for (let x = 0; x <= 5; x++) H(x, 3, capD);
      for (let x = 6; x <= 13; x++) H(x, 3, hair);
    } else {
      for (let x = 2; x <= 13; x++) H(x, 2, capD);
      H(7, 3, capD);
      H(8, 3, capD);
    }
  }
  if (style === 'beanie') {
    const knit = '#f6ead6';
    const knitD = '#e2d0b4';
    for (let r = -2; r <= 2; r++) {
      const [a, b] = r === -2 ? [5, 10] : r === -1 ? [3, 12] : [2, 13];
      for (let x = a; x <= b; x++) H(x, r, (x + (r & 1)) % 3 === 0 ? knitD : knit);
    }
    for (let x = 2; x <= 13; x++) H(x, 3, dir === 's' && x < 4 ? shirtDark : shirt);
    for (let x = 2; x <= 13; x += 2) H(x, 3, shirtDark);
    pc.circle(dir === 's' ? 9 : 8, HY - 2.6, 1.6, shirt);
  }
  if (style === 'glasses') {
    const G = '#5b4f6e';
    if (dir === 'd') {
      for (const x0 of [4, 9]) {
        for (let x = x0; x <= x0 + 2; x++) {
          H(x, 4, G);
          H(x, 7, G);
        }
        H(x0, 5, G);
        H(x0, 6, G);
        H(x0 + 2, 5, G);
        H(x0 + 2, 6, G);
        H(x0 + 1, 7, G);
      }
      H(7, 5, G);
      H(8, 5, G);
      // 렌즈 반사광
      H(6, 5, '#ffffff');
      H(11, 5, '#ffffff');
    } else if (dir === 's') {
      for (let x = 3; x <= 5; x++) {
        H(x, 4, G);
        H(x, 7, G);
      }
      H(3, 5, G);
      H(3, 6, G);
      H(5, 5, G);
      H(5, 6, G);
      H(6, 5, G);
      H(7, 5, G);
    }
  }
}

function makeFrame(look: LookDef, color: (typeof COLORS)[number], dir: DirKey, frame: number): PixelCanvas {
  const pc = new PixelCanvas(FRAME_W, FRAME_H);
  paintFrame(pc, look, color, dir, frame);
  pc.outline(OUTLINE);
  return pc;
}

const sheetCache = new Map<string, HTMLCanvasElement>();

export function characterKey(look: number, color: number) {
  return `char-${look}-${color}`;
}

/** 캐릭터 스프라이트 시트(캔버스) 생성 — 결과는 캐시됩니다 */
export function buildCharacterSheet(lookIdx: number, colorIdx: number): HTMLCanvasElement {
  const key = characterKey(lookIdx, colorIdx);
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const look = LOOKS[lookIdx] ?? LOOKS[0];
  const color = COLORS[colorIdx] ?? COLORS[0];
  const sheet = new PixelCanvas(FRAME_W * SHEET_COLS, FRAME_H * DIR_ROWS.length);
  DIR_ROWS.forEach((dir, row) => {
    for (let f = 0; f < SHEET_COLS; f++) sheet.blit(makeFrame(look, color, dir, f), f * FRAME_W, row * FRAME_H);
  });
  const canvas = sheet.flush();
  sheetCache.set(key, canvas);
  return canvas;
}
