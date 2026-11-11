/**
 * 이스터에그 · 칭호 저장소 (data/eggs.json)
 *  - 이스터에그별 설정(사용 여부·조건값·전체 공개)과 최초 달성자
 *  - 참가자(기기 키)별 보유 칭호와 장착 칭호
 * 진행도(머문 시간·횟수)는 메모리에만 두고, 달성 기록은 파일에 남깁니다.
 * Node 는 한 번에 한 요청만 처리하므로 tryAward 는 그대로 '먼저 확정된 한 명'이 됩니다.
 */
import { EGG_BY_ID, EGGS, type EggAdminRow, type EggId, type MyTitles } from '../shared/events';
import { JsonFile } from './JsonFile';

interface EggRecord {
  enabled: boolean;
  need: number;
  broadcast: boolean;
  winner: { ownerKey: string; nickname: string; at: number } | null;
}

interface Data {
  eggs: Record<string, EggRecord>;
  titles: Record<string, { owned: EggId[]; equipped: EggId | null }>;
}

export class EggStore {
  data: Data = { eggs: {}, titles: {} };
  /** ownerKey → 이스터에그 → 진행도 */
  private progress = new Map<string, Partial<Record<EggId, number>>>();
  private zones = new Map<string, Set<string>>();
  private file: JsonFile<Data>;

  constructor(file: string) {
    this.file = new JsonFile(file, () => this.data);
    const raw = this.file.read() as Partial<Data> | null;
    for (const e of EGGS) this.data.eggs[e.id] = { enabled: true, need: e.need, broadcast: true, winner: null, ...(raw?.eggs?.[e.id] ?? {}) };
    if (raw?.titles) this.data.titles = raw.titles;
  }

  rec(id: EggId) {
    return this.data.eggs[id];
  }

  /** 진행도 더하기 → 조건을 채우면 true */
  add(ownerKey: string, id: EggId, n = 1): boolean {
    const r = this.rec(id);
    if (!r?.enabled || r.winner) return false;
    const p = this.progress.get(ownerKey) ?? {};
    p[id] = (p[id] ?? 0) + n;
    this.progress.set(ownerKey, p);
    return p[id]! >= r.need;
  }

  /** 구역 방문 기록 → 방문한 구역 수 */
  visit(ownerKey: string, zone: string): number {
    const s = this.zones.get(ownerKey) ?? new Set();
    s.add(zone);
    this.zones.set(ownerKey, s);
    return s.size;
  }

  /** 최초 달성자로 확정 (이미 있으면 null) */
  tryAward(id: EggId, ownerKey: string, nickname: string): { equipped: boolean } | null {
    const r = this.rec(id);
    if (!r?.enabled || r.winner) return null;
    r.winner = { ownerKey, nickname, at: Date.now() };
    const t = this.data.titles[ownerKey] ?? { owned: [], equipped: null };
    if (!t.owned.includes(id)) t.owned.push(id);
    const equipped = !t.equipped;
    if (equipped) t.equipped = id;
    this.data.titles[ownerKey] = t;
    this.file.flush();
    return { equipped };
  }

  titlesOf(ownerKey: string): MyTitles {
    const t = this.data.titles[ownerKey];
    return {
      owned: (t?.owned ?? []).filter((id) => EGG_BY_ID.has(id)).map((id) => ({ id, title: EGG_BY_ID.get(id)!.title })),
      equipped: t?.equipped ?? null,
    };
  }

  equipped(ownerKey: string): EggId | null {
    return this.data.titles[ownerKey]?.equipped ?? null;
  }

  equip(ownerKey: string, id: EggId | null): string | null {
    const t = this.data.titles[ownerKey];
    if (id !== null && !t?.owned.includes(id)) return '아직 얻지 못한 칭호예요.';
    if (!t) return null;
    t.equipped = id;
    this.file.save();
    return null;
  }

  /** 운영자 설정 변경 */
  set(id: EggId, o: { enabled?: boolean; need?: number; broadcast?: boolean }): string | null {
    const r = this.rec(id);
    if (!r) return '이스터에그를 찾을 수 없어요.';
    if (o.need !== undefined) {
      if (!Number.isInteger(o.need) || o.need < 1 || o.need > 3600) return '조건값은 1~3600 사이 정수로 입력해주세요.';
      r.need = o.need;
    }
    if (typeof o.enabled === 'boolean') r.enabled = o.enabled;
    if (typeof o.broadcast === 'boolean') r.broadcast = o.broadcast;
    this.file.flush();
    return null;
  }

  /** 이 이스터에그 기록만 초기화 (달성자 칭호도 회수). 칭호를 뺏긴 ownerKey 를 돌려줌 */
  reset(id: EggId): string | null {
    const r = this.rec(id);
    if (!r) return null;
    const owner = r.winner?.ownerKey ?? null;
    r.winner = null;
    for (const p of this.progress.values()) delete p[id];
    if (id === 'explorer') this.zones.clear();
    if (owner) {
      const t = this.data.titles[owner];
      if (t) {
        t.owned = t.owned.filter((x) => x !== id);
        if (t.equipped === id) t.equipped = t.owned[0] ?? null;
      }
    }
    this.file.flush();
    return owner;
  }

  adminRows(): EggAdminRow[] {
    return EGGS.map((e) => {
      const r = this.rec(e.id);
      return { id: e.id, title: e.title, rule: e.rule, kind: e.kind, enabled: r.enabled, need: r.need, broadcast: r.broadcast, winner: r.winner };
    });
  }

  toCSV(): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const t = (ms: number | undefined) => (ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '');
    const rows = [['칭호', '조건', '조건값', '사용', '전체 공개', '최초 달성자', '달성 시각']];
    for (const r of this.adminRows())
      rows.push([r.title, r.rule, String(r.need), r.enabled ? '사용' : '중지', r.broadcast ? '전체' : '개인', r.winner?.nickname ?? '', t(r.winner?.at)]);
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  flush() {
    this.file.flush();
  }
}
