/**
 * 상품 저장소 (data/prizes.json)
 *  - 상품별 전체 수량과 이벤트(풀)별 할당량: 배달의민족 상품권 4장 = 숨바꼭질 1 + 랜덤 추첨(3차) 3
 *  - 당첨·지급 기록, 숨바꼭질 회차 기록
 * 할당량을 넘는 배정은 하지 않으므로 이벤트를 다시 시작해도 상품이 중복 배정되지 않습니다.
 * 3차 랜덤 추첨은 award('draw', …) 를 그대로 쓰면 됩니다.
 */
import type { HsRoundLog, PrizeAward, PrizeItem, PrizePool, PrizeSummary } from '../shared/events';
import { JsonFile } from './JsonFile';

interface Data {
  items: PrizeItem[];
  awards: PrizeAward[];
  rounds: HsRoundLog[];
  nextId: number;
}

export const BAEMIN = 'baemin';

const DEFAULT_ITEMS: PrizeItem[] = [{ id: BAEMIN, name: '배달의민족 상품권', total: 4, alloc: { hideseek: 1, draw: 3 } }];

export class PrizeStore {
  data: Data = { items: structuredClone(DEFAULT_ITEMS), awards: [], rounds: [], nextId: 1 };
  private file: JsonFile<Data>;

  constructor(file: string) {
    this.file = new JsonFile(file, () => this.data);
    const raw = this.file.read() as Partial<Data> | null;
    if (raw) {
      if (Array.isArray(raw.items) && raw.items.length) this.data.items = raw.items;
      if (Array.isArray(raw.awards)) this.data.awards = raw.awards;
      if (Array.isArray(raw.rounds)) this.data.rounds = raw.rounds;
      this.data.nextId = Math.max(raw.nextId ?? 1, ...this.data.awards.map((a) => a.id + 1));
    }
  }

  item(id: string) {
    return this.data.items.find((i) => i.id === id);
  }

  used(itemId: string, pool: PrizePool) {
    return this.data.awards.filter((a) => a.itemId === itemId && a.pool === pool).reduce((n, a) => n + a.qty, 0);
  }

  /** 할당량이 남아 있으면 배정하고 기록을 돌려줌 (없으면 null) */
  award(pool: PrizePool, itemId: string, who: { playerId: number; ownerKey: string; nickname: string }, eventName: string, round: number): PrizeAward | null {
    const item = this.item(itemId);
    if (!item) return null;
    if (this.used(itemId, pool) + 1 > (item.alloc[pool] ?? 0)) return null;
    const a: PrizeAward = {
      id: this.data.nextId++,
      pool,
      eventName,
      round,
      ...who,
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
    for (const k of Object.keys(next) as PrizePool[]) {
      const v = alloc[k];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > 99) return '할당 수량은 0~99 사이 정수로 입력해주세요.';
      next[k] = v;
    }
    if (!Number.isInteger(total) || total < 0 || total > 99) return '전체 수량은 0~99 사이 정수로 입력해주세요.';
    const sum = Object.values(next).reduce((a, b) => a + b, 0);
    if (sum > total) return `할당 합계(${sum})가 전체 수량(${total})보다 많아요.`;
    for (const k of Object.keys(next) as PrizePool[])
      if (next[k] < this.used(itemId, k)) return `이미 배정된 수량(${this.used(itemId, k)})보다 적게 줄일 수 없어요.`;
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

  summary(): PrizeSummary {
    return {
      items: this.data.items.map((i) => ({ ...i, used: { hideseek: this.used(i.id, 'hideseek'), draw: this.used(i.id, 'draw') } })),
      awards: [...this.data.awards],
      rounds: [...this.data.rounds],
    };
  }

  toCSV(): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const t = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '');
    const rows = [['번호', '이벤트', '회차', '참가자 ID', '닉네임', '당첨 시각', '상품', '수량', '지급 여부', '지급 시각']];
    for (const a of this.data.awards)
      rows.push([String(a.id), a.eventName, String(a.round), String(a.playerId), a.nickname, t(a.at), a.itemName, String(a.qty), a.paid ? '지급' : '미지급', t(a.paidAt)]);
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  flush() {
    this.file.flush();
  }
}
