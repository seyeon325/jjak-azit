import { CAMPFIRE_R, EAT_MS, SEAT_RANGE, SLIDE_MS } from '../../shared/constants';
import { SWING, SWING_OMEGA, swingAmp, swingAngle, swingSeatOffset, type SwingState } from '../../shared/playground';
import { nearSpot, nearSpringEdge, randomSpawn, WORLD, type Seat } from '../../shared/map';
import { HS_IDLE, type HsState, type StageState } from '../../shared/events';
import type { RaidState } from '../../shared/raid';
import type {
  ActRequest,
  ActResult,
  ChatChannel,
  ChatMessage,
  DisplaySettings,
  PlayerInfo,
  RoomSnapshot,
  ServerToClientEvents,
} from '../../shared/protocol';
import {
  EMOTES,
  FIRE_QUESTIONS,
  INTERACTION_DEF,
  INTERACTIONS,
  POSES,
  type EmoteId,
  type InteractionId,
  type PoseId,
} from '../../shared/social';
import { Room, type IO } from './Room';

export interface PlazaHooks {
  /** 특정 참가자의 소켓에만 보내기 */
  emitTo<E extends keyof ServerToClientEvents>(playerId: number, ev: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  isMuted(playerId: number): boolean;
  display(): DisplaySettings;
  teamNames(): string[];
  /** 무대 화면·레이드 상태 (스냅숏용) */
  stage(): StageState;
  raid(): RaidState;
  /** 이스터에그용 행동 기록 (서버가 승인한 행동만) */
  stat(playerId: number, key: StatKey, n?: number): void;
}

export type StatKey = 'swing' | 'sumung' | 'dance' | 'prank' | 'secret';

/** 행사 이벤트(숨바꼭질 등)가 광장 규칙을 잠시 바꿀 때 쓰는 연결점 */
export interface PlazaRules {
  /** 이동 금지 (블라인드·발견 연출·수색 중 운영자) */
  moveBlocked(id: number): boolean;
  /** 위치를 방송하지 않을 참가자 */
  hiddenId(): number | null;
  /** 보는 사람에 따라 참가자 정보 가리기 */
  mask(p: PlayerInfo, viewerId: number | null): PlayerInfo;
  /** 음식·좌석·놀이기구 등 상호작용 금지 사유 */
  actBlock(id: number): string | null;
  /** 채팅·이모티콘·포즈 금지 사유 */
  socialBlock(id: number): string | null;
  /** 이 사람을 대상으로 한 상호작용 금지 사유 */
  targetBlock(target: number): string | null;
  state(): HsState;
}

const OPEN_RULES: PlazaRules = {
  moveBlocked: () => false,
  hiddenId: () => null,
  mask: (p) => p,
  actBlock: () => null,
  socialBlock: () => null,
  targetBlock: () => null,
  state: () => HS_IDLE,
};

/** 그네를 이만큼 이상 타고 내려야 '탑승 완료' */
const SWING_RIDE_MS = 2500;
const DANCE_STAT_GAP = 1500;

interface Req {
  id: number;
  kind: 'dance' | 'follow';
  from: number;
  to: number;
  timer: NodeJS.Timeout;
}

const SEAT_BY_ID = new Map(WORLD.seats.map((s) => [s.id, s]));

/**
 * 메인 광장. 공용 맵 데이터로 충돌을 검사하고, 푸드트럭·온천·좌석·놀이기구,
 * 채팅(일반/모닥불/벤치), 이모티콘·포즈, 플레이어 상호작용을 서버에서 판정합니다.
 */
export class PlazaRoom extends Room {
  /** 좌석 id → 앉은 참가자 */
  private seats = new Map<string, number>();
  /** 그네 진자 상태 (빈 그네도 서서히 멈출 때까지 유지) */
  private swingSt = new Map<string, SwingState>();
  private sliding = new Map<number, NodeJS.Timeout>();
  private cooldown = new Map<string, number>();
  private reqs = new Map<number, Req>();
  private nextReq = 1;
  private fireQ = FIRE_QUESTIONS[0];
  private fireQAt = 0;
  /** 그네 탑승 시작 시각 (탑승 완료 횟수 집계) */
  private swingSitAt = new Map<number, number>();
  private lastDanceStat = new Map<number, number>();
  hooks!: PlazaHooks;
  rules: PlazaRules = OPEN_RULES;

  constructor(io: IO) {
    super('plaza', io);
  }

  isWalkable(x: number, y: number) {
    return WORLD.collision.canStand(x, y);
  }

  spawnPoint() {
    return randomSpawn();
  }

  protected override canStand(x: number, y: number, bath: boolean): boolean {
    return (bath ? WORLD.bathGrid : WORLD.collision).canStand(x, y);
  }

  protected override locked(id: number) {
    return this.sliding.has(id);
  }

  protected override moveBlocked(id: number) {
    return this.rules.moveBlocked(id);
  }

  protected override hiddenId() {
    return this.rules.hiddenId();
  }

  protected override maskFor(p: PlayerInfo, viewerId: number | null) {
    return this.rules.mask(p, viewerId);
  }

  protected override extraSnapshot(): Omit<RoomSnapshot, 'roomId' | 'serverTime' | 'players'> {
    return {
      swings: Object.fromEntries(this.swingSt),
      display: this.hooks.display(),
      teamNames: this.hooks.teamNames(),
      hs: this.rules.state(),
      stage: this.hooks.stage(),
      raid: this.hooks.raid(),
    };
  }

  /** 숨바꼭질 수색 시작: 일반 참가자의 좌석·온천·따라가기 등을 풀고 지정 위치로 */
  resetForEvent(id: number, to: { x: number; y: number }) {
    const p = this.get(id);
    if (!p) return;
    this.releaseAll(id);
    this.patch(id, { x: to.x, y: to.y, bath: false, seat: null, followId: null });
  }

  /** 숨기 시작 전 운영자 정리 (좌석·온천에서 나옴) */
  freeHost(id: number) {
    const p = this.get(id);
    if (!p) return;
    this.releaseAll(id);
    if (p.bath) {
      const land = WORLD.collision.nearest(p.x, p.y, 96) ?? randomSpawn();
      this.patch(id, { bath: false, x: land.x, y: land.y });
    }
  }

  /** 서버 위치를 직접 정함 (운영자 숨은 위치 확정 등) */
  place(id: number, x: number, y: number) {
    this.patch(id, { x, y });
  }

  /** 모두에게 포즈 연출 */
  broadcastPose(id: number, kind: PoseId) {
    if (this.has(id)) this.io.to(this.channel).emit('pose', id, kind, Date.now());
  }

  /** 퇴장·연결 끊김 시 좌석·따라가기·요청 정리 */
  releaseAll(id: number) {
    const p = this.get(id);
    if (!p) return;
    if (p.seat) this.leaveSeat(id, false);
    const sl = this.sliding.get(id);
    if (sl) {
      clearTimeout(sl);
      this.sliding.delete(id);
      const e = WORLD.slide.exit;
      this.patch(id, { x: e.x, y: e.y });
    }
    if (p.followId !== null) this.patch(id, { followId: null });
    for (const other of this.all()) if (other.followId === id) this.patch(other.id, { followId: null });
    for (const r of [...this.reqs.values()]) if (r.from === id || r.to === id) this.dropReq(r.id);
  }

  override removePlayer(id: number, reason: 'left' | 'timeout') {
    this.releaseAll(id);
    super.removePlayer(id, reason);
  }

  private cool(id: number, key: string, ms: number): boolean {
    const k = `${id}:${key}`;
    const now = Date.now();
    if ((this.cooldown.get(k) ?? 0) > now) return false;
    this.cooldown.set(k, now + ms);
    return true;
  }

  // ---------------------------------------------------------------- 상호작용 요청 (음식·온천·좌석·놀이기구)

  act(id: number, req: ActRequest): ActResult {
    const p = this.get(id);
    if (!p) return { ok: false, reason: '아지트에 입장한 뒤 이용할 수 있어요.' };
    const busy = () => (p.seat ? '먼저 일어나 주세요.' : this.sliding.has(id) ? '미끄럼틀을 타는 중이에요.' : null);
    const blocked = this.rules.actBlock(id);
    if (blocked && !(req.t === 'stand' && !p.seat)) return { ok: false, reason: blocked };

    switch (req.t) {
      case 'secret': {
        if (!nearSpot(WORLD.spots.secret, p.x, p.y)) return { ok: false, reason: '조금 더 가까이 가주세요.' };
        if (!this.cool(id, 'secret', 1500)) return { ok: true };
        this.io.to(this.channel).emit('emote', id, 'star');
        this.hooks.stat(id, 'secret');
        return { ok: true };
      }
      case 'food': {
        if (p.bath) return { ok: false, reason: '온천에서 나온 뒤 주문해주세요.' };
        if (p.eating) return { ok: false, reason: '지금 먹는 중이에요.' };
        if (p.food) return { ok: false, reason: '한 번에 하나만 들 수 있어요. 먼저 먹어주세요!' };
        if (!nearSpot(WORLD.spots.foodtruck, p.x, p.y)) return { ok: false, reason: '푸드트럭 가까이에서 주문할 수 있어요.' };
        this.patch(id, { food: req.food });
        return { ok: true };
      }
      case 'eat': {
        if (!p.food) return { ok: false, reason: '들고 있는 음식이 없어요.' };
        if (p.eating) return { ok: true };
        if (p.bath) return { ok: false, reason: '온천에서는 먹을 수 없어요.' };
        const food = p.food;
        this.patch(id, { eating: true });
        this.io.to(this.channel).emit('pe', id, food);
        const rec = this.players.get(id)!;
        const t = setTimeout(() => {
          rec.timers = rec.timers.filter((x) => x !== t);
          if (this.players.get(id) === rec) {
            this.patch(id, { food: null, eating: false });
            if (food === 'sumung') this.hooks.stat(id, 'sumung');
          }
        }, EAT_MS);
        rec.timers.push(t);
        return { ok: true };
      }
      case 'bath': {
        if (req.on) {
          if (p.bath) return { ok: true };
          const b = busy();
          if (b) return { ok: false, reason: b };
          if (p.eating) return { ok: false, reason: '다 먹고 들어가요!' };
          if (!nearSpringEdge(p.x, p.y)) return { ok: false, reason: '온천 가까이에서 들어갈 수 있어요.' };
          const spot = WORLD.bathGrid.nearest(p.x, p.y + 26, 64) ?? WORLD.bathGrid.nearest(p.x, p.y + 6, 64);
          if (!spot) return { ok: false, reason: '온천이 꽉 찼어요. 다른 쪽으로 가볼까요?' };
          this.patch(id, { bath: true, x: spot.x, y: spot.y, followId: null });
          return { ok: true };
        }
        if (!p.bath) return { ok: true };
        const land = WORLD.collision.nearest(p.x, p.y, 96) ?? randomSpawn();
        this.patch(id, { bath: false, x: land.x, y: land.y });
        return { ok: true };
      }
      case 'sit': {
        const seat = SEAT_BY_ID.get(req.seat);
        if (!seat) return { ok: false, reason: '앉을 수 없는 곳이에요.' };
        const b = busy();
        if (b) return { ok: false, reason: b };
        if (p.bath) return { ok: false, reason: '온천에서 나온 뒤 앉을 수 있어요.' };
        if (p.eating) return { ok: false, reason: '다 먹고 앉아요!' };
        if (Math.hypot(p.x - seat.x, p.y - seat.y) > SEAT_RANGE + 10) return { ok: false, reason: '조금 더 가까이 가주세요.' };
        if (this.seats.has(seat.id)) return { ok: false, reason: '누가 이미 앉아 있어요.' };
        this.seats.set(seat.id, id);
        this.patch(id, { seat: seat.id, x: seat.x, y: seat.y, followId: null });
        if (seat.kind === 'swing') {
          // 탑승: 지금 흔들리던 그네를 이어받아 살짝 구르기 시작
          const now = Date.now();
          this.swingSitAt.set(id, now);
          const prev = this.swingSt.get(seat.id);
          const cur = swingAmp(prev, now, false);
          this.setSwing(seat.id, { amp: Math.max(cur, SWING.ridingMin), at: now, epoch: prev && cur > 0.02 ? prev.epoch : now });
        }
        return { ok: true };
      }
      case 'stand': {
        if (!p.seat) return { ok: true };
        this.leaveSeat(id, true);
        return { ok: true };
      }
      case 'slide': {
        const b = busy();
        if (b) return { ok: false, reason: b };
        if (p.bath || p.eating) return { ok: false, reason: '지금은 탈 수 없어요.' };
        const sl = WORLD.slide;
        if (Math.hypot(p.x - sl.enter.x, p.y - sl.enter.y) > SEAT_RANGE + 6) return { ok: false, reason: '미끄럼틀 계단 앞으로 가주세요.' };
        const at = Date.now();
        this.patch(id, { followId: null, x: sl.enter.x, y: sl.enter.y });
        this.io.to(this.channel).emit('fx', { kind: 'slide', from: id, at });
        this.sliding.set(
          id,
          setTimeout(() => {
            this.sliding.delete(id);
            if (this.has(id)) this.patch(id, { x: sl.exit.x, y: sl.exit.y });
          }, SLIDE_MS),
        );
        return { ok: true };
      }
      case 'push': {
        const seat = SEAT_BY_ID.get(req.seat);
        if (!seat || seat.kind !== 'swing') return { ok: false, reason: '그네가 아니에요.' };
        const riderId = this.seats.get(seat.id);
        if (riderId === undefined || riderId === id) return { ok: false, reason: '밀어줄 사람이 없어요.' };
        const rider = this.get(riderId)!;
        if (rider.noPrank) return { ok: false, reason: `${rider.nickname} 님은 밀기를 허용하지 않았어요.` };
        if (p.seat || p.bath) return { ok: false, reason: '지금은 밀 수 없어요.' };
        if (Math.hypot(p.x - seat.x, p.y - seat.y) > 46) return { ok: false, reason: '그네 가까이 가주세요.' };
        if (!this.cool(id, 'push', 650)) return { ok: false, reason: '천천히 밀어주세요!' };
        const now = Date.now();
        const st = this.swingSt.get(seat.id);
        const cur = swingAmp(st, now, true);
        // 밀어주는 사람은 그네 뒤(위쪽)로 이동해 미는 자세
        const behind = WORLD.collision.nearest(seat.x, seat.y - 13, 10) ?? { x: p.x, y: p.y };
        this.patch(id, { x: behind.x, y: behind.y, followId: null });
        this.io.to(this.channel).emit('pose', id, 'push', now);
        if (cur >= SWING.launchAt) {
          // 퐁! — 지금 좌석이 있는 화면 위치에서 포물선으로 튀어나와 앞쪽에 착지
          const off = swingSeatOffset(swingAngle(st, now, true));
          this.seats.delete(seat.id);
          this.endSwingRide(riderId);
          this.hooks.stat(id, 'prank');
          const land =
            WORLD.collision.nearest(seat.x + (Math.random() * 24 - 12), seat.y + 46, 40) ??
            WORLD.collision.nearest(seat.x, seat.y + 20, 80) ??
            randomSpawn();
          this.patch(riderId, { seat: null, x: land.x, y: land.y });
          this.io.to(this.channel).emit('fx', { kind: 'launch', from: id, to: riderId, x: seat.x, y: seat.y + off.dy, at: now });
          // 빈 그네는 그대로 흔들리다 서서히 멈춤
          this.setSwing(seat.id, { amp: Math.min(SWING.max, cur + 0.1), at: now, epoch: st?.epoch ?? now });
        } else {
          // 뒤쪽 끝에서 앞으로 밀려 나가도록 위상을 맞추고 진폭 증가
          this.setSwing(seat.id, { amp: Math.min(SWING.max, cur + SWING.pushBoost), at: now, epoch: now + Math.PI / 2 / SWING_OMEGA });
        }
        return { ok: true };
      }
    }
  }

  private setSwing(seatId: string, st: SwingState) {
    this.swingSt.set(seatId, st);
    this.io.to(this.channel).emit('swing', seatId, st);
  }

  private leaveSeat(id: number, broadcast: boolean) {
    const p = this.get(id);
    if (!p?.seat) return;
    const seat = SEAT_BY_ID.get(p.seat);
    this.seats.delete(p.seat);
    if (seat?.kind === 'swing') this.endSwingRide(id);
    // 테이블 안쪽(뒤 벤치) 자리는 테이블 뒤쪽으로 일어남
    const up = seat?.kind === 'table' && seat.dir === 0;
    const land = seat ? WORLD.collision.nearest(seat.x, up ? seat.y - 16 : seat.y + 12, 80) ?? randomSpawn() : { x: p.x, y: p.y };
    void broadcast;
    this.patch(id, { seat: null, x: land.x, y: land.y });
  }

  /** 그네에서 내릴 때: 충분히 탔으면 '탑승 완료' 1회 */
  private endSwingRide(id: number) {
    const at = this.swingSitAt.get(id);
    this.swingSitAt.delete(id);
    if (at !== undefined && Date.now() - at >= SWING_RIDE_MS) this.hooks.stat(id, 'swing');
  }

  private danceStat(id: number) {
    const now = Date.now();
    if (now - (this.lastDanceStat.get(id) ?? 0) < DANCE_STAT_GAP) return;
    this.lastDanceStat.set(id, now);
    this.hooks.stat(id, 'dance');
  }

  seatOf(id: number): Seat | null {
    const s = this.get(id)?.seat;
    return s ? SEAT_BY_ID.get(s) ?? null : null;
  }

  benchPartner(id: number): number | null {
    const seat = this.seatOf(id);
    if (!seat || seat.kind !== 'bench') return null;
    return this.seatMates(id)[0] ?? null;
  }

  /** 같은 벤치·테이블(같은 묶음)에 앉은 다른 사람들 — 서버 좌석 기록 기준 */
  seatMates(id: number): number[] {
    const seat = this.seatOf(id);
    if (!seat) return [];
    const out: number[] = [];
    for (const s of WORLD.seats) {
      if (s.group !== seat.group || s.id === seat.id) continue;
      const other = this.seats.get(s.id);
      if (other !== undefined && other !== id) out.push(other);
    }
    return out;
  }

  inCampfire(p: PlayerInfo) {
    const c = WORLD.spots.campfire;
    return Math.hypot(p.x - c.x, p.y - c.y) <= CAMPFIRE_R;
  }

  // ---------------------------------------------------------------- 채팅

  private chatWindow = new Map<number, number[]>();

  chat(id: number, ch: ChatChannel, text: string): ActResult {
    const p = this.get(id);
    if (!p) return { ok: false, reason: '아지트에 입장한 뒤 이용할 수 있어요.' };
    if (this.hooks.isMuted(id)) return { ok: false, reason: '운영자가 채팅을 잠시 제한했어요.' };
    const blocked = this.rules.socialBlock(id);
    if (blocked) return { ok: false, reason: blocked };
    const now = Date.now();
    const recent = (this.chatWindow.get(id) ?? []).filter((t) => now - t < 10_000);
    if (recent.length && now - recent[recent.length - 1] < 600) return { ok: false, reason: '조금 천천히 보내주세요.' };
    if (recent.length >= 8) return { ok: false, reason: '메시지를 너무 많이 보냈어요. 잠시 뒤에 다시 해주세요.' };
    recent.push(now);
    this.chatWindow.set(id, recent);
    const msg: ChatMessage = { ch, from: id, nickname: p.nickname, text, at: now };

    if (ch === 'all') {
      this.io.to(this.channel).emit('chat', msg);
      return { ok: true };
    }
    if (ch === 'fire') {
      if (!this.inCampfire(p)) return { ok: false, reason: '모닥불 가까이에서만 모닥불 대화를 할 수 있어요.' };
      for (const o of this.all()) if (o.status === 'online' && this.inCampfire(o)) this.hooks.emitTo(o.id, 'chat', msg);
      return { ok: true };
    }
    if (ch === 'table') {
      // 테이블: 같은 테이블에 앉은 사람에게만 (다른 테이블·서 있는 사람·관전 화면 제외)
      if (this.seatOf(id)?.kind !== 'table') return { ok: false, reason: '테이블에 앉아야 테이블 대화를 할 수 있어요.' };
      const mates = this.seatMates(id);
      if (!mates.length) return { ok: false, reason: '같은 테이블에 다른 사람이 앉으면 대화할 수 있어요.' };
      this.hooks.emitTo(id, 'chat', msg);
      for (const m of mates) this.hooks.emitTo(m, 'chat', msg);
      return { ok: true };
    }
    // 벤치: 같은 벤치에 앉은 두 사람만
    const partner = this.benchPartner(id);
    if (partner === null) return { ok: false, reason: '같은 벤치에 두 사람이 앉아야 벤치 대화를 할 수 있어요.' };
    this.hooks.emitTo(id, 'chat', msg);
    this.hooks.emitTo(partner, 'chat', msg);
    return { ok: true };
  }

  // ---------------------------------------------------------------- 이모티콘·포즈

  emote(id: number, kind: EmoteId) {
    if (!EMOTES.includes(kind) || !this.has(id)) return;
    if (this.rules.socialBlock(id)) return;
    if (!this.cool(id, 'emote', 500)) return;
    this.io.to(this.channel).emit('emote', id, kind);
  }

  pose(id: number, kind: PoseId) {
    if (!(POSES as readonly string[]).includes(kind) || !this.has(id)) return;
    const p = this.get(id)!;
    if (p.seat || p.bath || this.sliding.has(id)) return;
    if (this.rules.socialBlock(id) || this.rules.moveBlocked(id)) return;
    if (!this.cool(id, 'pose', 700)) return;
    this.io.to(this.channel).emit('pose', id, kind, Date.now());
    if (kind === 'dance') this.danceStat(id);
  }

  // ---------------------------------------------------------------- 플레이어 대상 상호작용

  interact(id: number, kind: InteractionId, target: number): ActResult {
    if (!INTERACTIONS.includes(kind)) return { ok: false, reason: '알 수 없는 동작이에요.' };
    const p = this.get(id);
    const t = this.get(target);
    if (!p || !t || id === target) return { ok: false, reason: '상대를 찾을 수 없어요.' };
    const blocked = this.rules.socialBlock(id) ?? this.rules.actBlock(id) ?? this.rules.targetBlock(target);
    if (blocked) return { ok: false, reason: blocked };
    if (t.status !== 'online') return { ok: false, reason: `${t.nickname} 님은 지금 연결이 끊겨 있어요.` };
    const def = INTERACTION_DEF[kind];
    if (Math.hypot(p.x - t.x, p.y - t.y) > def.range) return { ok: false, reason: '조금 더 가까이 가주세요.' };
    if (def.prank && t.noPrank) return { ok: false, reason: `${t.nickname} 님은 장난을 받지 않는 중이에요.` };
    if (!this.cool(id, kind, def.cooldown)) return { ok: false, reason: '잠시 뒤에 다시 해보세요.' };

    if (def.request) {
      if (kind === 'follow' && (p.seat || p.bath)) return { ok: false, reason: '지금은 따라갈 수 없어요.' };
      const reqId = this.nextReq++;
      const r: Req = {
        id: reqId,
        kind: kind as 'dance' | 'follow',
        from: id,
        to: target,
        timer: setTimeout(() => this.dropReq(reqId), 15_000),
      };
      this.reqs.set(reqId, r);
      this.hooks.emitTo(target, 'req', { reqId, kind: r.kind, from: id, nickname: p.nickname });
      return { ok: true };
    }
    if (kind === 'greet') this.io.to(this.channel).emit('pose', id, 'wave', Date.now());
    this.io.to(this.channel).emit('fx', { kind, from: id, to: target, at: Date.now() });
    if (def.prank) this.hooks.stat(id, 'prank');
    return { ok: true };
  }

  private dropReq(reqId: number) {
    const r = this.reqs.get(reqId);
    if (!r) return;
    clearTimeout(r.timer);
    this.reqs.delete(reqId);
  }

  respond(id: number, reqId: number, accept: boolean) {
    const r = this.reqs.get(reqId);
    if (!r || r.to !== id) return;
    this.dropReq(reqId);
    const from = this.get(r.from);
    const to = this.get(r.to);
    if (!from || !to) return;
    if (!accept) {
      this.hooks.emitTo(r.from, 'info', `${to.nickname} 님이 ${r.kind === 'dance' ? '춤 신청' : '따라가기'}을 거절했어요.`);
      return;
    }
    if (r.kind === 'dance') {
      const at = Date.now();
      this.io.to(this.channel).emit('pose', r.from, 'dance', at);
      this.io.to(this.channel).emit('pose', r.to, 'dance', at);
      this.danceStat(r.from);
      this.danceStat(r.to);
      return;
    }
    if (from.seat || from.bath) return;
    this.patch(r.from, { followId: r.to });
    this.hooks.emitTo(r.from, 'info', `${to.nickname} 님을 따라가요. 움직이면 따라가기가 끝나요.`);
    this.hooks.emitTo(r.to, 'info', `${from.nickname} 님이 나를 따라와요.`);
  }

  unfollow(id: number) {
    const p = this.get(id);
    if (!p) return;
    if (p.followId !== null) this.patch(id, { followId: null });
    for (const o of this.all()) if (o.followId === id) this.patch(o.id, { followId: null });
  }

  setPref(id: number, noPrank: boolean) {
    if (this.has(id)) this.patch(id, { noPrank });
  }

  // ---------------------------------------------------------------- 모닥불 질문

  fireQuestion(id: number, next: boolean): string {
    const p = this.get(id);
    if (next && p && this.inCampfire(p) && Date.now() - this.fireQAt > 2500) {
      let q = this.fireQ;
      while (q === this.fireQ) q = FIRE_QUESTIONS[Math.floor(Math.random() * FIRE_QUESTIONS.length)];
      this.fireQ = q;
      this.fireQAt = Date.now();
      for (const o of this.all()) if (o.id !== id && this.inCampfire(o)) this.hooks.emitTo(o.id, 'fireQ', q);
    }
    return this.fireQ;
  }
}
