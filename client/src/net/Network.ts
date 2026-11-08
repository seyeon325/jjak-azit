/**
 * Socket.IO 연결 래퍼.
 * - 자동 재연결 (Socket.IO 기본 기능)
 * - 세션 토큰 저장 → 새로고침/재연결 시 같은 캐릭터로 복귀
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  JoinResult,
  MoveInput,
  Profile,
  ServerToClientEvents,
  SpectateResult,
} from '../../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ?slot=2 처럼 붙이면 한 브라우저에서 캐릭터를 여러 개 따로 저장해 테스트할 수 있어요
const SLOT = new URLSearchParams(location.search).get('slot')?.replace(/[^a-z0-9]/gi, '').slice(0, 8) ?? '';
const SESSION_KEY = `azit.session.v1${SLOT ? ':' + SLOT : ''}`;
const PROFILE_KEY = `azit.profile.v1${SLOT ? ':' + SLOT : ''}`;

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
};

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

  private call<T>(fn: (ack: (r: T) => void) => void, timeoutMs = 6000): Promise<T | { ok: false; reason: string }> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, reason: '서버 응답이 없어요. 네트워크를 확인해주세요.' }), timeoutMs);
      fn((r) => {
        clearTimeout(t);
        resolve(r);
      });
    });
  }

  join(profile: Profile, pos?: { x: number; y: number }): Promise<JoinResult> {
    return this.call<JoinResult>((ack) => this.socket.emit('join', { profile, pos }, ack));
  }

  resume(token: string): Promise<JoinResult> {
    return this.call<JoinResult>((ack) => this.socket.emit('resume', { token }, ack));
  }

  spectate(): Promise<SpectateResult> {
    return this.call<SpectateResult>((ack) => this.socket.emit('spectate', ack));
  }

  sendMove(input: MoveInput) {
    if (this.socket.connected) this.socket.volatile.emit('m', input);
  }

  leave() {
    this.socket.emit('leave');
  }
}
