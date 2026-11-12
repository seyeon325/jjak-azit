/**
 * 네트워크 프로토콜 정의 (클라이언트 ↔ 서버).
 * 이벤트를 추가할 때는 여기에 타입을 먼저 선언하면 양쪽에서 자동완성/검사가 됩니다.
 */
import type { EggAdminRow, EggEvent, EggId, HsState, LuckyInfo, MyTitles, PairInfo, PairTeam, PrizePool, PrizeSummary, StageState } from './events';
import type { RaidAdminInfo, RaidInput, RaidState, RaidFx } from './raid';
import type { SwingState } from './playground';
import type { EmoteId, InteractionId, PoseId } from './social';

export type Role = 'senior' | 'junior';
/** 학년: 1~4, 0 = 기타(직접 입력) */
export type Grade = 0 | 1 | 2 | 3 | 4;
/** 0: 아래, 1: 위, 2: 왼쪽, 3: 오른쪽 */
export type Dir = 0 | 1 | 2 | 3;
export type PresenceStatus = 'online' | 'away';

export const FOOD_IDS = ['sumung', 'takoyaki', 'icecream', 'hotdog', 'bungeo', 'cotton'] as const;
export type FoodId = (typeof FOOD_IDS)[number];

export interface Profile {
  nickname: string;
  role: Role;
  grade: Grade;
  /** 학년 '기타'일 때 직접 입력한 소속 (예: 교수, 조교, 졸업생) */
  gradeText?: string;
  /** 팀 번호 0~5, -1 = 미정 */
  team?: number;
  /** 캐릭터 번호 (0 ~ LOOK_COUNT-1) */
  look: number;
  /** 이전 버전 호환용 (현재는 0) */
  color: number;
}

export interface PlayerInfo extends Profile {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  status: PresenceStatus;
  joinedAt: number;
  gradeText: string;
  team: number;
  /** 손에 든 음식 */
  food: FoodId | null;
  /** 지금 먹는 중 */
  eating: boolean;
  /** 온천에 들어가 있음 */
  bath: boolean;
  /** 앉아 있는 좌석·놀이기구 (SEATS 의 id) */
  seat: string | null;
  /** 따라가는 상대 */
  followId: number | null;
  /** 장난(물풍선·뿅망치·그네 밀기 등) 받지 않기 */
  noPrank: boolean;
  /** 학회장(운영자 인증한 참가자) */
  host: boolean;
  /** 장착한 칭호 (이스터에그 id) */
  title: EggId | null;
}

/** 참가자 상태 일부 변경 */
export type PlayerPatch = Partial<
  Pick<PlayerInfo, 'food' | 'eating' | 'bath' | 'x' | 'y' | 'seat' | 'followId' | 'noPrank' | 'team' | 'gradeText' | 'host' | 'title'>
>;

/** 위치 압축 표현: [id, x, y, dir, moving] */
export type PlayerState = [id: number, x: number, y: number, dir: Dir, moving: 0 | 1];
/** 클라이언트가 보내는 내 위치: [x, y, dir, moving] */
export type MoveInput = [x: number, y: number, dir: Dir, moving: 0 | 1];

export interface RoomSnapshot {
  roomId: string;
  serverTime: number;
  players: PlayerInfo[];
  /** 그네 진자 상태 (좌석 id → 진폭·위상) */
  swings: Record<string, SwingState>;
  display: DisplaySettings;
  teamNames: string[];
  /** 학회장을 찾아라! 진행 상태 */
  hs: HsState;
  /** 빔프로젝터 무대 (가챠·행운 추첨) */
  stage: StageState;
  /** 과제 괴물 레이드 */
  raid: RaidState;
}

export type JoinResult =
  | { ok: true; selfId: number; token: string; room: RoomSnapshot; muted: boolean }
  | { ok: false; reason: string };

export type SpectateResult = { ok: true; room: RoomSnapshot } | { ok: false; reason: string };

export type LeaveReason = 'left' | 'timeout';

/** 상호작용 요청 (음식·온천·좌석·미끄럼틀·그네 밀기) */
export type ActRequest =
  | { t: 'food'; food: FoodId }
  | { t: 'eat' }
  | { t: 'bath'; on: boolean }
  | { t: 'sit'; seat: string }
  | { t: 'stand' }
  | { t: 'slide' }
  | { t: 'push'; seat: string }
  | { t: 'secret' };
export type ActResult = { ok: true } | { ok: false; reason: string };

// ------------------------------------------------------------------ 게시판

export interface BoardNote {
  id: number;
  /** 익명이면 '익명' */
  nickname: string;
  anon: boolean;
  role: Role | null;
  grade: Grade | null;
  gradeText: string;
  team: number;
  look: number;
  text: string;
  /** 포스트잇 색 (0~4) */
  color: number;
  at: number;
  editedAt: number | null;
  likes: number;
  comments: number;
}

export interface BoardComment {
  id: number;
  noteId: number;
  nickname: string;
  role: Role;
  grade: Grade;
  gradeText: string;
  team: number;
  text: string;
  at: number;
  editedAt: number | null;
}

/** 내 글/댓글/공감 표시용 */
export interface BoardMine {
  notes: number[];
  comments: number[];
  liked: number[];
}

export type BoardResult<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

// ------------------------------------------------------------------ 채팅

export type ChatChannel = 'all' | 'fire' | 'bench' | 'table';
export interface ChatMessage {
  ch: ChatChannel;
  from: number;
  nickname: string;
  text: string;
  at: number;
}

export interface FxEvent {
  kind: InteractionId | 'launch' | 'slide';
  from: number;
  to?: number;
  /** launch: 시작 위치 */
  x?: number;
  y?: number;
  at: number;
}

export interface RequestEvent {
  reqId: number;
  kind: 'dance' | 'follow';
  from: number;
  nickname: string;
}

// ------------------------------------------------------------------ 운영자

export interface DisplaySettings {
  hideNames: boolean;
  hideTeams: boolean;
  hideBubbles: boolean;
  /** 단체 사진 모드 (닉네임·말풍선·관전 UI 숨김) */
  photo: boolean;
}

export interface AdminPlayer extends PlayerInfo {
  muted: boolean;
  ownerKey: string;
}

export interface AdminNote extends BoardNote {
  author: string;
  ownerKey: string;
  commentList: (BoardComment & { ownerKey: string })[];
}

export interface AdminHsInfo {
  ok: true;
  state: HsState;
  /** 학회장으로 숨을 수 있는 참가자 (참가자 화면에서 학회장 로그인한 사람) */
  hosts: { id: number; nickname: string; online: boolean }[];
  /** 진행 중인 회차의 학회장 */
  hostId: number | null;
}

export interface ClientToServerEvents {
  /** 새 캐릭터로 입장. uid = 브라우저에 저장된 기기 키 (게시물 소유권 유지용) */
  join: (
    payload: { profile: Profile; uid?: string; pos?: { x: number; y: number } },
    ack: (res: JoinResult) => void,
  ) => void;
  /** 새로고침/재접속 시 기존 세션으로 복귀 */
  resume: (payload: { token: string; uid?: string }, ack: (res: JoinResult) => void) => void;
  /** 관전 화면으로 접속 (인원 수에 포함되지 않음) */
  spectate: (ack: (res: SpectateResult) => void) => void;
  m: (input: MoveInput) => void;
  act: (req: ActRequest, ack: (res: ActResult) => void) => void;

  // 소셜
  chat: (payload: { ch: ChatChannel; text: string }, ack: (res: ActResult) => void) => void;
  emote: (kind: EmoteId) => void;
  pose: (kind: PoseId) => void;
  interact: (payload: { kind: InteractionId; target: number }, ack: (res: ActResult) => void) => void;
  respond: (payload: { reqId: number; accept: boolean }) => void;
  unfollow: () => void;
  setPref: (payload: { noPrank?: boolean }) => void;
  fireQuestion: (payload: { next: boolean }, ack: (res: { question: string }) => void) => void;

  // 게시판
  boardList: (ack: (res: { notes: BoardNote[]; mine: BoardMine }) => void) => void;
  boardPost: (payload: { text: string; color: number; anon: boolean }, ack: (res: BoardResult<{ note: BoardNote }>) => void) => void;
  boardEdit: (payload: { id: number; text: string }, ack: (res: BoardResult) => void) => void;
  boardDelete: (payload: { id: number }, ack: (res: BoardResult) => void) => void;
  boardLike: (payload: { id: number }, ack: (res: BoardResult<{ liked: boolean; likes: number }>) => void) => void;
  boardComments: (payload: { id: number }, ack: (res: { comments: BoardComment[]; mine: number[] }) => void) => void;
  commentPost: (payload: { noteId: number; text: string }, ack: (res: BoardResult<{ comment: BoardComment }>) => void) => void;
  commentEdit: (payload: { id: number; text: string }, ack: (res: BoardResult) => void) => void;
  commentDelete: (payload: { id: number }, ack: (res: BoardResult) => void) => void;

  // 운영자 (서버에서 권한 검증)
  adminAuth: (payload: { token: string }, ack: (res: ActResult) => void) => void;
  adminPlayers: (ack: (res: AdminPlayer[]) => void) => void;
  adminSetTeam: (payload: { id: number; team: number }, ack: (res: ActResult) => void) => void;
  adminMute: (payload: { id: number; muted: boolean }, ack: (res: ActResult) => void) => void;
  adminNotice: (payload: { text: string }, ack: (res: ActResult) => void) => void;
  adminDisplay: (payload: Partial<DisplaySettings>, ack: (res: ActResult) => void) => void;
  adminTeamNames: (payload: { names: string[] }, ack: (res: ActResult) => void) => void;
  adminBoard: (ack: (res: AdminNote[]) => void) => void;
  adminDeleteNote: (payload: { id: number }, ack: (res: ActResult) => void) => void;
  adminDeleteComment: (payload: { id: number }, ack: (res: ActResult) => void) => void;

  // 학회장을 찾아라! (시작·종료는 운영자만, 발견 판정은 서버)
  hsFind: (ack: (res: ActResult) => void) => void;
  adminHs: (
    payload: { cmd: 'start' | 'end' | 'cancel' | 'reset'; searchSec?: number; hostId?: number },
    ack: (res: ActResult) => void,
  ) => void;
  adminHsInfo: (ack: (res: AdminHsInfo | { ok: false; reason: string }) => void) => void;

  // 상품
  adminPrizes: (ack: (res: PrizeSummary | { ok: false; reason: string }) => void) => void;
  adminPrizeSet: (
    payload:
      | { op: 'paid'; awardId: number; paid: boolean }
      | { op: 'revoke'; awardId: number }
      | { op: 'alloc'; itemId: string; total: number; alloc: Partial<Record<PrizePool, number>> },
    ack: (res: ActResult) => void,
  ) => void;

  // 이스터에그 · 칭호
  myTitles: (ack: (res: MyTitles) => void) => void;
  setTitle: (payload: { id: EggId | null }, ack: (res: ActResult) => void) => void;
  adminEggs: (ack: (res: EggAdminRow[] | { ok: false; reason: string }) => void) => void;
  adminEggSet: (
    payload: { id: EggId; enabled?: boolean; need?: number; broadcast?: boolean; reset?: boolean },
    ack: (res: ActResult) => void,
  ) => void;

  // 우수 PAIR 경품 가챠 · 오늘의 행운 추첨 · 무대 화면 (학회장만)
  adminPairInfo: (ack: (res: PairInfo | { ok: false; reason: string }) => void) => void;
  adminPair: (
    payload:
      | { op: 'save'; teams: PairTeam[] }
      | { op: 'select' | 'draw' | 'redraw'; teamId: string }
      | { op: 'reset' | 'summary' },
    ack: (res: ActResult) => void,
  ) => void;
  adminLuckyInfo: (ack: (res: LuckyInfo | { ok: false; reason: string }) => void) => void;
  adminLucky: (
    payload: { op: 'ready' | 'draw' | 'reveal' | 'summary' } | { op: 'exclude'; value: boolean },
    ack: (res: ActResult) => void,
  ) => void;
  adminStage: (payload: { op: 'clear' }, ack: (res: ActResult) => void) => void;

  // 과제 괴물 레이드
  raidJoin: (ack: (res: ActResult) => void) => void;
  raidLeave: () => void;
  /** 이동·행동 입력 */
  ri: (input: RaidInput) => void;
  adminRaid: (
    payload: { op: 'open' | 'start' | 'pause' | 'resume' | 'stop' | 'reset' | 'awards' | 'next' | 'prev' | 'allAwards' | 'close' | 'debugHp' | 'debugDown' | 'debugCalm' | 'debugHazard'; ratio?: number; id?: number },
    ack: (res: ActResult) => void,
  ) => void;
  adminRaidInfo: (ack: (res: RaidAdminInfo | { ok: false; reason: string }) => void) => void;

  leave: () => void;
}

export interface ServerToClientEvents {
  s: (serverTime: number, states: PlayerState[]) => void;
  pj: (info: PlayerInfo) => void;
  pl: (id: number, reason: LeaveReason) => void;
  ps: (id: number, status: PresenceStatus) => void;
  pu: (id: number, patch: PlayerPatch) => void;
  pe: (id: number, food: FoodId) => void;
  cx: (x: number, y: number) => void;
  replaced: () => void;

  // 소셜
  chat: (msg: ChatMessage) => void;
  emote: (id: number, kind: EmoteId) => void;
  pose: (id: number, kind: PoseId, at: number) => void;
  fx: (ev: FxEvent) => void;
  req: (ev: RequestEvent) => void;
  /** 내가 보낸 요청 결과 / 안내 */
  info: (text: string) => void;
  swing: (seat: string, st: SwingState) => void;
  fireQ: (question: string) => void;
  notice: (text: string) => void;
  display: (d: DisplaySettings) => void;
  teamNames: (names: string[]) => void;
  muted: (muted: boolean) => void;
  /** 학회장을 찾아라! 상태 */
  hs: (st: HsState) => void;
  /** 이스터에그 최초 달성 (전체 공개 설정이면 모두에게, 아니면 달성자에게만) */
  egg: (ev: EggEvent) => void;
  /** 무대 화면 (가챠·행운 추첨) */
  stage: (st: StageState) => void;
  /** 레이드 전체 상태 (초당 10번) */
  raid: (st: RaidState) => void;
  /** 레이드 일회성 연출 (공격·피격 등) */
  rfx: (fx: RaidFx[]) => void;

  // 게시판
  bn: (note: BoardNote) => void;
  bu: (note: BoardNote) => void;
  bd: (id: number) => void;
  cn: (c: BoardComment) => void;
  cu: (c: BoardComment) => void;
  cdel: (noteId: number, id: number) => void;
}
