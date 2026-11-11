/**
 * 과제 괴물을 물리쳐라! — 서버 판정
 *
 *  대기실(lobby) → 3초 카운트다운 → 전투
 *    1페이즈: 과제 폭탄(원) · 마감 임박(넓은 구역) · 수정 요청(세로 줄) — 모두 경고 표시 후 서버가 피격 판정
 *    2페이즈: 방어막 → 협동 구역(선배+후배, 부족하면 서로 다른 두 사람)이 채워지면 해제
 *    3페이즈: 마감 10초 전 최후의 일격 — 실제 인원의 절반 이상이 누르면 승리, 실패하면 잠시 뒤 재도전
 *  제한 시간이 지나면 실패. 영구 탈락 없음(쓰러져도 자동 부활, 동료가 살려주면 바로 부활)
 *  모든 통계는 서버가 직접 센 값만 사용합니다.
 */
import { bossMaxHp, RAID, RAID_AWARD_DEF, type RaidAward, type RaidFx, type RaidHazard, type RaidInput, type RaidP, type RaidPhase, type RaidResult, type RaidState, type RaidStats, type RaidZone } from '../shared/raid';
import type { PlayerInfo } from '../shared/protocol';
import { JsonFile } from './JsonFile';
import type { PlazaRoom } from './rooms/PlazaRoom';

interface Part {
  id: number;
  x: number;
  y: number;
  d: number;
  hp: number;
  downUntil: number;
  dodgeUntil: number;
  lastAtk: number;
  lastDodge: number;
  lastRevive: number;
  lastHelp: number;
  lastMove: number;
  stats: RaidStats;
}

export interface RaidDeps {
  plaza: PlazaRoom;
  isHostSession(id: number): boolean;
  broadcast(st: RaidState): void;
  fx(list: RaidFx[]): void;
  log(msg: string): void;
}

interface History {
  runs: (RaidResult & { at: number; awards: { title: string; nickname: string }[]; stats: ({ id: number; nickname: string } & RaidStats)[] })[];
}

const TICK = 100;
const newStats = (): RaidStats => ({ attacks: 0, hits: 0, damage: 0, distance: 0, evades: 0, hitTaken: 0, downs: 0, revives: 0, coop: 0, final: false, playMs: 0 });

export class RaidGame {
  private phase: RaidPhase = 'off';
  private paused = false;
  private pausedAt = 0;
  private lobby = new Set<number>();
  private parts = new Map<number, Part>();
  private boss = { hp: 0, max: 0, shield: false, mood: 'idle' as RaidState['boss']['mood'], moodUntil: 0, msg: null as string | null, msgUntil: 0 };
  private stage: 1 | 2 | 3 = 1;
  private zones: RaidZone[] = [];
  private zonesNeed = 0;
  private hazards: RaidHazard[] = [];
  private nextHazardId = 1;
  private nextPatternAt = 0;
  private patternIdx = 0;
  private final: { endsAt: number; ids: Set<number>; need: number } | null = null;
  private finalRetryAt = 0;
  private countdownEnd = 0;
  private startedAt = 0;
  private endsAt = 0;
  private banner: string | null = null;
  private bannerUntil = 0;
  private result: RaidResult | null = null;
  private awards: RaidAward[] = [];
  private shown = 0;
  private fxq: RaidFx[] = [];
  private timer: NodeJS.Timeout | null = null;
  private file: JsonFile<History>;
  private history: History = { runs: [] };

  constructor(
    private d: RaidDeps,
    file: string,
  ) {
    this.file = new JsonFile(file, () => this.history);
    const raw = this.file.read() as History | null;
    if (raw?.runs) this.history = raw;
  }

  get active() {
    return this.phase !== 'off';
  }
  get inBattle() {
    return this.phase === 'countdown' || this.phase === 'battle';
  }
  isParticipant(id: number) {
    return this.parts.has(id) || this.lobby.has(id);
  }

  // ---------------------------------------------------------------- 상태

  state(now = Date.now()): RaidState {
    const players: RaidP[] = [...this.parts.values()].map((p) => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.hp, p.downUntil > now ? 1 : p.dodgeUntil > now ? 2 : 0, p.d]);
    return {
      phase: this.phase,
      paused: this.paused,
      now,
      countdownEnd: this.countdownEnd,
      endsAt: this.endsAt,
      stage: this.stage,
      boss: {
        hp: Math.ceil(this.boss.hp),
        max: this.boss.max,
        shield: this.boss.shield,
        mood: this.boss.mood,
        msg: this.boss.msgUntil > now ? this.boss.msg : null,
        x: RAID.bossX + (this.phase === 'battle' ? Math.round(Math.sin(now / 900) * (this.stage === 1 ? 10 : 18)) : 0),
      },
      players,
      joined: [...this.lobby],
      zones: this.zones,
      zonesNeed: this.zonesNeed,
      hazards: this.hazards,
      final: this.final ? { endsAt: this.final.endsAt, ids: [...this.final.ids], need: this.final.need } : null,
      banner: this.bannerUntil > now ? this.banner : null,
      result: this.result,
      awards: this.awards,
      shown: this.shown,
    };
  }

  private push() {
    this.d.broadcast(this.state());
  }

  private say(text: string, ms = 2600) {
    this.banner = text;
    this.bannerUntil = Date.now() + ms;
  }

  private bossSay(text: string, ms = 1800) {
    this.boss.msg = text;
    this.boss.msgUntil = Date.now() + ms;
  }

  private mood(m: RaidState['boss']['mood'], ms: number) {
    if (this.boss.mood === 'broken' || this.boss.mood === 'off') return;
    this.boss.mood = m;
    this.boss.moodUntil = Date.now() + ms;
  }

  // ---------------------------------------------------------------- 학회장 조작

  open(): string | null {
    if (this.inBattle) return '레이드가 진행 중이에요.';
    this.reset(false);
    this.phase = 'lobby';
    this.say('과제 괴물이 나타날 준비를 하고 있어요!', 4000);
    this.d.log('레이드 대기실 열림');
    this.startLoop();
    this.push();
    return null;
  }

  start(): string | null {
    if (this.phase !== 'lobby') return '먼저 대기실을 열어주세요.';
    const ids = [...this.lobby].filter((id) => this.d.plaza.has(id));
    if (!ids.length) return '아직 참여한 사람이 없어요.';
    const now = Date.now();
    ids.forEach((id, i) => this.addPart(id, i, ids.length));
    this.boss.max = bossMaxHp(ids.length);
    this.boss.hp = this.boss.max;
    this.phase = 'countdown';
    this.countdownEnd = now + RAID.countdownMs;
    this.d.log(`레이드 시작 (${ids.length}명, 보스 체력 ${this.boss.max})`);
    this.push();
    return null;
  }

  pause(): string | null {
    if (!this.inBattle || this.paused) return '일시정지할 수 없어요.';
    this.paused = true;
    this.pausedAt = Date.now();
    this.say('잠시 멈춤', 60_000);
    this.push();
    return null;
  }

  resume(): string | null {
    if (!this.paused) return '일시정지 상태가 아니에요.';
    const dt = Date.now() - this.pausedAt;
    this.paused = false;
    // 멈춘 시간만큼 모든 시각을 뒤로 밀기
    this.countdownEnd += dt;
    this.endsAt += dt;
    this.nextPatternAt += dt;
    this.finalRetryAt += dt;
    if (this.final) this.final.endsAt += dt;
    for (const h of this.hazards) {
      h.at += dt;
      h.hitAt += dt;
    }
    for (const p of this.parts.values()) {
      if (p.downUntil) p.downUntil += dt;
      p.lastMove = Date.now();
    }
    this.bannerUntil = 0;
    this.push();
    return null;
  }

  /** 강제 종료: 기록은 남기고 대기 전 상태로 */
  stop(): string | null {
    if (!this.active) return '진행 중인 레이드가 없어요.';
    if (this.phase === 'battle' || this.phase === 'countdown') this.finish(false);
    this.close();
    return null;
  }

  /** 재시작: 같은 대기실 인원으로 다시 */
  restart(): string | null {
    const keep = new Set([...this.lobby, ...this.parts.keys()]);
    this.reset(false);
    for (const id of keep) if (this.d.plaza.has(id) && !this.d.isHostSession(id)) this.lobby.add(id);
    this.phase = 'lobby';
    this.startLoop();
    this.push();
    return null;
  }

  beginAwards(): string | null {
    if (this.phase !== 'victory' && this.phase !== 'defeat') return '레이드가 끝난 뒤에 시상식을 할 수 있어요.';
    this.phase = 'awards';
    this.shown = 0;
    this.push();
    return null;
  }

  next(): string | null {
    if (this.phase !== 'awards') return '시상식 중이 아니에요.';
    if (this.shown >= this.awards.length) return '모든 수상자를 공개했어요.';
    this.shown++;
    this.push();
    return null;
  }

  prev(): string | null {
    if (this.phase !== 'awards' || this.shown <= 0) return '이전 화면이 없어요.';
    this.shown--;
    this.push();
    return null;
  }

  all(): string | null {
    if (this.phase !== 'awards') return '시상식 중이 아니에요.';
    this.shown = this.awards.length;
    this.push();
    return null;
  }

  /** 아지트 복귀 */
  close() {
    this.reset(true);
    this.phase = 'off';
    this.stopLoop();
    this.push();
  }

  private reset(clearLobby: boolean) {
    if (clearLobby) this.lobby.clear();
    this.parts.clear();
    this.boss = { hp: 0, max: 0, shield: false, mood: 'idle', moodUntil: 0, msg: null, msgUntil: 0 };
    this.stage = 1;
    this.zones = [];
    this.zonesNeed = 0;
    this.hazards = [];
    this.final = null;
    this.finalRetryAt = 0;
    this.paused = false;
    this.result = null;
    this.awards = [];
    this.shown = 0;
    this.banner = null;
    this.bannerUntil = 0;
    this.calm = false;
  }

  // ---------------------------------------------------------------- 참가자

  join(id: number): string | null {
    if (this.d.isHostSession(id)) return '학회장은 전투에 참여하지 않아요. 관전 화면에서 진행해주세요.';
    if (this.phase === 'lobby') {
      this.lobby.add(id);
      this.push();
      return null;
    }
    if (this.phase === 'countdown' || this.phase === 'battle') {
      if (!this.parts.has(id)) this.addPart(id, this.parts.size, this.parts.size + 1);
      this.lobby.add(id);
      return null;
    }
    return '지금은 참여할 수 없어요.';
  }

  leave(id: number) {
    if (this.phase === 'lobby') {
      this.lobby.delete(id);
      this.push();
    }
  }

  /** 아지트에서 완전히 나간 사람 정리 */
  removePlayer(id: number) {
    this.lobby.delete(id);
    this.parts.delete(id);
  }

  private addPart(id: number, i: number, n: number) {
    const cols = Math.min(n, 10);
    const row = Math.floor(i / 10);
    const x = RAID.W / 2 + ((i % 10) - (cols - 1) / 2) * 30;
    const y = RAID.H - 34 - row * 22;
    this.parts.set(id, { id, x, y, d: 1, hp: RAID.playerHp, downUntil: 0, dodgeUntil: 0, lastAtk: 0, lastDodge: 0, lastRevive: 0, lastHelp: 0, lastMove: Date.now(), stats: newStats() });
  }

  private activeParts(now = Date.now()) {
    return [...this.parts.values()].filter((p) => this.d.plaza.get(p.id)?.status === 'online' && p.downUntil <= now);
  }

  private onlineParts() {
    return [...this.parts.values()].filter((p) => this.d.plaza.get(p.id)?.status === 'online');
  }

  input(id: number, inp: RaidInput) {
    const p = this.parts.get(id);
    if (!p || this.phase !== 'battle' || this.paused) {
      if (p && this.phase === 'countdown' && typeof inp.x === 'number') this.move(p, inp, Date.now());
      return;
    }
    const now = Date.now();
    if (typeof inp.x === 'number' && typeof inp.y === 'number') this.move(p, inp, now);
    if (!inp.a) return;
    const down = p.downUntil > now;
    if (inp.a === 'atk' && !down) this.attack(p, now);
    if (inp.a === 'dodge' && !down && now - p.lastDodge >= RAID.dodgeCd) {
      p.lastDodge = now;
      p.dodgeUntil = now + RAID.dodgeMs;
    }
    if (inp.a === 'revive' && !down) this.revive(p, now);
    // 쓰러진 사람이 외치는 '살려줘!' (모두의 화면에 크게)
    if (inp.a === 'help' && down && now - p.lastHelp >= RAID.helpCd) {
      p.lastHelp = now;
      this.fxq.push({ k: 'help', id: p.id });
    }
    if (inp.a === 'final' && !down && this.final && now < this.final.endsAt) {
      this.final.ids.add(p.id);
      this.fxq.push({ k: 'final', id: p.id });
      if (this.final.ids.size >= this.final.need) this.victory();
    }
  }

  private move(p: Part, inp: RaidInput, now: number) {
    if (p.downUntil > now) return;
    const x = Math.max(8, Math.min(RAID.W - 8, Number(inp.x)));
    const y = Math.max(40, Math.min(RAID.H - 6, Number(inp.y)));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dt = Math.min(1, Math.max(0.05, (now - p.lastMove) / 1000));
    const allow = RAID.speed * dt * 1.6 + 10 + (p.dodgeUntil > now - 200 ? RAID.dodgeDist : 0);
    const dist = Math.hypot(x - p.x, y - p.y);
    p.lastMove = now;
    if (dist > allow) return; // 너무 먼 이동은 무시 (화면은 서버 위치로 되돌아감)
    // 보스 몸 안으로는 못 들어감
    const bx = x - RAID.bossX;
    const by = (y - RAID.bossY) * 1.3;
    if (Math.hypot(bx, by) < RAID.bossR) return;
    p.stats.distance += dist;
    p.x = x;
    p.y = y;
    if (typeof inp.d === 'number' && inp.d >= 0 && inp.d <= 3) p.d = inp.d;
  }

  private attack(p: Part, now: number) {
    if (now - p.lastAtk < RAID.atkCd) return;
    p.lastAtk = now;
    p.stats.attacks++;
    const inRange = Math.hypot(p.x - RAID.bossX, p.y - RAID.bossY) <= RAID.atkRange;
    this.fxq.push({ k: 'atk', id: p.id, v: inRange && !this.boss.shield ? 1 : 0 });
    if (!inRange || this.boss.shield || this.boss.hp <= 0) return;
    // 3페이즈(최후의 일격 전)에는 체력 1 아래로는 안 내려감
    const floor = this.stage === 3 ? 1 : 0;
    const dmg = 1;
    const before = this.boss.hp;
    this.boss.hp = Math.max(floor, this.boss.hp - dmg);
    const real = before - this.boss.hp;
    p.stats.hits++;
    p.stats.damage += real;
    if (real > 0) this.mood('hurt', 250);
    this.checkStage(now);
  }

  private revive(p: Part, now: number) {
    if (now - p.lastRevive < 1500) return;
    for (const o of this.parts.values()) {
      if (o.id === p.id || o.downUntil <= now) continue;
      if (Math.hypot(o.x - p.x, o.y - p.y) > RAID.reviveR) continue;
      p.lastRevive = now;
      o.downUntil = 0;
      o.hp = RAID.playerHp;
      p.stats.revives++;
      this.fxq.push({ k: 'revive', id: o.id, v: p.id });
      return;
    }
  }

  // ---------------------------------------------------------------- 진행

  private startLoop() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK);
  }
  private stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    const now = Date.now();
    if (!this.paused) {
      if (this.phase === 'countdown' && now >= this.countdownEnd) {
        this.phase = 'battle';
        this.startedAt = now;
        this.endsAt = now + RAID.battleMs;
        this.nextPatternAt = now + 2500;
        this.say('밀린 과제를 처리하라!', 2600);
        this.bossSay('과제 제출 안 하셨죠?', 2200);
      }
      if (this.phase === 'battle') this.simulate(now);
    }
    if (this.boss.moodUntil && now > this.boss.moodUntil && this.boss.mood !== 'broken' && this.boss.mood !== 'off') {
      this.boss.mood = 'idle';
      this.boss.moodUntil = 0;
    }
    if (this.fxq.length) {
      this.d.fx(this.fxq);
      this.fxq = [];
    }
    this.push();
  }

  private simulate(now: number) {
    // 참여 시간
    for (const p of this.onlineParts()) p.stats.playMs += TICK;
    // 자동 부활
    for (const p of this.parts.values())
      if (p.downUntil && p.downUntil <= now) {
        p.downUntil = 0;
        p.hp = RAID.playerHp;
        this.fxq.push({ k: 'revive', id: p.id });
      }
    // 공격 판정
    for (const h of this.hazards) if (h.hitAt <= now) this.resolve(h, now);
    this.hazards = this.hazards.filter((h) => h.hitAt > now);
    // 새 패턴
    if (now >= this.nextPatternAt && !this.final) this.pattern(now);
    // 협동 구역
    if (this.stage === 2 && this.boss.shield) this.coop(now);
    // 최후의 일격
    if (this.final && now >= this.final.endsAt && this.phase === 'battle') {
      this.final = null;
      this.finalRetryAt = now + RAID.finalRetryMs;
      this.say('제출 실패! 조금 더 공격하고 다시 도전해요', 2600);
      this.bossSay('ㅋㅋ 마감 연장 없음', 2000);
    }
    if (this.stage === 3 && !this.final && this.finalRetryAt && now >= this.finalRetryAt) this.openFinal(now);
    // 제한 시간
    if (now >= this.endsAt && this.phase === 'battle') this.finish(false);
  }

  private pattern(now: number) {
    if (this.calm) return;
    const act = this.activeParts(now);
    if (!act.length) {
      this.nextPatternAt = now + 1500;
      return;
    }
    const n = act.length;
    const kinds: RaidHazard['kind'][] = this.stage === 2 ? ['bomb', 'revision'] : ['bomb', 'deadline', 'revision'];
    const kind = kinds[this.patternIdx++ % kinds.length];
    this.mood('angry', 900);
    const mk = (h: Omit<RaidHazard, 'id' | 'at'>) => this.hazards.push({ ...h, id: this.nextHazardId++, at: now });
    if (kind === 'bomb') {
      const cnt = Math.max(3, Math.min(14, Math.ceil(n * 0.6)));
      for (let i = 0; i < cnt; i++) {
        const t = act[i % n];
        mk({ kind, shape: 'circle', x: clamp(t.x + rnd(-24, 24), 20, RAID.W - 20), y: clamp(t.y + rnd(-18, 18), 50, RAID.H - 14), r: 20, w: 0, h: 0, hitAt: now + 1400 + i * 60 });
      }
    } else if (kind === 'deadline') {
      this.bossSay('DEADLINE!', 2000);
      const side = Math.random() < 0.5 ? 0 : 1;
      mk({ kind, shape: 'rect', x: side ? RAID.W / 2 + 10 : 0, y: 40, w: RAID.W / 2 - 10, h: RAID.H - 40, r: 0, hitAt: now + 2100 });
    } else {
      this.bossSay('교수님: 수정 부탁드립니다.', 2000);
      const lanes = Math.max(2, Math.min(6, Math.ceil(n / 4) + 1));
      const xs = new Set<number>();
      for (let i = 0; i < lanes; i++) xs.add(clamp(Math.round((act[(i * 7) % n].x + rnd(-10, 10)) / 8) * 8, 16, RAID.W - 16));
      for (const x of xs) mk({ kind, shape: 'rect', x: x - 13, y: 40, w: 26, h: RAID.H - 40, r: 0, hitAt: now + 1500 });
    }
    // 인원이 많을수록 조금 더 자주, 3페이즈는 숨 돌릴 틈
    const gap = this.stage === 3 ? 3600 : Math.max(2300, 3400 - n * 25);
    this.nextPatternAt = now + gap;
  }

  private inside(h: RaidHazard, x: number, y: number) {
    if (h.shape === 'circle') return Math.hypot(x - h.x, y - h.y) <= h.r;
    return x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h;
  }

  private resolve(h: RaidHazard, now: number) {
    this.fxq.push({ k: 'boom', x: h.shape === 'circle' ? h.x : h.x + h.w / 2, y: h.shape === 'circle' ? h.y : h.y + h.h / 2, s: h.kind });
    for (const p of this.activeParts(now)) {
      if (!this.inside(h, p.x, p.y)) continue;
      if (p.dodgeUntil > now) {
        p.stats.evades++;
        this.fxq.push({ k: 'evade', id: p.id });
        continue;
      }
      p.hp -= 1;
      p.stats.hitTaken++;
      this.fxq.push({ k: 'hit', id: p.id });
      if (p.hp <= 0) {
        p.hp = 0;
        p.downUntil = now + RAID.downMs;
        p.stats.downs++;
        this.fxq.push({ k: 'down', id: p.id });
      }
    }
  }

  private checkStage(now: number) {
    const r = this.boss.hp / this.boss.max;
    if (this.stage === 1 && r <= RAID.shieldAt) {
      this.stage = 2;
      this.boss.shield = true;
      this.spawnZones();
      this.say('혼자서는 끝낼 수 없는 과제입니다.', 3200);
      this.bossSay('방어막 ON. 팀플은 못 하시죠?', 2400);
    }
    if (this.stage === 2 && !this.boss.shield && r <= RAID.finalAt) {
      this.stage = 3;
      this.hazards = [];
      this.openFinal(now);
    }
  }

  private spawnZones() {
    const n = this.onlineParts().length;
    const k = n <= 2 ? 1 : Math.max(2, Math.min(5, Math.round(n / 5) + 1));
    const spots = [
      [70, 120],
      [410, 120],
      [90, 250],
      [390, 250],
      [240, 240],
    ];
    this.zones = spots.slice(0, k).map(([x, y], i) => ({ id: i, x, y, on: false, p: 0, n: 0 }));
    this.zonesNeed = k;
  }

  private coop(now: number) {
    const act = this.activeParts(now);
    // 선배·후배가 모두 있으면 선후배 짝, 아니면 서로 다른 두 사람, 혼자면 한 사람
    const roles = new Set(act.map((p) => this.d.plaza.get(p.id)?.role));
    const mixed = roles.has('senior') && roles.has('junior');
    for (const z of this.zones) {
      if (z.on) continue;
      const inside = act.filter((p) => Math.hypot(p.x - z.x, p.y - z.y) <= RAID.coopR);
      z.n = inside.length;
      const rs = new Set(inside.map((p) => this.d.plaza.get(p.id)?.role));
      const ok = act.length <= 1 ? inside.length >= 1 : mixed ? rs.has('senior') && rs.has('junior') : inside.length >= 2;
      z.p = ok ? Math.min(1, z.p + TICK / RAID.coopHoldMs) : Math.max(0, z.p - TICK / (RAID.coopHoldMs * 2));
      if (z.p >= 1) {
        z.on = true;
        for (const p of inside) p.stats.coop++;
        this.fxq.push({ k: 'coop', x: z.x, y: z.y });
      }
    }
    if (this.zones.filter((z) => z.on).length >= this.zonesNeed) {
      this.boss.shield = false;
      this.zones = [];
      this.say('TEAMWORK ERROR — 방어막 해제!', 2800);
      this.bossSay('ERROR: 팀워크가 너무 좋음', 2400);
      this.mood('hurt', 1200);
      this.fxq.push({ k: 'shieldOff' });
      this.checkStage(now);
    }
  }

  private openFinal(now: number) {
    const n = this.activeParts(now).length || this.onlineParts().length || 1;
    this.final = { endsAt: now + RAID.finalMs, ids: new Set(), need: Math.max(1, Math.ceil(n * 0.5)) };
    this.finalRetryAt = 0;
    this.say('마감 10초 전! 최후의 제출을 완료하세요!', 3200);
    this.bossSay('제출 마감 10초 전...', 2400);
  }

  private victory() {
    if (!this.final) return;
    for (const id of this.final.ids) {
      const p = this.parts.get(id);
      if (p) p.stats.final = true;
    }
    this.final = null;
    this.boss.hp = 0;
    this.boss.mood = 'broken';
    this.finish(true);
  }

  private finish(victory: boolean) {
    const now = Date.now();
    this.hazards = [];
    this.final = null;
    this.boss.shield = false;
    this.zones = [];
    this.phase = victory ? 'victory' : 'defeat';
    if (victory) setTimeout(() => this.phase === 'victory' && ((this.boss.mood = 'off'), this.push()), 3500);
    const all = [...this.parts.values()];
    this.result = {
      victory,
      timeMs: this.startedAt ? now - this.startedAt : 0,
      players: all.length,
      totalDamage: all.reduce((a, p) => a + p.stats.damage, 0),
      totalDowns: all.reduce((a, p) => a + p.stats.downs, 0),
      totalRevives: all.reduce((a, p) => a + p.stats.revives, 0),
    };
    this.awards = this.computeAwards();
    this.say(victory ? '과제 제출 완료!' : '마감 시간 초과... 다음엔 꼭!', 6000);
    this.history.runs.push({ ...this.result, at: now, awards: this.awards.map((a) => ({ title: a.title, nickname: a.nickname })), stats: this.statRows() });
    if (this.history.runs.length > 30) this.history.runs.splice(0, this.history.runs.length - 30);
    this.file.flush();
    this.d.log(`레이드 ${victory ? '승리' : '실패'} (${all.length}명, ${Math.round((this.result.timeMs / 1000) * 10) / 10}초)`);
  }

  private info(id: number): PlayerInfo | undefined {
    return this.d.plaza.get(id);
  }

  statRows() {
    return [...this.parts.values()].map((p) => ({ id: p.id, nickname: this.info(p.id)?.nickname ?? `#${p.id}`, ...p.stats, distance: Math.round(p.stats.distance) }));
  }

  /** 실제 전투 기록으로 6개 칭호 (최소 참여 시간 · 동점 처리 · 중복 수상 방지) */
  computeAwards(): RaidAward[] {
    const ps = [...this.parts.values()];
    let pool = ps.filter((p) => p.stats.playMs >= RAID.minPlayMs);
    if (!pool.length) pool = ps.filter((p) => p.stats.playMs > 0);
    if (!pool.length) pool = ps;
    const metric: Record<RaidAward['id'], (s: RaidStats) => number> = {
      destroyer: (s) => s.damage,
      runner: (s) => (s.distance >= 300 ? s.distance / (s.damage + 20) : 0),
      regular: (s) => s.downs,
      hidden: (s) => s.revives * 3 + s.coop,
      dodger: (s) => s.evades,
      teamplayer: (s) => s.coop * 10 + s.revives,
    };
    const fmt: Record<RaidAward['id'], (s: RaidStats) => string> = {
      destroyer: (s) => `데미지 ${s.damage}`,
      runner: (s) => `이동 ${Math.round(s.distance)}px · 데미지 ${s.damage}`,
      regular: (s) => `${s.downs}번 쓰러짐`,
      hidden: (s) => `부활 ${s.revives} · 협동 ${s.coop}`,
      dodger: (s) => `회피 ${s.evades}번`,
      teamplayer: (s) => `협동 ${s.coop}번`,
    };
    const used = new Set<number>();
    return RAID_AWARD_DEF.map((def) => {
      const ranked = pool
        .map((p) => ({ p, v: metric[def.id](p.stats) }))
        .filter((x) => x.v > 0)
        // 동점이면 데미지 → 참여 시간 → 먼저 입장(작은 번호)
        .sort((a, b) => b.v - a.v || b.p.stats.damage - a.p.stats.damage || b.p.stats.playMs - a.p.stats.playMs || a.p.id - b.p.id);
      const pick = ranked.find((x) => !used.has(x.p.id)) ?? null;
      if (!pick) return { ...def, playerId: null, nickname: '해당자 없음', look: 0, value: '' };
      used.add(pick.p.id);
      const info = this.info(pick.p.id);
      return { ...def, playerId: pick.p.id, nickname: info?.nickname ?? `#${pick.p.id}`, look: info?.look ?? 0, value: fmt[def.id](pick.p.stats) };
    });
  }

  adminInfo() {
    return {
      ok: true as const,
      phase: this.phase,
      paused: this.paused,
      lobby: [...this.lobby].filter((id) => this.d.plaza.has(id)).map((id) => ({ id, nickname: this.info(id)!.nickname, role: this.info(id)!.role })),
      stats: this.statRows(),
      history: this.history.runs.map(({ stats: _s, ...r }) => r).slice(-10),
    };
  }

  toCSV(): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows: string[][] = [];
    for (const r of this.history.runs) {
      rows.push([new Date(r.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }), r.victory ? '승리' : '실패', `${Math.round(r.timeMs / 1000)}초`, `${r.players}명`]);
      rows.push(['칭호', ...r.awards.map((a) => `${a.title}: ${a.nickname}`)]);
      rows.push(['닉네임', '공격', '유효 공격', '데미지', '이동 거리', '회피', '피격', '쓰러짐', '부활 지원', '협동', '최후의 일격', '참여 초']);
      for (const s of r.stats) rows.push([s.nickname, s.attacks, s.hits, s.damage, s.distance, s.evades, s.hitTaken, s.downs, s.revives, s.coop, s.final ? 'O' : '', Math.round(s.playMs / 1000)].map(String));
      rows.push([]);
    }
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  /** 테스트용 (개발 서버에서만): 보스 공격 패턴 멈춤 + 모두 회복 */
  private calm = false;
  debugCalm() {
    this.calm = true;
    this.hazards = [];
    for (const p of this.parts.values()) {
      p.hp = RAID.playerHp;
      p.downUntil = 0;
    }
  }

  /** 테스트용 (개발 서버에서만): 마감 임박 구역을 지금 바로 (0 왼쪽 · 1 오른쪽) */
  debugDeadline(side: 0 | 1) {
    if (this.phase !== 'battle') return;
    const now = Date.now();
    this.hazards.push({ id: this.nextHazardId++, kind: 'deadline', shape: 'rect', x: side ? RAID.W / 2 + 10 : 0, y: 40, w: RAID.W / 2 - 10, h: RAID.H - 40, r: 0, at: now, hitAt: now + 2100 });
  }

  /** 테스트용 (개발 서버에서만): 참가자를 쓰러뜨림 */
  debugDown(id: number) {
    const p = this.parts.get(id);
    if (!p || this.phase !== 'battle') return;
    p.hp = 0;
    p.downUntil = Date.now() + RAID.downMs;
    p.stats.downs++;
    this.fxq.push({ k: 'down', id });
  }

  /** 테스트·점검용: 보스 체력을 비율로 맞춤 (학회장만) */
  debugSetHp(ratio: number) {
    if (this.phase !== 'battle') return;
    this.boss.hp = Math.max(1, Math.round(this.boss.max * ratio));
    this.checkStage(Date.now());
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
