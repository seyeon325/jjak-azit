/**
 * 상품 저장소 (data/prizes.json)
 *  - 상품별 전체 수량과 이벤트(풀)별 할당량
 *      배달의민족 상품권 4장 = 숨바꼭질 1 + 오늘의 행운 추첨 3
 *      우수 PAIR 경품 3종 (빔프로젝터·랜덤 말랑이 세트·붕어빵 보조배터리 손난로) 각 1개 = PAIR 가챠
 *  - 당첨·지급 기록, 숨바꼭질 회차 기록, 우수 PAIR 팀 정보, 가챠 이력, 행운 추첨 설정
 * 할당량을 넘는 배정은 하지 않으므로 이벤트를 다시 해도 상품이 중복 배정되지 않습니다.
 * Node 는 한 번에 한 요청만 처리하므로 award() 는 그대로 '원자적 확정'이 됩니다.
 */
import { ITEM, PAIR_TEAMS, PRIZE_POOLS, type GachaLog, type HsRoundLog, type PairTeam, type PrizeAward, type PrizeItem, type PrizePool, type PrizeSummary } from '../shared/events';
import { JsonFile } from './JsonFile';

interface Data {
  items: PrizeItem[];
  awards: PrizeAward[];
  rounds: HsRoundLog[];
  nextId: number;
  pairTeams: PairTeam[];
  gachaLog: GachaLog[];
  settings: { excludeHsWinner: boolean };
}

export const BAEMIN = ITEM.baemin;

const zero = (): Record<PrizePool, number> => ({ hideseek: 0, draw: 0, pair: 0 });
const DEFAULT_ITEMS: PrizeItem[] = [
  { id: ITEM.baemin, name: '배달의민족 상품권', total: 4, alloc: { ...zero(), hideseek: 1, draw: 3 } },
  { id: ITEM.projector, name: '빔프로젝터', total: 1, alloc: { ...zero(), pair: 1 } },
  { id: ITEM.squishy, name: '랜덤 말랑이 세트', total: 1, alloc: { ...zero(), pair: 1 } },
  { id: ITEM.fishwarmer, name: '붕어빵 보조배터리 손난로', total: 1, alloc: { ...zero(), pair: 1 } },
];
/** 우수 PAIR 3팀 — 확정 명단으로 고정 (저장 파일의 예전 팀 정보는 쓰지 않음) */
const DEFAULT_TEAMS: PairTeam[] = PAIR_TEAMS.map((t) => ({ ...t }));

export class PrizeStore {
  data: Data = {
    items: structuredClone(DEFAULT_ITEMS),
    awards: [],
    rounds: [],
    nextId: 1,
    pairTeams: structuredClone(DEFAULT_TEAMS),
    gachaLog: [],
    settings: { excludeHsWinner: true },
  };
  private file: JsonFile<Data>;

  constructor(file: string) {
    this.file = new JsonFile(file, () => this.data);
    const raw = this.file.read() as Partial<Data> | null;
    if (raw) {
      if (Array.isArray(raw.items) && raw.items.length) {
        // 이전 버전 파일: 할당 칸 보충, 새 상품 추가
        const items = raw.items.map((i) => ({ ...i, alloc: { ...zero(), ...i.alloc } }));
        for (const d of DEFAULT_ITEMS) if (!items.some((i) => i.id === d.id)) items.push(structuredClone(d));
        this.data.items = items;
      }
      if (Array.isArray(raw.awards)) this.data.awards = raw.awards;
      if (Array.isArray(raw.rounds)) this.data.rounds = raw.rounds;
      // 팀 명단은 항상 고정 명단 사용. 이미 저장된 가챠 결과(awards)는 팀 id 로 그대로 유지하고 표시 이름만 맞춤
      for (const a of this.data.awards) if (a.pool === 'pair' && a.teamId) a.nickname = DEFAULT_TEAMS.find((t) => t.id === a.teamId)?.name ?? a.nickname;
      if (Array.isArray(raw.gachaLog)) this.data.gachaLog = raw.gachaLog;
      if (raw.settings) this.data.settings = { ...this.data.settings, ...raw.settings };
      this.data.nextId = Math.max(raw.nextId ?? 1, ...this.data.awards.map((a) => a.id + 1));
    }
  }

  item(id: string) {
    return this.data.items.find((i) => i.id === id);
  }

  used(itemId: string, pool: PrizePool) {
    return this.data.awards.filter((a) => a.itemId === itemId && a.pool === pool).reduce((n, a) => n + a.qty, 0);
  }

  /** 이 풀에 남은 수량 */
  left(itemId: string, pool: PrizePool) {
    const it = this.item(itemId);
    return it ? Math.max(0, (it.alloc[pool] ?? 0) - this.used(itemId, pool)) : 0;
  }

  /** 할당량이 남아 있으면 배정하고 기록을 돌려줌 (없으면 null) */
  award(
    pool: PrizePool,
    itemId: string,
    who: { playerId: number; ownerKey: string; nickname: string; teamId?: string },
    eventName: string,
    round: number,
  ): PrizeAward | null {
    const item = this.item(itemId);
    if (!item) return null;
    if (this.left(itemId, pool) < 1) return null;
    const a: PrizeAward = {
      id: this.data.nextId++,
      pool,
      eventName,
      round,
      playerId: who.playerId,
      ownerKey: who.ownerKey,
      nickname: who.nickname,
      ...(who.teamId ? { teamId: who.teamId } : {}),
      at: Date.now(),
      itemId,
      itemName: item.name,
      qty: 1,
      paid: false,
      paidAt: null,
    };
    this.data.awards.push(a);
    this.file.flush();
    return a;
  }

  setPaid(awardId: number, paid: boolean): string | null {
    const a = this.data.awards.find((x) => x.id === awardId);
    if (!a) return '당첨 기록을 찾을 수 없어요.';
    a.paid = paid;
    a.paidAt = paid ? Date.now() : null;
    this.file.flush();
    return null;
  }

  /** 배정 취소 (운영자가 명시적으로 요청한 경우만) → 할당량이 다시 남음 */
  revoke(awardId: number): string | null {
    const i = this.data.awards.findIndex((x) => x.id === awardId);
    if (i < 0) return '당첨 기록을 찾을 수 없어요.';
    if (this.data.awards[i].paid) return '이미 지급한 상품은 취소할 수 없어요. 먼저 지급 표시를 해제해주세요.';
    this.data.awards.splice(i, 1);
    this.file.flush();
    return null;
  }

  /** 수량·할당 변경 (운영자) */
  setAlloc(itemId: string, total: number, alloc: Partial<Record<PrizePool, number>>): string | null {
    const item = this.item(itemId);
    if (!item) return '상품을 찾을 수 없어요.';
    const next = { ...item.alloc };
    for (const k of PRIZE_POOLS) {
      const v = alloc[k];
      if (v === undefined || Number.isNaN(v)) continue;
      if (!Number.isInteger(v) || v < 0 || v > 99) return '할당 수량은 0~99 사이 정수로 입력해주세요.';
      next[k] = v;
    }
    if (!Number.isInteger(total) || total < 0 || total > 99) return '전체 수량은 0~99 사이 정수로 입력해주세요.';
    const sum = PRIZE_POOLS.reduce((a, k) => a + next[k], 0);
    if (sum > total) return `할당 합계(${sum})가 전체 수량(${total})보다 많아요.`;
    for (const k of PRIZE_POOLS) if (next[k] < this.used(itemId, k)) return `이미 배정된 수량(${this.used(itemId, k)})보다 적게 줄일 수 없어요.`;
    item.total = total;
    item.alloc = next;
    this.file.flush();
    return null;
  }

  logRound(r: HsRoundLog) {
    this.data.rounds.push(r);
    if (this.data.rounds.length > 100) this.data.rounds.splice(0, this.data.rounds.length - 100);
    this.file.flush();
  }

  logGacha(l: Omit<GachaLog, 'at'>) {
    this.data.gachaLog.push({ ...l, at: Date.now() });
    if (this.data.gachaLog.length > 300) this.data.gachaLog.splice(0, this.data.gachaLog.length - 300);
    this.file.flush();
  }

  save() {
    this.file.flush();
  }

  summary(): PrizeSummary {
    return {
      items: this.data.items.map((i) => ({ ...i, used: Object.fromEntries(PRIZE_POOLS.map((p) => [p, this.used(i.id, p)])) as Record<PrizePool, number> })),
      awards: [...this.data.awards],
      rounds: [...this.data.rounds],
    };
  }

  toCSV(): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const t = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '');
    const rows = [['번호', '이벤트', '회차', '대상', '참가자 ID / 팀 ID', '닉네임 / 팀 이름', '당첨 시각', '상품', '수량', '지급 여부', '지급 시각']];
    for (const a of this.data.awards)
      rows.push([
        String(a.id),
        a.eventName,
        String(a.round),
        a.teamId ? '팀' : '개인',
        a.teamId ?? String(a.playerId),
        a.nickname,
        t(a.at),
        a.itemName,
        String(a.qty),
        a.paid ? '지급' : '미지급',
        t(a.paidAt),
      ]);
    rows.push([]);
    rows.push(['가챠 이력', '시각', '동작', '팀 ID', '팀 이름', '상품']);
    const act = { draw: '추첨', redraw: '재추첨(배정 취소)', reset: '초기화(배정 취소)', paid: '지급 표시' };
    for (const l of this.data.gachaLog) rows.push(['', t(l.at), act[l.action], l.teamId, l.teamName, l.itemName]);
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  flush() {
    this.file.flush();
  }
}
