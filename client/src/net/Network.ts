/**
 * Socket.IO 연결 래퍼.
 * - 자동 재연결 (Socket.IO 기본 기능)
 * - 세션 토큰 저장 → 새로고침/재연결 시 같은 캐릭터로 복귀
 * - 기기 키(uid) 저장 → 게시물·댓글 소유권과 운영자 팀 배정이 재접속 후에도 유지
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, JoinResult, MoveInput, Profile, ServerToClientEvents, SpectateResult } from '../../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ?slot=2 처럼 붙이면 한 브라우저에서 캐릭터를 여러 개 따로 저장해 테스트할 수 있어요
const SLOT = new URLSearchParams(location.search).get('slot')?.replace(/[^a-z0-9]/gi, '').slice(0, 8) ?? '';
const SUFFIX = SLOT ? ':' + SLOT : '';
const SESSION_KEY = `azit.session.v1${SUFFIX}`;
const PROFILE_KEY = `azit.profile.v1${SUFFIX}`;
const UID_KEY = `azit.uid.v1${SUFFIX}`;
const PREF_KEY = `azit.prefs.v1${SUFFIX}`;

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function safeSet(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 사생활 보호 모드 등에서는 저장 생략 */
  }
}

export interface Prefs {
  hideNames: boolean;
  noPrank: boolean;
}

export const Storage = {
  get token(): string | null {
    return safeGet<{ token: string }>(SESSION_KEY)?.token ?? null;
  },
  set token(v: string | null) {
    safeSet(SESSION_KEY, v ? { token: v, at: Date.now() } : null);
  },
  get profile(): Profile | null {
    return safeGet<Profile>(PROFILE_KEY);
  },
  set profile(v: Profile | null) {
    safeSet(PROFILE_KEY, v);
  },
  /** 이 브라우저의 고유 키 (처음 한 번 생성) */
  get uid(): string {
    let u = safeGet<string>(UID_KEY);
    if (!u) {
      u =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      safeSet(UID_KEY, u);
    }
    return u;
  },
  get prefs(): Prefs {
    return { hideNames: false, noPrank: false, ...(safeGet<Partial<Prefs>>(PREF_KEY) ?? {}) };
  },
  set prefs(v: Prefs) {
    safeSet(PREF_KEY, v);
  },
};

type Ack<E extends keyof ClientToServerEvents> = ClientToServerEvents[E] extends (...a: infer A) => void
  ? A extends [...unknown[], (res: infer R) => void]
    ? R
    : never
  : never;

export class Network {
  readonly socket: GameSocket;

  constructor() {
    this.socket = io({
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      timeout: 8000,
      autoConnect: true,
    });
  }

  get connected() {
    return this.socket.connected;
  }

  waitConnected(timeoutMs = 10000): Promise<boolean> {
    if (this.socket.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.socket.off('connect', ok);
        resolve(false);
      }, timeoutMs);
      const ok = () => {
        clearTimeout(t);
        resolve(true);
      };
      this.socket.once('connect', ok);
    });
  }

  /** ack 가 있는 요청 (시간 초과 시 실패 응답) */
  req<E extends keyof ClientToServerEvents>(ev: E, ...args: unknown[]): Promise<Ack<E> | { ok: false; reason: string }> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, reason: '서버 응답이 없어요. 네트워크를 확인해주세요.' }), 6000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.socket.emit as any)(ev, ...args, (r: Ack<E>) => {
        clearTimeout(t);
        resolve(r);
      });
    });
  }

  join(profile: Profile, pos?: { x: number; y: number }) {
    return this.req('join', { profile, uid: Storage.uid, pos }) as Promise<JoinResult>;
  }

  resume(token: string) {
    return this.req('resume', { token, uid: Storage.uid }) as Promise<JoinResult>;
  }

  spectate() {
    return this.req('spectate') as Promise<SpectateResult>;
  }

  act(req: Parameters<ClientToServerEvents['act']>[0]) {
    return this.req('act', req) as Promise<{ ok: true } | { ok: false; reason: string }>;
  }

  sendMove(input: MoveInput) {
    if (this.socket.connected) this.socket.volatile.emit('m', input);
  }

  leave() {
    this.socket.emit('leave');
  }
}
