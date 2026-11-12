/**
 * 클라이언트 측 월드 상태.
 * 서버 이벤트를 받아 참가자 목록과 위치 샘플(보간용)을 관리합니다.
 * 화면(Phaser)과 UI(HUD)는 이 저장소만 바라봅니다.
 */
import { INTERP_DELAY_MS, TICK_HZ } from '../../../shared/constants';
import type { EmoteId, PoseId } from '../../../shared/social';
import type { SwingState } from '../../../shared/playground';
import { HS_IDLE, hsActive, STAGE_IDLE, type EggEvent, type HsState, type StageState } from '../../../shared/events';
import { RAID_IDLE, type RaidFx, type RaidState } from '../../../shared/raid';
import type {
  BoardComment,
  BoardNote,
  ChatMessage,
  DisplaySettings,
  FxEvent,
  RequestEvent,
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
  noteUpdate: [BoardNote];
  noteDelete: [number];
  comment: [BoardComment];
  commentUpdate: [BoardComment];
  commentDelete: [number, number];
  chat: [ChatMessage];
  emote: [PlayerInfo, EmoteId];
  pose: [PlayerInfo, PoseId, number];
  fx: [FxEvent];
  req: [RequestEvent];
  info: [string];
  swing: [string, SwingState];
  fireQ: [string];
  notice: [string];
  display: [DisplaySettings];
  teamNames: [string[]];
  muted: [boolean];
  hs: [HsState, HsState];
  egg: [EggEvent];
  stage: [StageState];
  raid: [RaidState, RaidState];
  rfx: [RaidFx[]];
};

const TICK_MS = 1000 / TICK_HZ;

export class WorldStore extends Emitter<StoreEvents> {
  readonly players = new Map<number, PlayerEntry>();
  selfId: number | null = null;
  display: DisplaySettings = { hideNames: false, hideTeams: false, hideBubbles: false, photo: false };
  teamNames: string[] = [];
  swings: Record<string, SwingState> = {};
  muted = false;
  /** 운영자를 찾아라! 상태 */
  hs: HsState = { ...HS_IDLE };
  /** 빔프로젝터 무대 (가챠·행운 추첨) */
  stage: StageState = { ...STAGE_IDLE };
  /** 과제 괴물 레이드 */
  raid: RaidState = { ...RAID_IDLE };
  /** 이 화면이 운영자(관리자 인증한 참가자) 계정인지 */
  hostAccount = false;
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
    socket.on('bu', (n) => this.emit('noteUpdate', n));
    socket.on('bd', (id) => this.emit('noteDelete', id));
    socket.on('cn', (c) => this.emit('comment', c));
    socket.on('cu', (c) => this.emit('commentUpdate', c));
    socket.on('cdel', (noteId, id) => this.emit('commentDelete', noteId, id));
    socket.on('chat', (m) => this.emit('chat', m));
    socket.on('emote', (id, kind) => {
      const e = this.players.get(id);
      if (e) this.emit('emote', e.info, kind);
    });
    socket.on('pose', (id, kind, at) => {
      const e = this.players.get(id);
      if (e) this.emit('pose', e.info, kind, at);
    });
    socket.on('fx', (ev) => this.emit('fx', ev));
    socket.on('req', (r) => this.emit('req', r));
    socket.on('info', (t) => this.emit('info', t));
    socket.on('swing', (seat, st) => {
      this.swings[seat] = st;
      this.emit('swing', seat, st);
    });
    socket.on('fireQ', (q) => this.emit('fireQ', q));
    socket.on('notice', (t) => this.emit('notice', t));
    socket.on('display', (d) => {
      this.display = d;
      this.emit('display', d);
    });
    socket.on('teamNames', (n) => {
      this.teamNames = n;
      this.emit('teamNames', n);
    });
    socket.on('muted', (m) => {
      this.muted = m;
      this.emit('muted', m);
    });
    socket.on('hs', (st) => this.setHs(st));
    socket.on('egg', (ev) => this.emit('egg', ev));
    socket.on('stage', (st) => {
      this.stage = st;
      this.emit('stage', st);
    });
    socket.on('raid', (st) => this.setRaid(st));
    socket.on('rfx', (fx) => this.emit('rfx', fx));
  }

  private setRaid(st: RaidState) {
    const prev = this.raid;
    this.raid = st;
    this.emit('raid', st, prev);
  }

  /** 내가 레이드 참가자 */
  get inRaid() {
    const r = this.raid;
    if (this.selfId === null || r.phase === 'off') return false;
    return r.joined.includes(this.selfId) || r.players.some((p) => p[0] === this.selfId);
  }

  private setHs(st: HsState) {
    const prev = this.hs;
    // 같은 회차의 운영자 정보는 (운영자 본인·운영자에게만 오는 값이라) 유지
    if (st.hostId === null && prev.round === st.round && prev.hostId !== null && hsActive(st.phase)) st = { ...st, hostId: prev.hostId };
    this.hs = st;
    this.emit('hs', st, prev);
  }

  /** 숨바꼭질이 아지트에 영향을 주는 중 */
  get hsActive() {
    return hsActive(this.hs.phase);
  }

  /** 내가 이번 회차의 운영자 */
  get iAmHost() {
    return this.selfId !== null && this.hs.hostId === this.selfId;
  }

  /** 지금 내 캐릭터가 움직이면 안 되는지 (서버 규칙과 같음) */
  get frozen() {
    const h = this.hs;
    if (h.phase === 'hiding') return h.paused || !this.iAmHost;
    if (h.phase === 'searching') return h.paused || this.iAmHost;
    if (h.phase === 'found' || h.phase === 'timeout') return this.serverNow() < h.endsAt - (h.phase === 'found' ? 4500 : 5000);
    return false;
  }

  reset(room: RoomSnapshot, selfId: number | null) {
    this.players.clear();
    this.selfId = selfId;
    this.offset = Date.now() - room.serverTime;
    this.swings = room.swings ?? {};
    if (room.display) this.display = room.display;
    if (room.teamNames) this.teamNames = room.teamNames;
    for (const p of room.players) this.add(p, false);
    if (room.hs) this.setHs(room.hs);
    if (room.stage) this.stage = room.stage;
    if (room.raid) this.setRaid(room.raid);
    this.emit('reset');
    this.emit('count', this.onlineCount);
    this.emit('display', this.display);
    this.emit('teamNames', this.teamNames);
    this.emit('stage', this.stage);
  }

  get self(): PlayerInfo | null {
    return this.selfId == null ? null : this.players.get(this.selfId)?.info ?? null;
  }

  get onlineCount() {
    let n = 0;
    for (const e of this.players.values()) if (e.info.status === 'online') n++;
    return n;
  }

  /** 현재 서버 시각 추정 (놀이기구처럼 모두가 같은 시각 기준으로 움직이는 연출용) */
  serverNow(now = Date.now()) {
    return now - (this.offset ?? 0);
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

/** 이름으로 팀 이름 찾기 (운영자가 바꾼 이름 우선) */
export function teamName(store: WorldStore, team: number): string {
  return store.teamNames[team] ?? ['레드팀', '블루팀', '그린팀', '옐로팀', '퍼플팀', '핑크팀'][team] ?? '';
}
