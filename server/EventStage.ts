/**
 * 행사 경품 이벤트 + 빔프로젝터 무대 화면 상태
 *
 *  A. 우수 PAIR 경품 가챠 — 이미 선정된 공식 우수 PAIR 3팀에게 상품 3종을 1:1 무작위 배정
 *     · 가챠 연출이 시작되기 전에 서버가 상품을 확정·기록 (화면은 확정된 결과를 공개만 함)
 *     · 이미 배정된 상품은 남은 후보에서 빠짐, 마지막 팀은 남은 상품
 *  B. 오늘의 행운은 누구에게? — 접속 중인 일반 참가자 중 서로 다른 3명에게 배민 상품권
 *     · 시작 순간 후보 확정 → 서버가 당첨자 확정·기록 → 운영자가 한 명씩 공개
 *
 * 두 이벤트는 대상(팀 / 개인)·상품·기록이 완전히 분리되어 있습니다.
 */
import { randomInt } from 'node:crypto';
import {
  GACHA_SPIN_MS,
  ITEM,
  LUCKY_SPIN_MS,
  PAIR_ITEMS,
  STAGE_IDLE,
  type LuckyInfo,
  type PairInfo,
  type StageState,
  type StageWinner,
} from '../shared/events';
import type { PlazaRoom } from './rooms/PlazaRoom';
import type { PrizeStore } from './PrizeStore';
import type { Session } from './sessions';

export interface StageDeps {
  plaza: PlazaRoom;
  prizes: PrizeStore;
  sessions: () => Session[];
  broadcast(st: StageState): void;
  tell(playerId: number, text: string): void;
  log(msg: string): void;
}

const GACHA_EVENT = '우수 PAIR 경품 가챠';
const LUCKY_EVENT = '오늘의 행운은 누구에게?';

export class EventStage {
  private st: StageState = { ...STAGE_IDLE };
  private seq = 0;

  constructor(private d: StageDeps) {}

  state(): StageState {
    return this.st;
  }

  private set(st: StageState) {
    this.st = st;
    this.d.broadcast(st);
  }

  clear() {
    this.set({ mode: 'idle', seq: ++this.seq });
  }

  // ================================================================ 우수 PAIR 가챠

  private get teams() {
    return this.d.prizes.data.pairTeams;
  }

  private pairAward(teamId: string) {
    return this.d.prizes.data.awards.find((a) => a.pool === 'pair' && a.teamId === teamId);
  }

  private remainingItems() {
    return PAIR_ITEMS.filter((id) => this.d.prizes.left(id, 'pair') > 0).map((id) => ({ id, name: this.d.prizes.item(id)!.name }));
  }

  pairInfo(): PairInfo {
    const assigned: PairInfo['assigned'] = {};
    for (const t of this.teams) {
      const a = this.pairAward(t.id);
      if (a) assigned[t.id] = { awardId: a.id, itemId: a.itemId, itemName: a.itemName, at: a.at, paid: a.paid };
    }
    return { teams: this.teams.map((t) => ({ ...t })), assigned, remaining: this.remainingItems(), log: [...this.d.prizes.data.gachaLog].slice(-40) };
  }

  /** 우수 PAIR 팀 명단은 고정이라 수정하지 않음 (예전 화면에서 보내도 거절) */
  saveTeams(_input: unknown): string | null {
    return '우수 PAIR 3팀 명단은 확정 명단으로 고정돼 있어요.';
  }

  /** 무대에 추첨할 팀을 띄움 (아직 결과 없음) */
  selectTeam(teamId: string): string | null {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return '팀을 찾을 수 없어요.';
    if (!team.name) return '먼저 팀 이름을 입력하고 저장해주세요.';
    if (this.pairAward(teamId)) return '이미 추첨이 끝난 팀이에요. 다시 하려면 재추첨을 눌러주세요.';
    this.set({ mode: 'gacha', seq: ++this.seq, phase: 'ready', team: { ...team }, pool: this.remainingItems(), result: null, revealAt: 0, ...this.progress() });
    return null;
  }

  private progress() {
    return { done: this.teams.filter((t) => this.pairAward(t.id)).length, total: this.teams.length };
  }

  /** 가챠 시작: 서버가 먼저 상품을 확정·기록한 뒤 연출 시작 */
  drawTeam(teamId: string): string | null {
    const team = this.teams.find((t) => t.id === teamId);
    if (!team) return '팀을 찾을 수 없어요.';
    if (!team.name) return '먼저 팀 이름을 입력하고 저장해주세요.';
    if (this.pairAward(teamId)) return '이미 추첨이 끝난 팀이에요.';
    const pool = this.remainingItems();
    if (!pool.length) return '남은 상품이 없어요. 상품 관리에서 재고를 확인해주세요.';
    const pick = pool[randomInt(pool.length)];
    const award = this.d.prizes.award('pair', pick.id, { playerId: 0, ownerKey: '', nickname: team.name, teamId: team.id }, GACHA_EVENT, 0);
    if (!award) return '상품을 배정하지 못했어요. 다시 시도해주세요.';
    this.d.prizes.logGacha({ action: 'draw', teamId: team.id, teamName: team.name, itemId: pick.id, itemName: pick.name });
    this.d.log(`PAIR 가챠: ${team.name} → ${pick.name}`);
    this.set({ mode: 'gacha', seq: ++this.seq, phase: 'spin', team: { ...team }, pool, result: pick, revealAt: Date.now() + GACHA_SPIN_MS, ...this.progress() });
    return null;
  }

  /** 재추첨: 이 팀의 배정을 취소해 상품을 남은 후보로 되돌림 (운영자 확인 후) */
  redrawTeam(teamId: string): string | null {
    const a = this.pairAward(teamId);
    if (!a) return '아직 추첨하지 않은 팀이에요.';
    const r = this.d.prizes.revoke(a.id);
    if (r) return r;
    this.d.prizes.logGacha({ action: 'redraw', teamId, teamName: a.nickname, itemId: a.itemId, itemName: a.itemName });
    this.d.log(`PAIR 가챠 재추첨: ${a.nickname} (${a.itemName} 배정 취소)`);
    if (this.st.mode !== 'idle') this.clear();
    return null;
  }

  resetPair(): string | null {
    const list = this.d.prizes.data.awards.filter((a) => a.pool === 'pair');
    if (list.some((a) => a.paid)) return '지급 완료된 상품이 있어요. 먼저 지급 표시를 해제해주세요.';
    for (const a of list) {
      this.d.prizes.revoke(a.id);
      this.d.prizes.logGacha({ action: 'reset', teamId: a.teamId ?? '', teamName: a.nickname, itemId: a.itemId, itemName: a.itemName });
    }
    this.d.log('PAIR 가챠 전체 초기화');
    this.clear();
    return null;
  }

  pairSummary(): string | null {
    const results = this.teams
      .map((t) => ({ t, a: this.pairAward(t.id) }))
      .filter((x) => x.a)
      .map(({ t, a }) => ({ team: { ...t }, itemId: a!.itemId, itemName: a!.itemName }));
    if (!results.length) return '아직 추첨한 팀이 없어요.';
    this.set({ mode: 'gachaSummary', seq: ++this.seq, results });
    return null;
  }

  // ================================================================ 오늘의 행운은 누구에게? (배민 3명)

  private hsWinnerKeys() {
    return new Set(this.d.prizes.data.awards.filter((a) => a.pool === 'hideseek').map((a) => a.ownerKey));
  }

  /** 지금 추첨 대상: 접속 중 · 운영자 아님 · 같은 사람(기기) 중복 없음 · 이미 당첨 아님 */
  candidates() {
    const sessions = new Map(this.d.sessions().map((s) => [s.playerId, s]));
    const drawn = new Set(this.d.prizes.data.awards.filter((a) => a.pool === 'draw').map((a) => a.ownerKey));
    const hs = this.d.prizes.data.settings.excludeHsWinner ? this.hsWinnerKeys() : new Set<string>();
    const byKey = new Map<string, { id: number; key: string }>();
    for (const p of this.d.plaza.list()) {
      const s = sessions.get(p.id);
      if (!s || s.admin || p.status !== 'online') continue;
      if (drawn.has(s.ownerKey) || hs.has(s.ownerKey)) continue;
      if (!byKey.has(s.ownerKey)) byKey.set(s.ownerKey, { id: p.id, key: s.ownerKey });
    }
    return [...byKey.values()].map(({ id, key }) => ({ ...this.d.plaza.get(id)!, ownerKey: key }));
  }

  luckyInfo(): LuckyInfo {
    const it = this.d.prizes.item(ITEM.baemin)!;
    return {
      candidates: this.candidates().map((p) => ({ id: p.id, nickname: p.nickname, grade: p.grade, gradeText: p.gradeText, role: p.role })),
      excludeHsWinner: this.d.prizes.data.settings.excludeHsWinner,
      need: this.d.prizes.left(ITEM.baemin, 'draw'),
      alloc: it.alloc.draw,
      used: this.d.prizes.used(ITEM.baemin, 'draw'),
    };
  }

  setExcludeHs(v: boolean) {
    this.d.prizes.data.settings.excludeHsWinner = v;
    this.d.prizes.save();
  }

  /** 무대에 추첨 화면만 띄움 */
  luckyReady(): string | null {
    const c = this.candidates();
    this.set({ mode: 'lucky', seq: ++this.seq, phase: 'ready', names: c.map((p) => p.nickname).slice(0, 40), winners: [], revealed: 0, revealAt: 0, candidateCount: c.length });
    return null;
  }

  /** 추첨: 시작 순간 후보 확정 → 서로 다른 당첨자를 서버가 뽑아 기록 */
  luckyDraw(): string | null {
    if (this.st.mode === 'lucky' && this.st.phase === 'drawn' && this.st.revealed < this.st.winners.length) return '아직 공개하지 않은 당첨자가 있어요.';
    const need = this.d.prizes.left(ITEM.baemin, 'draw');
    if (need < 1) return '랜덤 추첨용 상품권이 남아 있지 않아요. (상품 관리에서 할당 확인)';
    const pool = this.candidates();
    if (pool.length < need) return `추첨 대상이 ${pool.length}명이라 ${need}명을 뽑을 수 없어요. 참가자가 더 접속한 뒤 시작해주세요.`;
    const picked: typeof pool = [];
    const rest = [...pool];
    for (let i = 0; i < need; i++) picked.push(rest.splice(randomInt(rest.length), 1)[0]);
    const winners: StageWinner[] = [];
    this.winnerIds = [];
    for (const p of picked) {
      const a = this.d.prizes.award('draw', ITEM.baemin, { playerId: p.id, ownerKey: p.ownerKey, nickname: p.nickname }, LUCKY_EVENT, 0);
      if (!a) break;
      winners.push({ nickname: p.nickname, look: p.look, grade: p.grade, gradeText: p.gradeText, role: p.role, team: p.team });
      this.winnerIds.push(p.id);
    }
    this.d.log(`행운 추첨: ${winners.map((w) => w.nickname).join(', ')} (후보 ${pool.length}명)`);
    this.set({ mode: 'lucky', seq: ++this.seq, phase: 'drawn', names: pool.map((p) => p.nickname).slice(0, 40), winners, revealed: 0, revealAt: 0, candidateCount: pool.length });
    return null;
  }
  private winnerIds: number[] = [];

  /** 다음 당첨자 공개 (운영자가 타이밍 조절) */
  luckyReveal(): string | null {
    const s = this.st;
    if (s.mode !== 'lucky' || s.phase !== 'drawn') return '먼저 추첨을 시작해주세요.';
    if (s.revealed >= s.winners.length) return '모든 당첨자를 공개했어요.';
    const idx = s.revealed;
    this.set({ ...s, seq: ++this.seq, revealed: idx + 1, revealAt: Date.now() + LUCKY_SPIN_MS });
    const pid = this.winnerIds[idx];
    if (pid !== undefined) setTimeout(() => this.d.tell(pid, '축하해요! 배달의민족 상품권에 당첨됐어요. 행사장에서 받아가세요.'), LUCKY_SPIN_MS);
    return null;
  }

  luckySummary(): string | null {
    const all = this.d.prizes.data.awards.filter((a) => a.pool === 'draw');
    if (!all.length) return '아직 당첨자가 없어요.';
    const winners: StageWinner[] = all.map((a) => {
      const p = this.d.plaza.get(a.playerId);
      return { nickname: a.nickname, look: p?.look ?? 0, grade: p?.grade ?? 0, gradeText: p?.gradeText ?? '', role: p?.role ?? 'junior', team: p?.team ?? -1 };
    });
    this.set({ mode: 'luckySummary', seq: ++this.seq, winners });
    return null;
  }
}
