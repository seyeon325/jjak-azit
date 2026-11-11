/**
 * 학회장을 찾아라! (숨바꼭질) — 서버가 모든 상태와 판정을 맡습니다.
 *
 *  READY → HIDING(15초, 학회장만 이동·위치 비공개) → SEARCHING(학회장 고정, 참가자 광장 리스폰)
 *        → FOUND(최초 발견자 확정·상품권 배정) 또는 TIMEOUT → FINISHED
 *  관리자 강제 종료 → CANCELLED
 *
 * 위치 보호: 숨는 동안 학회장 좌표는 위치 방송·상태 변경·스냅숏 어디에도 실리지 않습니다
 * (학회장 본인 화면만 자기 위치를 앎). 블라인드는 화면만 가리는 게 아니라 데이터 자체를 막습니다.
 */
import { HS, HS_IDLE, hsActive, type HsPhase, type HsState } from '../shared/events';
import { WORLD } from '../shared/map';
import type { DisplaySettings, PlayerInfo } from '../shared/protocol';
import type { PlazaRoom, PlazaRules } from './rooms/PlazaRoom';
import { BAEMIN, type PrizeStore } from './PrizeStore';

export interface HsDeps {
  plaza: PlazaRoom;
  prizes: PrizeStore;
  /** 상태를 모두에게 보냄 */
  broadcast(st: HsState): void;
  /** 이름 숨김 등 화면 설정이 바뀜 */
  displayChanged(): void;
  notice(text: string): void;
  ownerKey(playerId: number): string | null;
  isHostSession(playerId: number): boolean;
  log(msg: string): void;
}

const EVENT_NAME = '학회장을 찾아라!';

export class HideSeek implements PlazaRules {
  private st: HsState = { ...HS_IDLE };
  private host: number | null = null;
  /** 숨기 시작 전 학회장 위치 (숨는 동안 다른 사람에게는 이 위치만 보임) */
  private startPos = { x: 0, y: 0 };
  private timer: NodeJS.Timeout | null = null;
  private graceTimer: NodeJS.Timeout | null = null;
  /** 발견·시간 종료 연출 동안 모두 멈춤 */
  private freezeUntil = 0;
  private startedAt = 0;
  private hostNick = '';

  constructor(private d: HsDeps) {}

  // ---------------------------------------------------------------- 공개 상태

  get phase(): HsPhase {
    return this.st.phase;
  }
  get hostId() {
    return this.host;
  }
  get active() {
    return hsActive(this.st.phase);
  }

  /** 참가자에게 보내는 상태 (숨는 동안에는 학회장이 누구인지도 숨김) */
  state(): HsState {
    return { ...this.st, hostId: this.st.phase === 'hiding' ? null : this.st.hostId };
  }

  /** 운영자에게 보내는 상태 */
  adminState(): HsState {
    return { ...this.st, hostId: this.host };
  }

  /** 이벤트 중 강제되는 화면 설정 (원래 설정은 건드리지 않으므로 끝나면 그대로 복원) */
  overrideDisplay(d: DisplaySettings): DisplaySettings {
    if (!this.active) return d;
    return { ...d, hideNames: true, hideTeams: true, hideBubbles: d.hideBubbles || this.st.phase === 'hiding' };
  }

  // ---------------------------------------------------------------- 광장 규칙 (PlazaRules)

  moveBlocked(id: number): boolean {
    const p = this.st.phase;
    if (p === 'hiding') return this.st.paused || id !== this.host;
    if (p === 'searching') return this.st.paused || id === this.host;
    if (p === 'found' || p === 'timeout') return Date.now() < this.freezeUntil;
    return false;
  }

  hiddenId(): number | null {
    return this.st.phase === 'hiding' ? this.host : null;
  }

  mask(p: PlayerInfo, viewerId: number | null): PlayerInfo {
    if (this.st.phase === 'hiding' && p.id === this.host && viewerId !== this.host) {
      return { ...p, x: this.startPos.x, y: this.startPos.y, moving: false };
    }
    return p;
  }

  actBlock(id: number): string | null {
    const p = this.st.phase;
    if (p === 'hiding') return id === this.host ? '숨는 동안에는 이동만 할 수 있어요.' : '학회장이 숨는 중이에요!';
    if (p === 'searching') {
      if (id === this.host) return '숨은 학회장은 움직일 수 없어요.';
      if (this.st.paused) return '잠시 기다려주세요.';
    }
    if ((p === 'found' || p === 'timeout') && Date.now() < this.freezeUntil) return '잠시만요!';
    return null;
  }

  socialBlock(id: number): string | null {
    const p = this.st.phase;
    if (p === 'hiding') return '학회장이 숨는 중이에요!';
    if (p === 'searching' && id === this.host) return '수색 중에는 학회장이 말할 수 없어요.';
    return null;
  }

  targetBlock(target: number): string | null {
    if ((this.st.phase === 'hiding' || this.st.phase === 'searching') && target === this.host) return '지금은 상호작용할 수 없어요.';
    return null;
  }

  // ---------------------------------------------------------------- 진행

  start(hostId: number, searchSec: number | undefined): string | null {
    if (this.active) return '이미 숨바꼭질이 진행 중이에요.';
    const pl = this.d.plaza;
    const host = pl.get(hostId);
    if (!host || !this.d.isHostSession(hostId)) return '학회장 아바타를 찾을 수 없어요. 참가자 화면에서 학회장 로그인을 해주세요.';
    if (host.status !== 'online') return '학회장 화면의 연결이 끊겨 있어요.';
    const sec = Number.isFinite(searchSec) ? Math.round(searchSec!) : HS.searchMs / 1000;
    if (sec < HS.minSearchSec || sec > HS.maxSearchSec) return `수색 시간은 ${HS.minSearchSec}~${HS.maxSearchSec}초로 정해주세요.`;

    pl.freeHost(hostId);
    pl.patch(hostId, { host: false }); // 학회장 배지 숨김
    const h = pl.get(hostId)!;
    this.host = hostId;
    this.hostNick = h.nickname;
    this.startPos = { x: h.x, y: h.y };
    this.startedAt = Date.now();
    this.freezeUntil = 0;
    this.st = {
      ...HS_IDLE,
      phase: 'hiding',
      round: this.st.round + 1,
      hostId,
      endsAt: Date.now() + HS.hideMs,
      searchMs: sec * 1000,
    };
    this.schedule(HS.hideMs, () => this.beginSearch());
    this.d.log(`숨바꼭질 ${this.st.round}회차 시작 (학회장 ${h.nickname}, 수색 ${sec}초)`);
    this.push(true);
    return null;
  }

  private beginSearch() {
    const pl = this.d.plaza;
    const host = this.host !== null ? pl.get(this.host) : undefined;
    if (!host) return this.cancel('학회장이 나가서 숨바꼭질이 취소됐어요.');
    // 숨은 위치 확정: 갈 수 없는 곳이면 가장 가까운 서 있을 수 있는 곳으로
    const spot = WORLD.collision.canStand(host.x, host.y) ? { x: host.x, y: host.y } : WORLD.collision.nearest(host.x, host.y, 96) ?? this.startPos;

    this.st = { ...this.st, phase: 'searching', endsAt: Date.now() + this.st.searchMs };
    // 이제부터 학회장 위치를 방송 (숨는 단계가 끝났으므로)
    pl.place(host.id, spot.x, spot.y);
    // 일반 참가자: 상호작용 해제 후 중앙 광장에 흩어서 리스폰
    const others = pl.list().filter((p) => p.id !== host.id);
    const spots = plazaSpots(others.length);
    others.forEach((p, i) => pl.resetForEvent(p.id, spots[i]));
    this.schedule(this.st.searchMs, () => this.timeout());
    this.d.log(`숨바꼭질 수색 시작 (${Math.round(spot.x)}, ${Math.round(spot.y)})`);
    this.push(false);
  }

  /** '찾았다!!' — 서버 위치로 거리 확인, 가장 먼저 도착한 요청 한 개만 인정 */
  find(id: number): string | null {
    if (this.st.phase !== 'searching') return this.st.winner ? '이미 발견자가 정해졌어요.' : '지금은 찾을 수 없어요.';
    if (this.st.paused) return '잠시 기다려주세요.';
    if (id === this.host) return '학회장은 찾을 수 없어요.';
    if (this.d.isHostSession(id)) return '운영자 계정은 참여할 수 없어요.';
    const pl = this.d.plaza;
    const me = pl.get(id);
    const host = this.host !== null ? pl.get(this.host) : undefined;
    if (!me || !host) return '지금은 찾을 수 없어요.';
    if (me.status !== 'online' || me.bath) return '지금은 찾을 수 없어요.';
    if (Math.hypot(me.x - host.x, me.y - host.y) > HS.findR) return '조금 더 가까이 가야 해요!';

    // ---- 여기부터는 중간에 다른 요청이 끼어들 수 없음 (단일 스레드) → 우승자 1명 확정
    const key = this.d.ownerKey(id) ?? '';
    const award = this.d.prizes.award('hideseek', BAEMIN, { playerId: id, ownerKey: key, nickname: me.nickname }, EVENT_NAME, this.st.round);
    this.clearTimers();
    this.freezeUntil = Date.now() + 6500;
    this.st = {
      ...this.st,
      phase: 'found',
      endsAt: Date.now() + HS.foundShowMs,
      winner: { id, nickname: me.nickname, prize: !!award },
      reveal: { x: host.x, y: host.y },
      winnerPos: { x: me.x, y: me.y },
    };
    this.d.prizes.logRound({
      round: this.st.round,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      result: 'found',
      winner: me.nickname,
      prize: !!award,
      hostNickname: this.hostNick,
    });
    this.d.log(`숨바꼭질 발견! ${me.nickname}${award ? ' (배달의민족 상품권 배정)' : ' (상품권 할당 소진 — 기록만)'}`);
    this.push(false);
    // 발견자는 기뻐하고, 학회장은 깜짝
    setTimeout(() => {
      pl.broadcastPose(id, 'jump');
      if (this.host !== null) pl.broadcastPose(this.host, 'surprised');
    }, 900);
    setTimeout(() => pl.broadcastPose(id, 'v'), 2200);
    this.schedule(HS.foundShowMs, () => this.finish());
    return null;
  }

  private timeout() {
    const host = this.host !== null ? this.d.plaza.get(this.host) : undefined;
    this.freezeUntil = Date.now() + 4000;
    this.st = { ...this.st, phase: 'timeout', endsAt: Date.now() + HS.timeoutShowMs, reveal: host ? { x: host.x, y: host.y } : null };
    this.d.prizes.logRound({ round: this.st.round, startedAt: this.startedAt, endedAt: Date.now(), result: 'timeout', winner: null, prize: false, hostNickname: this.hostNick });
    this.d.log('숨바꼭질 시간 종료 — 발견자 없음');
    this.push(false);
    if (host) setTimeout(() => this.d.plaza.broadcastPose(host.id, 'v'), 1200);
    this.schedule(HS.timeoutShowMs, () => this.finish());
  }

  /** 연출이 끝나고 평소 아지트로 */
  finish() {
    this.clearTimers();
    this.freezeUntil = 0;
    this.restoreHost();
    this.st = { ...this.st, phase: 'finished', paused: false, endsAt: 0 };
    this.push(true);
  }

  cancel(reason = '운영자가 숨바꼭질을 종료했어요.') {
    if (!this.active) return;
    const wasPlaying = this.st.phase === 'hiding' || this.st.phase === 'searching';
    this.clearTimers();
    this.freezeUntil = 0;
    if (wasPlaying)
      this.d.prizes.logRound({ round: this.st.round, startedAt: this.startedAt, endedAt: Date.now(), result: 'cancelled', winner: null, prize: false, hostNickname: this.hostNick });
    this.restoreHost();
    this.st = { ...this.st, phase: wasPlaying ? 'cancelled' : 'finished', paused: false, endsAt: 0 };
    this.d.notice(reason);
    this.d.log(`숨바꼭질 종료: ${reason}`);
    this.push(true);
  }

  /** 운영자 '종료': 진행 중이면 취소, 결과 연출 중이면 바로 마무리 */
  end() {
    if (this.st.phase === 'found' || this.st.phase === 'timeout') return this.finish();
    this.cancel();
  }

  reset(): string | null {
    if (this.active) return '진행 중에는 초기화할 수 없어요. 먼저 종료해주세요.';
    this.st = { ...HS_IDLE, round: this.st.round, searchMs: this.st.searchMs };
    this.host = null;
    this.push(false);
    return null;
  }

  // ---------------------------------------------------------------- 학회장 연결 끊김

  onHostAway(id: number) {
    if (id !== this.host || (this.st.phase !== 'hiding' && this.st.phase !== 'searching') || this.st.paused) return;
    const left = Math.max(1000, this.st.endsAt - Date.now());
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.st = { ...this.st, paused: true, leftMs: left };
    this.graceTimer = setTimeout(() => this.cancel('학회장 연결이 끊겨 숨바꼭질이 취소됐어요.'), HS.hostGraceMs);
    this.d.log('숨바꼭질 일시정지 (학회장 연결 끊김)');
    this.push(false);
  }

  onHostBack(id: number) {
    if (id !== this.host || !this.st.paused) return;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    const left = this.st.leftMs;
    this.st = { ...this.st, paused: false, leftMs: 0, endsAt: Date.now() + left };
    this.schedule(left, () => (this.st.phase === 'hiding' ? this.beginSearch() : this.timeout()));
    this.d.log('숨바꼭질 재개 (학회장 재접속)');
    this.push(false);
  }

  onHostGone(id: number) {
    if (id !== this.host) return;
    if (this.st.phase === 'hiding' || this.st.phase === 'searching') this.cancel('학회장이 나가서 숨바꼭질이 취소됐어요.');
  }

  // ---------------------------------------------------------------- 내부

  private restoreHost() {
    if (this.host !== null && this.d.plaza.has(this.host) && this.d.isHostSession(this.host)) this.d.plaza.patch(this.host, { host: true });
  }

  private schedule(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.timer = this.graceTimer = null;
  }

  private push(displayChanged: boolean) {
    this.d.broadcast(this.state());
    if (displayChanged) this.d.displayChanged();
  }
}

/** 중앙 광장 스폰 구역에 겹치지 않게 흩어 놓을 위치 n개 */
function plazaSpots(n: number): { x: number; y: number }[] {
  const s = WORLD.spawn;
  const out: { x: number; y: number }[] = [];
  const cols = Math.max(1, Math.floor(s.w / 14));
  const rows = Math.max(1, Math.floor(s.h / 12));
  const cells: { x: number; y: number }[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push({ x: s.x + 7 + i * 14, y: s.y + 6 + j * 12 });
  // 무작위로 섞어서 매번 다른 자리
  for (let i = cells.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[k]] = [cells[k], cells[i]];
  }
  for (let i = 0; i < n; i++) {
    const c = cells[i % cells.length];
    const jitter = i >= cells.length ? 4 : 0;
    const p = WORLD.collision.nearest(c.x + (Math.random() - 0.5) * jitter, c.y + (Math.random() - 0.5) * jitter, 40) ?? { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    out.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  return out;
}
