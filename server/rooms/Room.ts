import type { Server } from 'socket.io';
import { MOVE_SPEED, TICK_HZ } from '../../shared/constants';
import { STAGE_IDLE } from '../../shared/events';
import { RAID_IDLE } from '../../shared/raid';
import type {
  ClientToServerEvents,
  LeaveReason,
  MoveInput,
  PlayerInfo,
  PlayerPatch,
  PlayerState,
  PresenceStatus,
  RoomSnapshot,
  ServerToClientEvents,
} from '../../shared/protocol';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export interface PlayerRecord {
  info: PlayerInfo;
  dirty: boolean;
  lastMoveAt: number;
  /** 초당 메시지 수 제한용 */
  windowStart: number;
  windowCount: number;
  /** 진행 중인 타이머 (먹기 등) */
  timers: NodeJS.Timeout[];
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

  /**
   * 방 전체 상태. viewerId 를 주면 그 사람에게 보여도 되는 정보만 담습니다.
   * (예: 숨바꼭질 숨는 단계에서는 운영자 위치를 운영자 본인에게만)
   */
  snapshot(viewerId: number | null = null): RoomSnapshot {
    return {
      roomId: this.id,
      serverTime: Date.now(),
      players: [...this.players.values()].map((p) => this.maskFor({ ...p.info }, viewerId)),
      ...this.extraSnapshot(),
    };
  }

  /** 하위 클래스: 보는 사람에 따라 참가자 정보를 가림 */
  protected maskFor(p: PlayerInfo, _viewerId: number | null): PlayerInfo {
    return p;
  }

  /** 하위 클래스가 스냅숏에 덧붙일 정보 */
  protected extraSnapshot(): Omit<RoomSnapshot, 'roomId' | 'serverTime' | 'players'> {
    return {
      swings: {},
      display: { hideNames: false, hideTeams: false, hideBubbles: false, photo: false },
      teamNames: [],
      hs: { phase: 'ready', round: 0, hostId: null, endsAt: 0, searchMs: 0, paused: false, leftMs: 0, winner: null, reveal: null, winnerPos: null },
      stage: STAGE_IDLE,
      raid: RAID_IDLE,
    };
  }

  /** 좌석·미끄럼틀 등으로 지금 움직일 수 없는지 */
  protected locked(_id: number): boolean {
    return false;
  }

  /** 이벤트 규칙으로 이동이 막혔는지 (보정 좌표를 돌려보냄) */
  protected moveBlocked(_id: number): boolean {
    return false;
  }

  /** 위치 방송에서 뺄 참가자 (숨는 중인 운영자) */
  protected hiddenId(): number | null {
    return null;
  }

  /** 모든 참가자 (내부용) */
  protected all() {
    return [...this.players.values()].map((r) => r.info);
  }

  /** 모든 참가자 (이벤트 처리용, 읽기 전용으로 사용) */
  list(): readonly PlayerInfo[] {
    return this.all();
  }

  addPlayer(info: PlayerInfo) {
    const now = Date.now();
    this.players.set(info.id, { info, dirty: false, lastMoveAt: now, windowStart: now, windowCount: 0, timers: [] });
    this.io.to(this.channel).emit('pj', { ...info });
  }

  removePlayer(id: number, reason: LeaveReason) {
    const rec = this.players.get(id);
    if (!rec) return;
    rec.timers.forEach(clearTimeout);
    this.players.delete(id);
    this.io.to(this.channel).emit('pl', id, reason);
  }

  setStatus(id: number, status: PresenceStatus) {
    const rec = this.players.get(id);
    if (!rec || rec.info.status === status) return;
    rec.info.status = status;
    if (status === 'away') rec.info.moving = false;
    this.io.to(this.channel).emit('ps', id, status);
  }

  /** 참가자 상태 일부 변경 + 모두에게 알림 */
  patch(id: number, patch: PlayerPatch) {
    const rec = this.players.get(id);
    if (!rec) return;
    Object.assign(rec.info, patch);
    if (patch.x !== undefined || patch.y !== undefined) {
      rec.lastMoveAt = Date.now();
      if (id === this.hiddenId()) {
        // 숨는 중인 운영자의 좌표는 방송하지 않음
        const { x: _x, y: _y, ...rest } = patch;
        if (Object.keys(rest).length) this.io.to(this.channel).emit('pu', id, rest);
        return;
      }
    }
    this.io.to(this.channel).emit('pu', id, patch);
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
    if (info.seat || this.locked(id)) return null; // 앉아 있거나 놀이기구 이용 중이면 이동 무시
    if (this.moveBlocked(id)) {
      // 숨바꼭질 블라인드·발견 연출 중: 서버 위치로 되돌림
      rec.lastMoveAt = now;
      return input[0] !== info.x || input[1] !== info.y ? { x: info.x, y: info.y } : null;
    }
    const dt = Math.min(1, Math.max(0, (now - rec.lastMoveAt) / 1000));
    const allowed = MOVE_SPEED * dt * 1.6 + 14;
    const dist = Math.hypot(x - info.x, y - info.y);
    if (dist > allowed || !this.canStand(x, y, info.bath)) {
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
  protected canStand(_x: number, _y: number, _bath: boolean): boolean {
    return true;
  }

  protected tick() {
    const states: PlayerState[] = [];
    // 3초마다 전체 위치를 한 번 더 보내 유실된 패킷을 보정
    const full = ++this.tickCount % (TICK_HZ * 3) === 0;
    const hidden = this.hiddenId();
    for (const rec of this.players.values()) {
      if (rec.info.id === hidden) continue; // 숨는 운영자 위치는 아무에게도 보내지 않음
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
