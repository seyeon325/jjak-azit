/**
 * 행사 이벤트 공용 정의 (서버·클라이언트 공용)
 *  - 학회장을 찾아라! (숨바꼭질)
 *  - 이스터에그 · 칭호
 *  - 상품 (배달의민족 상품권 등) 할당·지급 기록
 * 3차의 랜덤 추첨·레이드도 같은 '상품 풀(pool)' 구조에 연결합니다.
 */

// ------------------------------------------------------------------ 숨바꼭질

export type HsPhase = 'ready' | 'hiding' | 'searching' | 'found' | 'timeout' | 'finished' | 'cancelled';

export const HS = {
  /** 학회장이 숨는 시간 */
  hideMs: 15_000,
  /** 기본 수색 시간 */
  searchMs: 120_000,
  minSearchSec: 30,
  maxSearchSec: 600,
  /** '찾았다!!' 가능 거리 (px) */
  findR: 34,
  /** 발견·시간 종료 연출 후 자동으로 마무리되는 시간 */
  foundShowMs: 11_000,
  timeoutShowMs: 9_000,
  /** 학회장이 연결이 끊긴 뒤 이벤트를 취소하기까지 */
  hostGraceMs: 45_000,
};

export interface HsWinner {
  id: number;
  nickname: string;
  /** 이번 우승으로 상품권이 배정됐는지 (이미 지급된 회차면 false) */
  prize: boolean;
}

export interface HsState {
  phase: HsPhase;
  round: number;
  /** 수색 단계부터만 공개 (숨는 동안에는 null) */
  hostId: number | null;
  /** 현재 단계가 끝나는 서버 시각 */
  endsAt: number;
  searchMs: number;
  /** 학회장 연결 끊김으로 일시정지 */
  paused: boolean;
  /** 일시정지 때 남아 있던 시간 */
  leftMs: number;
  winner: HsWinner | null;
  /** 발견·시간 종료 때 공개되는 학회장 위치와 발견자 위치 */
  reveal: { x: number; y: number } | null;
  winnerPos: { x: number; y: number } | null;
}

export const HS_IDLE: HsState = {
  phase: 'ready',
  round: 0,
  hostId: null,
  endsAt: 0,
  searchMs: HS.searchMs,
  paused: false,
  leftMs: 0,
  winner: null,
  reveal: null,
  winnerPos: null,
};

/** 아지트 화면에 영향을 주는 (이름 숨김·이동 제한 등) 단계 */
export function hsActive(p: HsPhase) {
  return p === 'hiding' || p === 'searching' || p === 'found' || p === 'timeout';
}

export const HS_PHASE_LABEL: Record<HsPhase, string> = {
  ready: '준비',
  hiding: '학회장 숨는 중',
  searching: '수색 중',
  found: '발견 성공',
  timeout: '시간 종료',
  finished: '종료',
  cancelled: '강제 종료',
};

// ------------------------------------------------------------------ 이스터에그 · 칭호

export type EggId = 'spring' | 'swing' | 'sumung' | 'fire' | 'dance' | 'prank' | 'secret' | 'explorer';

export interface EggDef {
  id: EggId;
  title: string;
  /** 운영자에게만 보이는 조건 설명 */
  rule: string;
  /** time: 초 / count: 횟수 / once: 한 번 / zones: 모든 주요 공간 방문 */
  kind: 'time' | 'count' | 'once' | 'zones';
  need: number;
  /** 칭호 배지 색 */
  color: string;
}

export const EGGS: EggDef[] = [
  { id: 'spring', title: '온천 지박령', rule: '카피바라 온천에 머문 시간(초)', kind: 'time', need: 60, color: '#7cc9d6' },
  { id: 'swing', title: '그네 중독자', rule: '그네를 2.5초 이상 타고 내린 횟수', kind: 'count', need: 5, color: '#ff9f80' },
  { id: 'sumung', title: '수뭉이빵 애호가', rule: '수뭉이빵을 다 먹은 횟수', kind: 'count', need: 3, color: '#f2b84b' },
  { id: 'fire', title: '모닥불 수호자', rule: '모닥불 구역에 머문 시간(초)', kind: 'time', need: 60, color: '#ff7a59' },
  { id: 'dance', title: '춤신춤왕', rule: '춤추기 동작 횟수 (1.5초 간격 이상)', kind: 'count', need: 10, color: '#c58cf2' },
  { id: 'prank', title: '장난꾸러기', rule: '물풍선·종이비행기·뿅망치·그네 퐁! 성공 횟수', kind: 'count', need: 5, color: '#8fd16a' },
  { id: 'secret', title: '비밀 발견자', rule: '게임 포털 오른쪽의 반짝이는 수정과 상호작용', kind: 'once', need: 1, color: '#5fb3ff' },
  { id: 'explorer', title: '아지트 탐험가', rule: '주요 공간 7곳(광장·게시판·푸드트럭·온천·모닥불·놀이터·포털) 모두 방문', kind: 'zones', need: 7, color: '#ffd84d' },
];

export const EGG_BY_ID = new Map(EGGS.map((e) => [e.id, e]));
export const EGG_IDS = EGGS.map((e) => e.id);

/** 탐험가 업적에 필요한 구역 */
export const EXPLORE_ZONES = ['plaza', 'board', 'foodtruck', 'spring', 'campfire', 'playground', 'portal'];

export interface EggAdminRow {
  id: EggId;
  title: string;
  rule: string;
  kind: EggDef['kind'];
  enabled: boolean;
  need: number;
  /** true: 모든 참가자에게 알림 / false: 달성자에게만 */
  broadcast: boolean;
  winner: { nickname: string; at: number; ownerKey: string } | null;
}

export interface EggEvent {
  id: EggId;
  title: string;
  nickname: string;
  winnerId: number;
}

export interface MyTitles {
  owned: { id: EggId; title: string }[];
  equipped: EggId | null;
}

// ------------------------------------------------------------------ 상품

/** 상품 풀: 어떤 이벤트에 몇 개를 배정했는지 (3차: draw = 랜덤 추첨) */
export type PrizePool = 'hideseek' | 'draw' | 'pair';
export const PRIZE_POOLS: PrizePool[] = ['hideseek', 'draw', 'pair'];
export const POOL_LABEL: Record<PrizePool, string> = { hideseek: '학회장을 찾아라!', draw: '오늘의 행운은 누구에게? (랜덤 3명)', pair: '우수 PAIR 경품 가챠' };

/** 상품 id (서버·화면 공용) */
export const ITEM = { baemin: 'baemin', projector: 'projector', squishy: 'squishy', fishwarmer: 'fishwarmer' } as const;
export const PAIR_ITEMS = [ITEM.projector, ITEM.squishy, ITEM.fishwarmer] as string[];

export interface PrizeItem {
  id: string;
  name: string;
  total: number;
  alloc: Record<PrizePool, number>;
}

export interface PrizeAward {
  id: number;
  pool: PrizePool;
  eventName: string;
  round: number;
  playerId: number;
  ownerKey: string;
  nickname: string;
  at: number;
  itemId: string;
  itemName: string;
  qty: number;
  paid: boolean;
  paidAt: number | null;
  /** 우수 PAIR 가챠: 팀 단위 수상 (개인 참가자 아님) */
  teamId?: string;
}

// ------------------------------------------------------------------ 우수 PAIR 경품 가챠 · 행운 추첨 · 무대 화면

/** 공식 우수 PAIR 팀 (아지트 게임 팀과 별개) */
export interface PairTeam {
  id: string;
  name: string;
  /** 팀원 이름 (쉼표로 구분) */
  members: string;
  /** 대표 색·심볼 (아지트 팀 컬러 0~5, -1 = 없음) */
  badge: number;
}

/** 우수 PAIR 3팀 — 행사 확정 명단 (고정). 가챠에서는 상품만 무작위로 정해짐 */
export const PAIR_TEAMS: readonly PairTeam[] = Object.freeze([
  { id: 'pair1', name: '매화', members: '김승하, 양선은, 김성현', badge: -1 },
  { id: 'pair2', name: '칠면조', members: '황정현, 선채원, 이나영', badge: -1 },
  { id: 'pair3', name: '트민녀들', members: '박세연, 김시현, 김채영', badge: -1 },
]);

export interface GachaLog {
  at: number;
  action: 'draw' | 'redraw' | 'reset' | 'paid';
  teamId: string;
  teamName: string;
  itemId: string;
  itemName: string;
}

export interface PairInfo {
  teams: PairTeam[];
  /** 팀 id → 배정 결과 */
  assigned: Record<string, { awardId: number; itemId: string; itemName: string; at: number; paid: boolean }>;
  /** 아직 남은 상품 */
  remaining: { id: string; name: string }[];
  log: GachaLog[];
}

/** 행운 추첨 공개용 당첨자 (개인정보 없이 화면 표시 정보만) */
export interface StageWinner {
  nickname: string;
  look: number;
  grade: number;
  gradeText: string;
  role: 'senior' | 'junior';
  team: number;
}

export interface LuckyInfo {
  candidates: { id: number; nickname: string; grade: number; gradeText: string; role: 'senior' | 'junior' }[];
  excludeHsWinner: boolean;
  /** 이번 추첨에서 뽑을 인원 (= 남은 할당량) */
  need: number;
  alloc: number;
  used: number;
}

/**
 * 빔프로젝터 무대 화면 상태 (서버가 정하고 모든 관전 화면이 같은 장면을 보여줌)
 * 결과는 연출 시작 전에 서버에서 이미 확정됩니다.
 */
export type StageState =
  | { mode: 'idle'; seq: number }
  | {
      mode: 'gacha';
      seq: number;
      phase: 'ready' | 'spin';
      team: PairTeam;
      /** 이번 가챠 전 남은 상품 (연출용 후보) */
      pool: { id: string; name: string }[];
      result: { id: string; name: string } | null;
      revealAt: number;
      done: number;
      total: number;
    }
  | { mode: 'gachaSummary'; seq: number; results: { team: PairTeam; itemId: string; itemName: string }[] }
  | {
      mode: 'lucky';
      seq: number;
      phase: 'ready' | 'drawn';
      /** 룰렛에 빠르게 지나갈 닉네임 */
      names: string[];
      winners: StageWinner[];
      revealed: number;
      revealAt: number;
      candidateCount: number;
    }
  | { mode: 'luckySummary'; seq: number; winners: StageWinner[] };

export const STAGE_IDLE: StageState = { mode: 'idle', seq: 0 };
/** 가챠: 시작 ~ 공개까지 (준비 1초 + 회전 2.5초 + 공개) */
export const GACHA_SPIN_MS = 3600;
/** 행운 추첨: 이름 룰렛 ~ 당첨자 공개까지 */
export const LUCKY_SPIN_MS = 3200;

export interface HsRoundLog {
  round: number;
  startedAt: number;
  endedAt: number;
  result: 'found' | 'timeout' | 'cancelled';
  winner: string | null;
  prize: boolean;
  hostNickname: string;
}

export interface PrizeSummary {
  items: (PrizeItem & { used: Record<PrizePool, number> })[];
  awards: PrizeAward[];
  rounds: HsRoundLog[];
}
