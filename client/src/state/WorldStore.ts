/**
 * 클라이언트 측 월드 상태.
 * 서버 이벤트를 받아 참가자 목록과 위치 샘플(보간용)을 관리합니다.
 * 화면(Phaser)과 UI(HUD)는 이 저장소만 바라봅니다.
 */
import { INTERP_DELAY_MS, TICK_HZ } from '../../../shared/constants';
import type {
  BoardNote,
  Dir,
  FoodId,
  LeaveReason,
  PlayerInfo,
  PlayerPatch,
  PlayerState,
  PresenceStatus,
  RoomSnapshot,
} from '../../../shared/protocol';
import type { GameSocket } from '../net/Network';
import { Emitter } from './Emitter';

export interface Sample {
  t: number;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
}

export interface PlayerEntry {
  info: PlayerInfo;
  samples: Sample[];
}

type StoreEvents = {
  reset: [];
  join: [PlayerInfo];
  leave: [PlayerInfo, LeaveReason];
  status: [PlayerInfo, PresenceStatus];
  count: [number];
  correct: [number, number];
  /** 음식·온천 등 상태 변경 */
  patch: [PlayerInfo, PlayerPatch];
  /** 먹기 시작 */
  eat: [PlayerInfo, FoodId];
  /** 새 게시판 쪽지 */
  note: [BoardNote];
};

const TICK_MS = 1000 / TICK_HZ;

export class WorldStore extends Emitter<StoreEvents> {
  readonly players = new Map<number, PlayerEntry>();
  selfId: number | null = null;
  /** 로컬 시각 - 서버 시각 (지연 포함 추정치) */
  private offset: number | null = null;

  bind(socket: GameSocket) {
    socket.on('s', (t, states) => this.onStates(t, states));
    socket.on('pj', (info) => this.add(info, true));
    socket.on('pl', (id, reason) => {
      const e = this.players.get(id);
      if (!e) return;
      this.players.delete(id);
      this.emit('leave', e.info, reason);
      this.emit('count', this.onlineCount);
    });
    socket.on('ps', (id, status) => {
      const e = this.players.get(id);
      if (!e) return;
      e.info.status = status;
      if (status === 'away') e.info.moving = false;
      this.emit('status', e.info, status);
      this.emit('count', this.onlineCount);
    });
    socket.on('cx', (x, y) => this.emit('correct', x, y));
    socket.on('pu', (id, patch) => {
      const e = this.players.get(id);
      if (!e) return;
      Object.assign(e.info, patch);
      if (patch.x !== undefined && patch.y !== undefined) {
        // 순간 이동 (온천 들어가기/나오기): 보간 기록을 새 위치로 초기화
        const t = this.renderTime() + INTERP_DELAY_MS;
        e.samples = [{ t, x: patch.x, y: patch.y, dir: e.info.dir, moving: false }];
      }
      this.emit('patch', e.info, patch);
    });
    socket.on('pe', (id, food) => {
      const e = this.players.get(id);
      if (e) this.emit('eat', e.info, food);
    });
    socket.on('bn', (note) => this.emit('note', note));
  }

  reset(room: RoomSnapshot, selfId: number | null) {
    this.players.clear();
    this.selfId = selfId;
    this.offset = Date.now() - room.serverTime;
    for (const p of room.players) this.add(p, false);
    this.emit('reset');
    this.emit('count', this.onlineCount);
  }

  get self(): PlayerInfo | null {
    return this.selfId == null ? null : this.players.get(this.selfId)?.info ?? null;
  }

  get onlineCount() {
    let n = 0;
    for (const e of this.players.values()) if (e.info.status === 'online') n++;
    return n;
  }

  /** 보간에 사용할 '서버 기준' 렌더 시각 */
  renderTime(now = Date.now()) {
    return now - (this.offset ?? 0) - INTERP_DELAY_MS;
  }

  private add(info: PlayerInfo, announce: boolean) {
    const existing = this.players.get(info.id);
    const t = this.renderTime() + INTERP_DELAY_MS;
    const sample: Sample = { t, x: info.x, y: info.y, dir: info.dir, moving: info.moving };
    if (existing) {
      existing.info = info;
      existing.samples = [sample];
      return;
    }
    this.players.set(info.id, { info, samples: [sample] });
    if (announce) {
      this.emit('join', info);
      this.emit('count', this.onlineCount);
    }
  }

  private onStates(t: number, states: PlayerState[]) {
    const sampleOffset = Date.now() - t;
    if (this.offset == null || sampleOffset < this.offset) this.offset = sampleOffset;
    else this.offset += (sampleOffset - this.offset) * 0.02; // 천천히 따라감
    for (const [id, x, y, dir, moving] of states) {
      const e = this.players.get(id);
      if (!e) continue;
      e.info.x = x;
      e.info.y = y;
      e.info.dir = dir;
      e.info.moving = !!moving;
      if (id === this.selfId) continue;
      const last = e.samples[e.samples.length - 1];
      // 한동안 멈춰 있다가 움직이기 시작하면, 직전 위치를 한 틱 전에 복제해 끊김 방지
      if (last && t - last.t > TICK_MS * 2.5) e.samples.push({ ...last, t: t - TICK_MS });
      e.samples.push({ t, x, y, dir, moving: !!moving });
      if (e.samples.length > 40) e.samples.splice(0, e.samples.length - 40);
    }
  }

  /** 렌더 시각 기준으로 보간된 위치 */
  sample(e: PlayerEntry, renderT: number): Sample {
    const s = e.samples;
    if (s.length === 0) return { t: renderT, x: e.info.x, y: e.info.y, dir: e.info.dir, moving: false };
    // 오래된 샘플 정리 (보간 구간 하나는 남김)
    while (s.length > 2 && s[1].t <= renderT) s.shift();
    const a = s[0];
    const b = s[1];
    if (!b || renderT <= a.t) {
      if (!b && renderT - a.t > 250) return { ...a, moving: false };
      return a;
    }
    const k = Math.min(1, Math.max(0, (renderT - a.t) / Math.max(1, b.t - a.t)));
    return {
      t: renderT,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      dir: k < 0.5 ? a.dir : b.dir,
      moving: b.moving || a.moving,
    };
  }
}
