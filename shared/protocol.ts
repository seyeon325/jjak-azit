/**
 * 네트워크 프로토콜 정의 (클라이언트 ↔ 서버).
 * 이벤트를 추가할 때는 여기에 타입을 먼저 선언하면 양쪽에서 자동완성/검사가 됩니다.
 */

export type Role = 'senior' | 'junior';
/** 0: 아래, 1: 위, 2: 왼쪽, 3: 오른쪽 */
export type Dir = 0 | 1 | 2 | 3;
export type PresenceStatus = 'online' | 'away';

export interface Profile {
  nickname: string;
  role: Role;
  /** 외형 번호 (0 ~ LOOK_COUNT-1) */
  look: number;
  /** 옷 색상 번호 (0 ~ COLOR_COUNT-1) */
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
}

/** 위치 압축 표현: [id, x, y, dir, moving] */
export type PlayerState = [id: number, x: number, y: number, dir: Dir, moving: 0 | 1];
/** 클라이언트가 보내는 내 위치: [x, y, dir, moving] */
export type MoveInput = [x: number, y: number, dir: Dir, moving: 0 | 1];

export interface RoomSnapshot {
  roomId: string;
  serverTime: number;
  players: PlayerInfo[];
}

export type JoinResult =
  | { ok: true; selfId: number; token: string; room: RoomSnapshot }
  | { ok: false; reason: string };

export type SpectateResult = { ok: true; room: RoomSnapshot } | { ok: false; reason: string };

export type LeaveReason = 'left' | 'timeout';

export interface ClientToServerEvents {
  /** 새 캐릭터로 입장 */
  join: (payload: { profile: Profile; /** 재입장 시 마지막 위치 (서버가 검증) */ pos?: { x: number; y: number } }, ack: (res: JoinResult) => void) => void;
  /** 새로고침/재접속 시 기존 세션으로 복귀 */
  resume: (payload: { token: string }, ack: (res: JoinResult) => void) => void;
  /** 운영자 관전 화면으로 접속 (인원 수에 포함되지 않음) */
  spectate: (ack: (res: SpectateResult) => void) => void;
  /** 내 위치 전송 */
  m: (input: MoveInput) => void;
  /** 명시적으로 퇴장 */
  leave: () => void;
}

export interface ServerToClientEvents {
  /** 위치 스냅샷: 서버 시각 + 이번 틱에 바뀐 참가자들 */
  s: (serverTime: number, states: PlayerState[]) => void;
  /** 참가자 입장 */
  pj: (info: PlayerInfo) => void;
  /** 참가자 퇴장 */
  pl: (id: number, reason: LeaveReason) => void;
  /** 참가자 연결 상태 변화 (잠시 끊김 / 복귀) */
  ps: (id: number, status: PresenceStatus) => void;
  /** 서버가 내 위치를 보정할 때 */
  cx: (x: number, y: number) => void;
  /** 같은 캐릭터로 다른 탭/기기에서 접속해 이 연결이 대체됨 */
  replaced: () => void;
}
