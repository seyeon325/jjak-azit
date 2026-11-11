/**
 * 픽셀 캐릭터 생성기 — 12종의 개성 있는 캐릭터.
 * 머리 모양·옷차림·모자·소품이 서로 달라 작은 화면에서도 실루엣으로 구별됩니다.
 *
 * 시트 구성 (16×26 프레임, 가로 6칸)
 *   0행 아래(정면) · 1행 위(뒷모습) · 2행 옆(왼쪽, 오른쪽은 좌우 반전)
 *     [대기, 눈깜빡, 걷기1~4]
 *   3행 표정(정면) [행복, 뜨거워, 노곤, 냠(입 벌림), 냠(오물), 노곤2]
 * 2차의 포즈·춤 등은 같은 방식으로 행을 추가하면 됩니다.
 */
import { LOOK_COUNT } from '../../../../shared/constants';
import { mix, PixelCanvas } from './pixel';

export const FRAME_W = 16;
export const FRAME_H = 26;
/** 스프라이트 원점 y (발바닥 위치 비율) */
export const ORIGIN_Y = 24 / FRAME_H;
/** 머리 꼭대기~발까지 대략 높이 (이름표 위치 계산용) */
export const HEAD_TOP = 19;
export const SHEET_COLS = 6;
export const DIR_ROWS = ['d', 'u', 's', 'e', 'p', 'q'] as const;
/** 포즈 행 p: [앉기(정면), 손흔들기A, 손흔들기B, 브이, 놀람, 엉덩방아] / q: [앉기(뒤), 앉기(옆)] */
export const POSE_FRAMES = { sit: 'p0', waveA: 'p1', waveB: 'p2', v: 'p3', surprised: 'p4', bump: 'p5', sitBack: 'q0', sitSide: 'q1', push: 'q2', pushB: 'q3' } as const;
export const EXPR_FRAMES = { happy: 0, hot: 1, relax: 2, chew: 3, chew2: 4, relax2: 5 } as const;

type HairStyle = 'short' | 'bob' | 'long' | 'messy' | 'slick';
type TopKind = 'tee' | 'hoodie' | 'pajama' | 'jacket' | 'cardigan' | 'onesie' | 'overalls' | 'raincoat';
type Hat = 'catBeanie' | 'frog' | 'crown' | 'mushroom' | 'bear' | 'bunny' | 'beret' | 'sleepcap';
type Expr = 'normal' | 'blink' | 'happy' | 'hot' | 'relax' | 'chew' | 'chew2' | 'wow';
type Pose = 'none' | 'sit' | 'waveA' | 'waveB' | 'v' | 'surprised' | 'push';

export interface LookDef {
  name: string;
  desc: string;
  skin: 0 | 1 | 2;
  hair: string;
  hairStyle: HairStyle;
  top: TopKind;
  topColor: string;
  topDark: string;
  inner?: string;
  accent?: string;
  pants: string;
  shoes: string;
  hat?: Hat;
  hatColor?: string;
  face?: 'glasses' | 'sunglasses';
  back?: 'backpack' | 'cape';
  backColor?: string;
  sleepy?: boolean;
}

export const LOOKS: LookDef[] = [
  {
    name: '새내기',
    desc: '설렘 가득 신입생',
    skin: 0,
    hair: '#7a4e38',
    hairStyle: 'short',
    top: 'tee',
    topColor: '#ff8f7a',
    topDark: '#e0705e',
    accent: '#fff6e4',
    pants: '#5a6fa8',
    shoes: '#fdf8ef',
  },
  {
    name: '후드티',
    desc: '과제는 내일의 나에게',
    skin: 1,
    hair: '#3a3040',
    hairStyle: 'messy',
    top: 'hoodie',
    topColor: '#b9a3ef',
    topDark: '#957bd8',
    accent: '#fff6e4',
    pants: '#5b5870',
    shoes: '#fdf8ef',
  },
  {
    name: '냥냥 비니',
    desc: '고양이 귀 털모자',
    skin: 0,
    hair: '#e2b873',
    hairStyle: 'bob',
    top: 'tee',
    topColor: '#7fd8b6',
    topDark: '#5cbb98',
    pants: '#6b6884',
    shoes: '#fdf8ef',
    hat: 'catBeanie',
    hatColor: '#f6ead6',
  },
  {
    name: '개굴이',
    desc: '비 오는 날이 제일 좋아',
    skin: 2,
    hair: '#5b4136',
    hairStyle: 'short',
    top: 'raincoat',
    topColor: '#ffd66e',
    topDark: '#e8b64a',
    pants: '#5d7a6e',
    shoes: '#5fa857',
    hat: 'frog',
    hatColor: '#7cc96a',
  },
  {
    name: '공부벌레',
    desc: '시험기간 생존자 (안경+백팩)',
    skin: 0,
    hair: '#2f2836',
    hairStyle: 'short',
    top: 'cardigan',
    topColor: '#5f6fa3',
    topDark: '#4a5785',
    inner: '#fff6e4',
    pants: '#8a7a68',
    shoes: '#fdf8ef',
    face: 'glasses',
    back: 'backpack',
    backColor: '#62a8d8',
  },
  {
    name: '잠꾸러기',
    desc: '방금 일어났어요… 잠옷 차림',
    skin: 1,
    hair: '#8a5a44',
    hairStyle: 'messy',
    top: 'pajama',
    topColor: '#bfe4fb',
    topDark: '#86c8f2',
    accent: '#ffffff',
    pants: '#bfe4fb',
    shoes: '#ffa1bf',
    hat: 'sleepcap',
    hatColor: '#86c8f2',
    sleepy: true,
  },
  {
    name: '과대표',
    desc: '왕관과 망토, 책임감 만렙',
    skin: 0,
    hair: '#4f3b4a',
    hairStyle: 'long',
    top: 'tee',
    topColor: '#fff6e4',
    topDark: '#e6cfa8',
    pants: '#4f4a6b',
    shoes: '#4b4360',
    hat: 'crown',
    hatColor: '#ffd66e',
    back: 'cape',
    backColor: '#e0605a',
  },
  {
    name: '버섯돌이',
    desc: '숲속에서 놀러 온 친구',
    skin: 1,
    hair: '#7a5238',
    hairStyle: 'short',
    top: 'tee',
    topColor: '#f3e2c4',
    topDark: '#dcc6a0',
    accent: '#7fc76b',
    pants: '#8a6a4e',
    shoes: '#fdf8ef',
    hat: 'mushroom',
    hatColor: '#ef6a5a',
  },
  {
    name: '쿨한 선배',
    desc: '선글라스는 필수, 가죽 재킷',
    skin: 2,
    hair: '#2a2230',
    hairStyle: 'slick',
    top: 'jacket',
    topColor: '#45415a',
    topDark: '#2f2c40',
    inner: '#fdf8ef',
    pants: '#2f2c40',
    shoes: '#fdf8ef',
    face: 'sunglasses',
  },
  {
    name: '곰돌이 탈',
    desc: '안에 사람 없어요',
    skin: 0,
    hair: '#b07a52',
    hairStyle: 'short',
    top: 'onesie',
    topColor: '#b07a52',
    topDark: '#8a5a3e',
    accent: '#e8c79c',
    pants: '#b07a52',
    shoes: '#8a5a3e',
    hat: 'bear',
    hatColor: '#b07a52',
  },
  {
    name: '토끼 후드',
    desc: '깡총깡총 분홍 우주복',
    skin: 0,
    hair: '#c97b52',
    hairStyle: 'short',
    top: 'onesie',
    topColor: '#ffc6d6',
    topDark: '#f3a2bc',
    accent: '#fff6e4',
    pants: '#ffc6d6',
    shoes: '#fdf8ef',
    hat: 'bunny',
    hatColor: '#fdf8ef',
  },
  {
    name: '디자이너',
    desc: '베레모 쓴 아티스트',
    skin: 0,
    hair: '#c97b52',
    hairStyle: 'bob',
    top: 'overalls',
    topColor: '#5f8fc9',
    topDark: '#4a74a8',
    inner: '#ffd66e',
    pants: '#5f8fc9',
    shoes: '#fdf8ef',
    hat: 'beret',
    hatColor: '#e0605a',
  },
];

if (LOOKS.length !== LOOK_COUNT) console.warn('캐릭터 수가 shared/constants.ts LOOK_COUNT 와 다릅니다.');

const SKINS = [
  { base: '#ffe1c8', dark: '#f3c3a3' },
  { base: '#f7cfab', dark: '#e6b28b' },
  { base: '#e9bb93', dark: '#d39f77' },
];

const OUTLINE = '#3d3047';
const EYE = '#3b2e44';
const BLUSH = '#ff9f9a';
const MOUTH = '#8a3a4a';

type DirKey = 'd' | 'u' | 's';

function paintFrame(pc: PixelCanvas, L: LookDef, dir: DirKey, frame: number, expr: Expr, pose: Pose = 'none') {
  const walk = pose !== 'none' ? -1 : frame >= 2 ? frame - 2 : -1;
  const sit = pose === 'sit';
  const bob = (walk === 0 || walk === 2 ? 1 : 0) + (sit ? 2 : 0);
  const armUpR = pose === 'waveA' || pose === 'waveB' || pose === 'v' || pose === 'surprised';
  const armUpL = pose === 'surprised';
  const skin = SKINS[L.skin];
  const hair = L.hair;
  const hairDark = mix(hair, '#2a1f30', 0.28);
  const hairLight = mix(hair, '#ffffff', 0.22);
  const top = L.topColor;
  const topDark = L.topDark;
  const topLight = mix(top, '#ffffff', 0.35);
  const pants = L.pants;
  const pantsDark = mix(pants, '#20182a', 0.25);
  const shoe = L.shoes;
  const hand = L.hat === 'bear' ? '#8a5a3e' : skin.base;
  const isBear = L.hat === 'bear';

  const HY = 6 + bob; // 머리 시작
  const BY = 16 + bob; // 몸 시작
  const LY = 21; // 다리 시작
  const H = (x: number, r: number, c: string) => pc.set(x, HY + r, c);
  const headRow = (r: number): [number, number] | null =>
    r === 0 ? [4, 11] : r === 1 ? [3, 12] : r >= 2 && r <= 8 ? [2, 13] : r === 9 ? [3, 12] : null;
  const hairRow = (r: number, x0: number, x1: number, c = hair) => {
    const span = headRow(r);
    if (!span) return;
    for (let x = Math.max(x0, span[0]); x <= Math.min(x1, span[1]); x++) H(x, r, c);
  };

  // ---------------------------------------------------------- 등 뒤 (망토)
  if (L.back === 'cape') {
    const c = L.backColor!;
    const cd = mix(c, '#2a1f30', 0.25);
    if (dir === 'd') {
      pc.rect(3, BY + 1, 10, 6, cd);
    } else if (dir === 's') {
      pc.rect(8, BY, 5, 6, c);
      pc.vline(12, BY + 1, BY + 5, cd);
    }
  }

  // ---------------------------------------------------------- 다리
  if (sit) {
    if (dir === 's') {
      pc.rect(2, LY + 1, 7, 1, pants);
      pc.rect(1, LY + 1, 2, 2, shoe);
    } else {
      pc.rect(5, LY + 1, 6, 1, dir === 'u' ? pantsDark : pants);
      pc.rect(4, LY + 2, 3, 1, shoe);
      pc.rect(9, LY + 2, 3, 1, shoe);
    }
  } else if (dir === 's') {
    const stride = walk === 0 || walk === 2;
    const back = walk === 2 ? pants : pantsDark;
    const front = walk === 2 ? pantsDark : pants;
    if (stride) {
      pc.rect(9, LY, 2, 2, back);
      pc.rect(9, LY + 2, 2, 1, shoe);
      pc.rect(5, LY, 2, 2, front);
      pc.rect(4, LY + 2, 3, 1, shoe);
      pc.rect(7, LY, 2, 1, pants);
    } else {
      pc.rect(6, LY, 4, 2, pants);
      pc.vline(8, LY + 1, LY + 1, pantsDark);
      pc.rect(5, LY + 2, 5, 1, shoe);
    }
  } else {
    const liftL = walk === 0;
    const liftR = walk === 2;
    pc.rect(5, LY, 6, 1, pants);
    if (!liftL) pc.rect(5, LY + 1, 2, 1, pants);
    if (!liftR) pc.rect(9, LY + 1, 2, 1, pants);
    pc.rect(5, liftL ? LY + 1 : LY + 2, 2, 1, shoe);
    pc.rect(9, liftR ? LY + 1 : LY + 2, 2, 1, shoe);
  }
  if (L.top === 'pajama') {
    pc.set(6, LY, L.accent!);
    pc.set(9, LY, L.accent!);
  }

  // ---------------------------------------------------------- 몸통
  const bodyX0 = dir === 's' ? 5 : 4;
  const bodyX1 = dir === 's' ? 10 : 11;
  const bodyRows = L.top === 'raincoat' ? 6 : 5;
  pc.rect(bodyX0, BY, bodyX1 - bodyX0 + 1, bodyRows, top);
  pc.vline(bodyX1, BY, BY + bodyRows - 1, topDark);
  pc.hline(bodyX0, bodyX1, BY + bodyRows - 1, topDark);

  if (dir === 'd') {
    switch (L.top) {
      case 'tee':
        pc.set(7, BY, skin.base);
        pc.set(8, BY, skin.base);
        if (L.accent) {
          // 가슴 무늬 (하트/새싹)
          pc.set(6, BY + 1, L.accent);
          pc.set(8, BY + 1, L.accent);
          pc.hline(6, 8, BY + 2, L.accent);
          pc.set(7, BY + 3, L.accent);
        }
        break;
      case 'hoodie':
        pc.hline(4, 11, BY, topDark);
        pc.set(6, BY + 1, L.accent!);
        pc.set(9, BY + 1, L.accent!);
        pc.set(6, BY + 2, L.accent!);
        pc.set(9, BY + 2, L.accent!);
        pc.hline(5, 10, BY + 3, topDark);
        break;
      case 'pajama':
        pc.set(7, BY, '#ffffff');
        pc.set(8, BY, '#ffffff');
        pc.vline(7, BY + 1, BY + 3, topDark);
        for (const [x, y] of [
          [5, 1],
          [10, 2],
          [5, 3],
          [9, 0],
        ])
          pc.set(x, BY + y, L.accent!);
        break;
      case 'jacket':
      case 'cardigan':
        pc.rect(7, BY, 2, 4, L.inner!);
        pc.set(6, BY, mix(top, '#ffffff', 0.2));
        pc.set(9, BY, mix(top, '#ffffff', 0.2));
        if (L.top === 'cardigan') {
          pc.set(6, BY + 2, '#ffd66e');
          pc.set(6, BY + 3, '#ffd66e');
        } else {
          pc.set(6, BY + 1, topLight);
          pc.set(9, BY + 1, topLight);
        }
        break;
      case 'onesie':
        pc.rect(6, BY + 1, 4, 3, L.accent!);
        pc.set(7, BY, skin.base);
        pc.set(8, BY, skin.base);
        break;
      case 'overalls':
        pc.rect(4, BY, 8, 2, L.inner!);
        pc.rect(5, BY + 1, 6, 4, top);
        pc.set(5, BY, top);
        pc.set(10, BY, top);
        pc.set(7, BY + 2, '#ff8f7a');
        pc.set(9, BY + 3, '#ffd66e');
        pc.set(6, BY + 4, '#7fd8b6');
        pc.set(5, BY + 1, '#ffd66e');
        pc.set(10, BY + 1, '#ffd66e');
        break;
      case 'raincoat':
        pc.vline(7, BY, BY + 5, topDark);
        pc.set(8, BY + 1, '#4b4360');
        pc.set(8, BY + 3, '#4b4360');
        pc.set(6, BY, topLight);
        break;
    }
  } else if (dir === 'u') {
    if (L.top === 'hoodie') {
      pc.rect(5, BY, 6, 2, topDark);
      pc.hline(6, 9, BY + 2, topDark);
    }
    if (L.top === 'overalls') {
      pc.rect(4, BY, 8, 1, L.inner!);
      pc.set(6, BY + 1, top);
      pc.set(9, BY + 1, top);
    }
    if (L.top === 'pajama') {
      pc.set(6, BY + 2, L.accent!);
      pc.set(9, BY + 1, L.accent!);
    }
  } else {
    if (L.top === 'hoodie') pc.rect(9, BY, 2, 2, topDark);
    if (L.top === 'jacket' || L.top === 'cardigan') pc.vline(5, BY, BY + 3, L.inner!);
    if (L.top === 'overalls') pc.rect(5, BY, 6, 1, L.inner!);
  }

  // 망토 (뒷모습은 몸 위로)
  if (L.back === 'cape' && dir === 'u') {
    const c = L.backColor!;
    pc.rect(3, BY, 10, 6, c);
    pc.vline(12, BY, BY + 5, mix(c, '#2a1f30', 0.25));
    pc.hline(3, 12, BY + 5, mix(c, '#2a1f30', 0.25));
    pc.hline(4, 11, BY, '#ffd66e');
  }
  // 백팩
  if (L.back === 'backpack') {
    const b = L.backColor!;
    const bd = mix(b, '#2a1f30', 0.25);
    if (dir === 'd') {
      pc.vline(5, BY, BY + 3, bd);
      pc.vline(10, BY, BY + 3, bd);
    } else if (dir === 'u') {
      pc.rect(4, BY, 8, 5, b);
      pc.hline(4, 11, BY, bd);
      pc.rect(5, BY + 2, 6, 2, mix(b, '#ffffff', 0.25));
      pc.vline(11, BY, BY + 4, bd);
    } else {
      pc.rect(10, BY, 3, 5, b);
      pc.vline(12, BY, BY + 4, bd);
      pc.vline(8, BY, BY + 2, bd);
    }
  }

  // ---------------------------------------------------------- 팔
  if (dir === 's') {
    const ax = walk === 0 ? 6 : walk === 2 ? 8 : 7;
    pc.rect(ax, BY + 1, 2, 3, topDark);
    pc.rect(ax, BY + 4, 2, 1, hand);
    pc.set(ax, BY + 1, top);
  } else {
    const aL = walk === 0 ? -1 : walk === 2 ? 1 : 0;
    const aR = -aL;
    if (pose === 'push') {
      // 두 팔을 앞으로 쭉 (그네 밀기)
      pc.rect(4, BY + 1, 1, 2, topDark);
      pc.rect(11, BY + 1, 1, 2, topDark);
      pc.rect(5, BY + 3, 2, 1, hand);
      pc.rect(9, BY + 3, 2, 1, hand);
    } else if (armUpL) {
      pc.rect(3, BY - 2, 1, 3, topDark);
      pc.set(2, BY - 3, hand);
      pc.set(3, BY - 3, hand);
    } else {
      pc.rect(3, BY + 1 + aL, 1, 2, topDark);
      pc.set(3, BY + 3 + aL, hand);
    }
    if (pose === 'push') {
      /* 위에서 그림 */
    } else if (armUpR) {
      if (pose === 'waveB') {
        pc.rect(12, BY - 1, 1, 2, topDark);
        pc.set(13, BY - 2, topDark);
        pc.set(13, BY - 3, hand);
        pc.set(14, BY - 4, hand);
      } else {
        pc.rect(12, BY - 2, 1, 3, topDark);
        pc.set(12, BY - 3, hand);
        pc.set(13, BY - 3, hand);
        if (pose === 'v') {
          pc.set(12, BY - 5, hand);
          pc.set(12, BY - 4, hand);
          pc.set(14, BY - 5, hand);
          pc.set(13, BY - 4, hand);
        }
      }
    } else {
      pc.rect(12, BY + 1 + aR, 1, 2, topDark);
      pc.set(12, BY + 3 + aR, hand);
    }
  }

  // ---------------------------------------------------------- 머리
  const headBase = isBear ? L.hatColor! : skin.base;
  for (let r = 0; r <= 9; r++) {
    const span = headRow(r)!;
    for (let x = span[0]; x <= span[1]; x++) H(x, r, headBase);
  }
  if (!isBear) for (let x = 4; x <= 11; x++) H(x, 9, skin.dark);

  // 긴 머리: 어깨 위로 내려오는 부분
  if (L.hairStyle === 'long' && !isBear) {
    if (dir === 'd') {
      for (let y = BY; y <= BY + 2; y++) {
        pc.set(2, y, hairDark);
        pc.set(3, y, hair);
        pc.set(12, y, hair);
        pc.set(13, y, hairDark);
      }
    } else if (dir === 'u') {
      pc.rect(4, BY, 8, 3, hair);
      pc.hline(4, 11, BY + 2, hairDark);
    } else {
      pc.rect(9, BY, 4, 3, hair);
      pc.vline(12, BY, BY + 2, hairDark);
    }
  }

  // ---------------------------------------------------------- 머리카락
  const style = L.hairStyle;
  const long = style === 'bob' || style === 'long';
  if (!isBear) {
    if (dir === 'u') {
      const last = long ? 9 : 8;
      for (let r = 0; r <= last; r++) hairRow(r, 0, 15, r >= 7 ? hairDark : hair);
      hairRow(0, 5, 8, hairLight);
      hairRow(1, 6, 7, hairLight);
    } else if (dir === 'd') {
      hairRow(0, 0, 15);
      hairRow(1, 0, 15);
      hairRow(2, 0, 15);
      hairRow(0, 6, 9, hairLight);
      hairRow(1, 5, 7, hairLight);
      if (long) {
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
      } else if (style === 'slick') {
        hairRow(3, 2, 4);
        hairRow(3, 10, 13);
        H(2, 4, hair);
        H(13, 4, hair);
        hairRow(1, 4, 8, hairLight);
      } else if (style === 'messy') {
        hairRow(3, 2, 4);
        hairRow(3, 6, 7);
        hairRow(3, 9, 13);
        H(2, 4, hair);
        H(3, 4, hair);
        H(12, 4, hair);
        H(13, 4, hair);
        H(2, 5, hairDark);
      } else {
        hairRow(3, 2, 5);
        hairRow(3, 8, 13);
        H(2, 4, hair);
        H(3, 4, hair);
        H(12, 4, hair);
        H(13, 4, hair);
        H(2, 5, hairDark);
        H(13, 5, hairDark);
      }
    } else {
      hairRow(0, 0, 15);
      hairRow(1, 0, 15);
      hairRow(2, 0, 15);
      hairRow(0, 5, 8, hairLight);
      hairRow(1, 4, 6, hairLight);
      const backTo = long ? 8 : 6;
      for (let r = 3; r <= backTo; r++) hairRow(r, long ? 7 : 8, 15, r >= 6 ? hairDark : hair);
      if (style !== 'slick') hairRow(3, 2, 4);
      if (long) H(13, 9, hairDark);
      else {
        H(8, 5, skin.dark);
        H(8, 6, skin.dark);
      }
    }
    if (style === 'messy') {
      // 삐죽 솟은 머리
      for (const x of dir === 's' ? [5, 8, 11] : [4, 7, 10]) H(x, -1, hair);
      H(dir === 's' ? 12 : 11, 0, hair);
    }
  }

  // ---------------------------------------------------------- 얼굴
  const eyeR = isBear ? 4 : 5;
  const eL = isBear ? 4 : 5;
  const eR = isBear ? 11 : 10;
  if (dir === 'd') {
    if (isBear) {
      // 곰 주둥이
      pc.ellipse(8, HY + 7, 2.8, 2, L.accent!);
      H(7, 6, '#4b3328');
      H(8, 6, '#4b3328');
    }
    const showEyes = L.face !== 'sunglasses';
    if (showEyes) {
      switch (expr) {
        case 'normal':
          if (L.sleepy) {
            H(eL - 1, eyeR + 1, EYE);
            H(eL, eyeR + 1, EYE);
            H(eR, eyeR + 1, EYE);
            H(eR + 1, eyeR + 1, EYE);
            H(eL, eyeR, mix(skin.base, EYE, 0.3));
            H(eR, eyeR, mix(skin.base, EYE, 0.3));
          } else {
            H(eL, eyeR, EYE);
            H(eL, eyeR + 1, EYE);
            H(eR, eyeR, EYE);
            H(eR, eyeR + 1, EYE);
          }
          break;
        case 'blink':
        case 'chew2':
          H(eL - 1, eyeR + 1, EYE);
          H(eL, eyeR + 1, EYE);
          H(eR, eyeR + 1, EYE);
          H(eR + 1, eyeR + 1, EYE);
          break;
        case 'happy':
        case 'chew':
          for (const cx of [eL, eR]) {
            H(cx - 1, eyeR + 1, EYE);
            H(cx, eyeR, EYE);
            H(cx + 1, eyeR + 1, EYE);
          }
          break;
        case 'hot':
          H(eL - 1, eyeR - 1, EYE);
          H(eL, eyeR, EYE);
          H(eL - 1, eyeR + 1, EYE);
          H(eR + 1, eyeR - 1, EYE);
          H(eR, eyeR, EYE);
          H(eR + 1, eyeR + 1, EYE);
          break;
        case 'wow':
          for (const cx of [eL, eR]) {
            H(cx, eyeR - 1, EYE);
            H(cx, eyeR, EYE);
            H(cx, eyeR + 1, EYE);
          }
          break;
        case 'relax':
          for (const cx of [eL, eR]) {
            H(cx - 1, eyeR, EYE);
            H(cx, eyeR + 1, EYE);
            H(cx + 1, eyeR, EYE);
          }
          break;
      }
    }
    // 볼
    if (!isBear) {
      const bl = expr === 'hot' ? '#ff6b6b' : BLUSH;
      H(4, 7, bl);
      H(11, 7, bl);
      if (expr === 'hot' || expr === 'relax' || expr === 'chew2') {
        H(3, 7, bl);
        H(12, 7, bl);
      }
    }
    // 입
    const my = isBear ? 7 : 8;
    if (expr === 'wow') {
      H(7, my, MOUTH);
      H(8, my, MOUTH);
      H(7, my + 1 > 9 ? my : my - 1, MOUTH);
      H(8, my + 1 > 9 ? my : my - 1, MOUTH);
    } else if (expr === 'happy' || expr === 'hot' || expr === 'chew') {
      H(7, my, MOUTH);
      H(8, my, MOUTH);
      if (expr !== 'happy') H(7, my - 1, MOUTH);
      if (expr === 'chew') H(8, my - 1, MOUTH);
    } else if (expr === 'relax' || expr === 'chew2') {
      H(7, my, mix(MOUTH, '#ffffff', 0.35));
      H(8, my, mix(MOUTH, '#ffffff', 0.35));
    } else if (L.face === 'sunglasses') {
      H(8, 8, mix(MOUTH, skin.base, 0.4));
      H(9, 8, mix(MOUTH, skin.base, 0.4));
    }
  } else if (dir === 's') {
    if (isBear) {
      pc.ellipse(4, HY + 7, 2.2, 1.8, L.accent!);
      H(2, 6, '#4b3328');
      H(4, 4, EYE);
      H(4, 5, EYE);
    } else if (L.face !== 'sunglasses') {
      if (expr === 'blink' || L.sleepy) {
        H(3, 6, EYE);
        H(4, 6, EYE);
      } else {
        H(4, 5, EYE);
        H(4, 6, EYE);
      }
      H(5, 7, BLUSH);
    }
  }

  // ---------------------------------------------------------- 얼굴 소품
  if (L.face === 'glasses' && dir !== 'u') {
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
      }
      H(7, 5, G);
      H(8, 5, G);
      H(6, 5, '#ffffff');
      H(11, 5, '#ffffff');
    } else {
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
  if (L.face === 'sunglasses' && dir !== 'u') {
    const S = '#2b2838';
    if (dir === 'd') {
      for (const x0 of [3, 9]) {
        pc.rect(x0, HY + 4, 4, 2, S);
        pc.rect(x0 + 1, HY + 6, 2, 1, S);
        H(x0, 4, '#8c89a6');
      }
      H(7, 4, S);
      H(8, 4, S);
    } else {
      pc.rect(2, HY + 4, 4, 2, S);
      pc.rect(3, HY + 6, 2, 1, S);
      H(6, 4, S);
      H(7, 4, S);
      H(8, 4, S);
      H(2, 4, '#8c89a6');
    }
  }

  // ---------------------------------------------------------- 모자
  const hc = L.hatColor ?? '#ffffff';
  const hcD = mix(hc, '#2a1f30', 0.22);
  const hcL = mix(hc, '#ffffff', 0.3);
  switch (L.hat) {
    case 'catBeanie': {
      for (let r = -1; r <= 3; r++) {
        const [a, b] = r === -1 ? [4, 11] : r === 0 ? [3, 12] : [2, 13];
        for (let x = a; x <= b; x++) H(x, r, (x + (r & 1)) % 3 === 0 ? hcD : hc);
      }
      for (let x = 2; x <= 13; x++) H(x, 3, hcD);
      const ear = (x0: number, d: 1 | -1) => {
        H(x0, -4, hc);
        H(x0, -3, hc);
        H(x0 + d, -3, hc);
        H(x0, -2, hc);
        H(x0 + d, -2, '#ffb1c2');
        H(x0 + 2 * d, -2, hc);
      };
      if (dir === 's') {
        ear(6, 1);
        ear(10, 1);
      } else {
        ear(3, 1);
        ear(12, -1);
      }
      break;
    }
    case 'frog': {
      for (let r = -1; r <= 3; r++) {
        const [a, b] = r === -1 ? [4, 11] : r === 0 ? [3, 12] : [2, 13];
        for (let x = a; x <= b; x++) H(x, r, r <= 0 ? hcL : hc);
      }
      for (let x = 2; x <= 13; x++) H(x, 3, hcD);
      const eye = (cx: number) => {
        pc.circle(cx, HY - 2, 2.3, '#ffffff');
        pc.set(Math.floor(cx), HY - 2, EYE);
        pc.set(Math.floor(cx), HY - 1, EYE);
      };
      if (dir === 'd') {
        eye(5);
        eye(11);
        H(3, 1, '#ff9fb6');
        H(12, 1, '#ff9fb6');
        for (let x = 6; x <= 9; x++) H(x, 2, hcD);
      } else if (dir === 's') {
        eye(5);
        eye(9);
      } else {
        pc.circle(5, HY - 2, 2.3, hc);
        pc.circle(11, HY - 2, 2.3, hc);
      }
      break;
    }
    case 'crown': {
      const Y = hc;
      const YD = '#e3a83a';
      for (let x = 4; x <= 11; x++) {
        H(x, -1, Y);
        H(x, -2, x % 2 ? Y : '#fff1b0');
      }
      for (const x of [4, 7, 8, 11]) H(x, -3, Y);
      for (const x of [4, 11]) H(x, -4, Y);
      H(7, -4, Y);
      H(8, -4, Y);
      for (let x = 4; x <= 11; x++) H(x, -1, YD);
      H(7, -2, '#ff6b7a');
      H(8, -2, '#ff6b7a');
      break;
    }
    case 'mushroom': {
      const R = hc;
      const RD = mix(R, '#2a1f30', 0.25);
      pc.ellipse(8, HY + 0.5, 7.3, 4.6, (dx, dy) => (dy > 0.55 ? null : dx + dy > 0.55 ? RD : R));
      // 주름(갓 아래)
      for (let x = 3; x <= 12; x++) pc.set(x, HY + 3, '#f3e2c4');
      const dots: [number, number][] =
        dir === 'u'
          ? [
              [5, -2],
              [10, -1],
              [7, 1],
              [3, 1],
              [12, 1],
            ]
          : [
              [5, -2],
              [10, -2],
              [8, 0],
              [3, 1],
              [12, 1],
            ];
      for (const [x, r] of dots) {
        H(x, r, '#ffffff');
        H(x + 1, r, '#ffffff');
      }
      break;
    }
    case 'bear': {
      // 귀
      const earsX = dir === 's' ? [6, 10] : [3.5, 12.5];
      for (const ex of earsX) {
        pc.circle(ex, HY + 0.5, 2.2, hc);
        pc.set(Math.floor(ex), HY, L.accent!);
      }
      // 머리 위 하이라이트
      H(6, 1, hcL);
      H(7, 1, hcL);
      H(5, 2, hcL);
      if (dir === 'u') for (let x = 4; x <= 11; x++) H(x, 8, hcD);
      break;
    }
    case 'bunny': {
      // 후드 테두리
      for (let r = -1; r <= 9; r++) {
        const span = headRow(r) ?? (r === -1 ? [4, 11] : null);
        if (!span) continue;
        for (let x = span[0]; x <= span[1]; x++) {
          const inFace = dir === 'd' && r >= 3 && r <= 8 && x >= 4 && x <= 11;
          const inSide = dir === 's' && r >= 3 && r <= 8 && x >= 2 && x <= 6;
          if (!inFace && !inSide) H(x, r, r <= 0 ? hcL : hc);
        }
      }
      if (dir === 'd') {
        hairRow(3, 5, 10);
        H(6, 4, hair);
        H(9, 4, hair);
      }
      // 긴 귀
      const ear = (x0: number, tilt: number) => {
        for (let r = -6; r <= -1; r++) {
          const ox = r <= -5 ? tilt : 0;
          H(x0 + ox, r, hc);
          H(x0 + 1 + ox, r, r >= -5 && r <= -2 ? '#ffb1c2' : hc);
          H(x0 + 2 + ox, r, hcD);
        }
      };
      if (dir === 's') {
        ear(8, 1);
        ear(5, 0);
      } else {
        ear(3, -1);
        ear(10, 1);
      }
      break;
    }
    case 'beret': {
      const tilt = dir === 's' ? -1 : 1;
      for (let r = -2; r <= 1; r++) {
        const a = r === -2 ? 5 : 2;
        const b = r === -2 ? 11 : 13 + (r >= -1 && r <= 0 ? tilt : 0);
        for (let x = Math.max(1, a + (r === 1 ? 1 : 0)); x <= Math.min(14, b); x++) H(x, r, r === 1 ? hcD : r === -2 ? hcL : hc);
      }
      H(8, -3, hcD);
      break;
    }
    case 'sleepcap': {
      for (let r = -1; r <= 2; r++) {
        const [a, b] = r === -1 ? [4, 11] : r === 0 ? [3, 12] : [2, 13];
        for (let x = a; x <= b; x++) H(x, r, (x + r) % 4 === 0 ? hcL : hc);
      }
      for (let x = 2; x <= 13; x++) H(x, 2, '#ffffff');
      // 늘어진 끝 + 방울
      const tx = dir === 's' ? 12 : 11;
      H(tx, -2, hc);
      H(tx + 1, -2, hc);
      H(tx + 1, -1, hc);
      H(tx + 2, -1, hcD);
      H(tx + 2, 0, hcD);
      pc.circle(tx + 2.5, HY + 2, 1.5, '#ffffff');
      break;
    }
  }
}

function makeFrame(L: LookDef, dir: DirKey, frame: number, expr: Expr, pose: Pose = 'none'): PixelCanvas {
  const pc = new PixelCanvas(FRAME_W, FRAME_H);
  paintFrame(pc, L, dir, frame, expr, pose);
  pc.outline(OUTLINE);
  return pc;
}

const sheetCache = new Map<string, HTMLCanvasElement>();

export function characterKey(look: number) {
  return `char-v2-${look}`;
}

/** 캐릭터 스프라이트 시트(캔버스) 생성 — 결과는 캐시됩니다 */
export function buildCharacterSheet(lookIdx: number): HTMLCanvasElement {
  const look = LOOKS[lookIdx] ? lookIdx : 0;
  const key = characterKey(look);
  const hit = sheetCache.get(key);
  if (hit) return hit;
  const L = LOOKS[look];
  const sheet = new PixelCanvas(FRAME_W * SHEET_COLS, FRAME_H * DIR_ROWS.length);
  (['d', 'u', 's'] as const).forEach((dir, row) => {
    for (let f = 0; f < SHEET_COLS; f++) sheet.blit(makeFrame(L, dir, f, f === 1 ? 'blink' : 'normal'), f * FRAME_W, row * FRAME_H);
  });
  const exprs: Expr[] = ['happy', 'hot', 'relax', 'chew', 'chew2', 'relax'];
  exprs.forEach((e, f) => sheet.blit(makeFrame(L, 'd', f === 5 ? 3 : 0, e), f * FRAME_W, 3 * FRAME_H));
  const poses: [Pose, Expr][] = [
    ['sit', 'normal'],
    ['waveA', 'happy'],
    ['waveB', 'happy'],
    ['v', 'happy'],
    ['surprised', 'wow'],
    ['sit', 'hot'],
  ];
  poses.forEach(([p, e], f) => sheet.blit(makeFrame(L, 'd', 0, e, p), f * FRAME_W, 4 * FRAME_H));
  sheet.blit(makeFrame(L, 'u', 0, 'normal', 'sit'), 0, 5 * FRAME_H);
  sheet.blit(makeFrame(L, 's', 0, 'normal', 'sit'), FRAME_W, 5 * FRAME_H);
  sheet.blit(makeFrame(L, 'd', 0, 'happy', 'push'), 2 * FRAME_W, 5 * FRAME_H);
  sheet.blit(makeFrame(L, 'd', 1, 'happy', 'push'), 3 * FRAME_W, 5 * FRAME_H);
  const canvas = sheet.flush();
  sheetCache.set(key, canvas);
  return canvas;
}
