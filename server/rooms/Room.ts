import type { Server } from 'socket.io';
import { MOVE_SPEED, TICK_HZ } from '../../shared/constants';
import type {
  ClientToServerEvents,
  LeaveReason,
  MoveInput,
  PlayerInfo,
  PlayerState,
  PresenceStatus,
  RoomSnapshot,
  ServerToClientEvents,
} from '../../shared/protocol';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

interface PlayerRecord {
  info: PlayerInfo;
  dirty: boolean;
  lastMoveAt: number;
  /** 초당 메시지 수 제한용 */
  windowStart: number;
  windowCount: number;
}

/**
 * 룸(공간) 하나의 참가자 상태와 위치 브로드캐스트를 담당합니다.
 * 광장 외의 공간(예: 3차 '과제 괴물' 레이드)은 이 클래스를 상속해 만듭니다.
 */
export class Room {
  readonly channel: string;
  protected players = new Map<number, PlayerRecord>();
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;

  constructor(readonly id: string, protected io: IO) {
    this.channel = `room:${id}`;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get size() {
    return this.players.size;
  }

  get onlineCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.info.status === 'online') n++;
    return n;
  }

  has(id: number) {
    return this.players.has(id);
  }

  get(id: number): PlayerInfo | undefined {
    return this.players.get(id)?.info;
  }

  snapshot(): RoomSnapshot {
    return {
      roomId: this.id,
      serverTime: Date.now(),
      players: [...this.players.values()].map((p) => ({ ...p.info })),
    };
  }

  addPlayer(info: PlayerInfo) {
    const now = Date.now();
    this.players.set(info.id, { info, dirty: false, lastMoveAt: now, windowStart: now, windowCount: 0 });
    this.io.to(this.channel).emit('pj', { ...info });
  }

  removePlayer(id: number, reason: LeaveReason) {
    if (!this.players.delete(id)) return;
    this.io.to(this.channel).emit('pl', id, reason);
  }

  setStatus(id: number, status: PresenceStatus) {
    const rec = this.players.get(id);
    if (!rec || rec.info.status === status) return;
    rec.info.status = status;
    if (status === 'away') rec.info.moving = false;
    this.io.to(this.channel).emit('ps', id, status);
  }

  /** 이동 입력 처리. 받아들일 수 없는 위치면 보정 좌표를 반환합니다. */
  handleMove(id: number, input: MoveInput): { x: number; y: number } | null {
    const rec = this.players.get(id);
    if (!rec) return null;
    const now = Date.now();
    if (now - rec.windowStart > 1000) {
      rec.windowStart = now;
      rec.windowCount = 0;
    }
    if (++rec.windowCount > 40) return null; // 과도한 전송은 무시

    const [x, y, dir, moving] = input;
    const info = rec.info;
    const dt = Math.min(1, Math.max(0, (now - rec.lastMoveAt) / 1000));
    const allowed = MOVE_SPEED * dt * 1.6 + 14;
    const dist = Math.hypot(x - info.x, y - info.y);
    if (dist > allowed || !this.canStand(x, y)) {
      rec.lastMoveAt = now;
      return { x: info.x, y: info.y };
    }
    rec.lastMoveAt = now;
    if (info.x !== x || info.y !== y || info.dir !== dir || info.moving !== !!moving) {
      info.x = x;
      info.y = y;
      info.dir = dir;
      info.moving = !!moving;
      rec.dirty = true;
    }
    return null;
  }

  /** 하위 클래스에서 맵 충돌 규칙을 제공합니다 */
  protected canStand(_x: number, _y: number): boolean {
    return true;
  }

  protected tick() {
    const states: PlayerState[] = [];
    // 3초마다 전체 위치를 한 번 더 보내 유실된 패킷을 보정
    const full = ++this.tickCount % (TICK_HZ * 3) === 0;
    for (const rec of this.players.values()) {
      if (!rec.dirty && !full) continue;
      rec.dirty = false;
      const p = rec.info;
      states.push([p.id, p.x, p.y, p.dir, p.moving ? 1 : 0]);
    }
    if (!states.length) return;
    if (full) this.io.to(this.channel).emit('s', Date.now(), states);
    else this.io.to(this.channel).volatile.emit('s', Date.now(), states);
  }
}
