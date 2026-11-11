/**
 * 과제 괴물을 물리쳐라! — 20~30인 협동 보스 레이드 (서버·클라이언트 공용 정의)
 * 서버가 보스 체력·패턴·피격·협동·통계를 모두 판정하고, 클라이언트는 입력과 연출만 맡습니다.
 */

export type RaidPhase = 'off' | 'lobby' | 'countdown' | 'battle' | 'victory' | 'defeat' | 'awards';

export const RAID = {
  /** 전투장 크기 (px, 아지트 픽셀과 같은 단위) */
  W: 480,
  H: 300,
  bossX: 240,
  bossY: 96,
  /** 보스 몸 반지름 (이 안으로는 못 들어감) */
  bossR: 30,
  playerHp: 3,
  speed: 86,
  /** 일반 공격 간격·사거리 */
  atkCd: 380,
  atkRange: 190,
  dodgeCd: 1500,
  dodgeMs: 450,
  dodgeDist: 34,
  /** 쓰러졌다가 자동 부활까지 */
  downMs: 7000,
  /** 동료 부활 거리 */
  reviveR: 24,
  /** 전체 제한 시간 */
  battleMs: 4.5 * 60 * 1000,
  countdownMs: 3000,
  /** 최후의 일격 */
  finalMs: 10_000,
  finalRetryMs: 15_000,
  /** 협동 구역 */
  coopR: 22,
  coopHoldMs: 2500,
  /** 체력 비율: 방어막(2페이즈) · 최후의 일격(3페이즈) */
  shieldAt: 0.55,
  finalAt: 0.12,
  /** 특별 시상 최소 참여 시간 */
  minPlayMs: 45_000,
};

/** 참가자 수에 맞춘 보스 체력 (혼자여도 가능, 30명이어도 4~5분) */
export function bossMaxHp(n: number) {
  return Math.round(Math.max(120, n * 130));
}

export type HazardKind = 'bomb' | 'deadline' | 'revision';
export interface RaidHazard {
  id: number;
  kind: HazardKind;
  shape: 'circle' | 'rect';
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  /** 경고 시작 · 실제 공격 시각 (서버 시각) */
  at: number;
  hitAt: number;
}

export interface RaidZone {
  id: number;
  x: number;
  y: number;
  on: boolean;
  /** 0~1 채워지는 정도 */
  p: number;
  /** 지금 안에 있는 인원 */
  n: number;
}

/** [id, x, y, hp, 상태(0 보통 · 1 쓰러짐 · 2 회피 중), 방향] */
export type RaidP = [number, number, number, number, 0 | 1 | 2, number];

export interface RaidAward {
  id: 'destroyer' | 'runner' | 'regular' | 'hidden' | 'dodger' | 'teamplayer';
  title: string;
  desc: string;
  playerId: number | null;
  nickname: string;
  look: number;
  value: string;
}

export const RAID_AWARD_DEF: { id: RaidAward['id']; title: string; desc: string }[] = [
  { id: 'destroyer', title: '과제 파괴왕', desc: '가장 많은 데미지를 준 사람' },
  { id: 'runner', title: '도망의 달인', desc: '공격보다 도망이 바빴던 사람' },
  { id: 'regular', title: '부활 단골손님', desc: '가장 많이 쓰러진 사람' },
  { id: 'hidden', title: '숨은 공신', desc: '동료를 살리고 협동을 도운 사람' },
  { id: 'dodger', title: '회피의 신', desc: '공격을 가장 많이 피한 사람' },
  { id: 'teamplayer', title: '진정한 팀플러', desc: '협동 미션에 가장 많이 참여한 사람' },
];

export interface RaidStats {
  attacks: number;
  hits: number;
  damage: number;
  distance: number;
  evades: number;
  hitTaken: number;
  downs: number;
  revives: number;
  coop: number;
  final: boolean;
  playMs: number;
}

export interface RaidResult {
  victory: boolean;
  timeMs: number;
  players: number;
  totalDamage: number;
  totalDowns: number;
  totalRevives: number;
}

export interface RaidState {
  phase: RaidPhase;
  paused: boolean;
  /** 서버 시각 */
  now: number;
  countdownEnd: number;
  endsAt: number;
  /** 1: 밀린 과제 · 2: 선후배 협동(방어막) · 3: 최후의 일격 */
  stage: 1 | 2 | 3;
  boss: {
    hp: number;
    max: number;
    shield: boolean;
    mood: 'idle' | 'angry' | 'hurt' | 'broken' | 'off';
    /** 보스 화면에 뜨는 알림 */
    msg: string | null;
    x: number;
  };
  players: RaidP[];
  /** 대기실에 들어온 사람 */
  joined: number[];
  zones: RaidZone[];
  zonesNeed: number;
  hazards: RaidHazard[];
  final: { endsAt: number; ids: number[]; need: number } | null;
  /** 화면 가운데 큰 안내 문구 */
  banner: string | null;
  result: RaidResult | null;
  awards: RaidAward[];
  /** 시상식에서 지금까지 공개한 수 */
  shown: number;
}

export const RAID_IDLE: RaidState = {
  phase: 'off',
  paused: false,
  now: 0,
  countdownEnd: 0,
  endsAt: 0,
  stage: 1,
  boss: { hp: 0, max: 0, shield: false, mood: 'idle', msg: null, x: RAID.bossX },
  players: [],
  joined: [],
  zones: [],
  zonesNeed: 0,
  hazards: [],
  final: null,
  banner: null,
  result: null,
  awards: [],
  shown: 0,
};

/** 클라이언트 입력: 위치(초당 10번) + 행동 */
export interface RaidInput {
  x?: number;
  y?: number;
  d?: number;
  a?: 'atk' | 'dodge' | 'revive' | 'final';
}

/** 일회성 연출 */
export interface RaidFx {
  k: 'atk' | 'hit' | 'boom' | 'down' | 'revive' | 'evade' | 'coop' | 'final' | 'shieldOff' | 'pattern';
  id?: number;
  x?: number;
  y?: number;
  v?: number;
  s?: string;
}

export interface RaidAdminInfo {
  ok: true;
  phase: RaidPhase;
  paused: boolean;
  lobby: { id: number; nickname: string; role: string }[];
  stats: ({ id: number; nickname: string } & RaidStats)[];
  history: (RaidResult & { at: number; awards: { title: string; nickname: string }[] })[];
}
