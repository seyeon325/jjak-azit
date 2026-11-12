/**
 * 아지트 사운드 엔진 (WebAudio)
 *  - 음원 파일 없이 브라우저에서 직접 합성하는 오리지널 8비트 음악·효과음 (저작권 걱정 없음)
 *  - 채널: 배경음악(bgm) · 효과음(sfx) · 환경음(amb) 각각 볼륨 + 전체 음소거
 *  - 효과음: 이름별 쿨타임 · 동시 재생 수 제한 · 거리 감쇠 · 경고/승리음 우선 재생
 *  - 음악: 한 번에 한 곡만, 바뀔 때 부드럽게 페이드
 *  - 기본값: 빔프로젝터(/screen) 켜짐 · 운영자 화면(/admin) 꺼짐 · 참가자 휴대폰 꺼짐
 *  - 파일로 바꾸고 싶으면: client/public/sounds/bgm/<곡>.ogg · sounds/sfx/<이름>.ogg 를 넣고
 *    FILE_OVERRIDES 에 이름을 적으면 그 파일을 대신 재생 (지금은 비어 있음 = 전부 코드 합성)
 */

export type SoundRole = 'player' | 'screen' | 'admin';
export type Channel = 'bgm' | 'sfx' | 'amb';
export type TrackId = 'azit' | 'hsHide' | 'hsSearch' | 'stage' | 'raidLobby' | 'raid' | 'raidShield' | 'raidFinal' | 'victory' | 'awards';

/** 파일로 덮어쓸 소리 이름 (예: ['bgm/azit', 'sfx/fanfare']) — 파일이 없으면 넣지 마세요 */
const FILE_OVERRIDES: string[] = [];

interface Settings {
  on: boolean;
  master: number;
  bgm: number;
  sfx: number;
  amb: number;
}
const DEFAULTS: Record<SoundRole, Settings> = {
  screen: { on: true, master: 0.9, bgm: 0.55, sfx: 0.8, amb: 0.5 },
  admin: { on: false, master: 0.8, bgm: 0.4, sfx: 0.7, amb: 0.3 },
  player: { on: false, master: 0.8, bgm: 0.35, sfx: 0.7, amb: 0.35 },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// ===================================================================== 효과음 목록
type Sfx = (e: Engine, t: number, v: number) => void;
interface SfxDef {
  cd: number; // 같은 소리 최소 간격(ms)
  pri?: boolean; // 경고·승리음: 동시 재생 제한·감쇠 무시
  vol?: number;
  play: Sfx;
}

const SFX: Record<string, SfxDef> = {
  // UI
  'ui.tap': { cd: 60, vol: 0.5, play: (e, t, v) => e.tone(1200, 0.04, 'square', v * 0.5, t) },
  'ui.open': { cd: 120, vol: 0.6, play: (e, t, v) => e.arp([660, 880], 0.045, 'triangle', v, t, 0.08) },
  'ui.close': { cd: 120, vol: 0.5, play: (e, t, v) => e.arp([880, 587], 0.045, 'triangle', v, t, 0.08) },
  'ui.toast': { cd: 400, vol: 0.4, play: (e, t, v) => e.tone(988, 0.08, 'sine', v, t) },
  'ui.error': { cd: 300, vol: 0.5, play: (e, t, v) => e.arp([330, 262], 0.08, 'square', v * 0.6, t, 0.12) },
  'ui.notice': { cd: 800, pri: true, vol: 0.8, play: (e, t, v) => e.arp([784, 988, 1175], 0.09, 'triangle', v, t, 0.25) },
  'ui.join': { cd: 900, vol: 0.35, play: (e, t, v) => e.arp([1047, 1319], 0.06, 'sine', v, t, 0.12) },
  // 게시판
  'board.post': { cd: 400, vol: 0.6, play: (e, t, v) => (e.noise(0.12, v * 0.5, t, 2400, 'bandpass'), e.arp([784, 1047], 0.07, 'triangle', v, t + 0.06, 0.12)) },
  'board.like': { cd: 150, vol: 0.6, play: (e, t, v) => e.tone(1047, 0.12, 'sine', v, t, 1568) },
  'board.comment': { cd: 300, vol: 0.5, play: (e, t, v) => e.arp([880, 1175], 0.05, 'sine', v, t, 0.1) },
  'chat.recv': { cd: 350, vol: 0.25, play: (e, t, v) => e.tone(1568, 0.05, 'sine', v, t) },
  // 캐릭터
  emote: { cd: 120, vol: 0.45, play: (e, t, v) => e.tone(880, 0.09, 'sine', v, t, 1320) },
  'pose.jump': { cd: 150, vol: 0.45, play: (e, t, v) => e.tone(330, 0.14, 'square', v * 0.5, t, 880) },
  'pose.wave': { cd: 200, vol: 0.35, play: (e, t, v) => e.arp([784, 988], 0.05, 'sine', v, t, 0.08) },
  'pose.dance': { cd: 600, vol: 0.45, play: (e, t, v) => e.arp([523, 659, 784, 659], 0.08, 'square', v * 0.45, t, 0.08) },
  'act.greet': { cd: 200, vol: 0.4, play: (e, t, v) => e.arp([659, 784], 0.06, 'triangle', v, t, 0.1) },
  'act.heart': { cd: 150, vol: 0.5, play: (e, t, v) => e.arp([784, 1047, 1319], 0.05, 'sine', v, t, 0.1) },
  'act.clap': { cd: 120, vol: 0.55, play: (e, t, v) => [0, 0.11, 0.22].forEach((d) => e.noise(0.04, v, t + d, 1800, 'bandpass')) },
  'act.plane': { cd: 200, vol: 0.45, play: (e, t, v) => e.noise(0.5, v * 0.6, t, 1200, 'bandpass', 3000) },
  'act.balloon': { cd: 200, vol: 0.5, play: (e, t, v) => (e.tone(500, 0.3, 'sine', v * 0.5, t, 900), e.noise(0.05, v, t + 0.3, 3000, 'highpass')) },
  'act.hammer': { cd: 120, vol: 0.7, play: (e, t, v) => (e.tone(180, 0.08, 'square', v, t, 90), e.noise(0.06, v * 0.8, t, 900, 'lowpass')) },
  // 푸드트럭
  'food.buy': { cd: 200, vol: 0.6, play: (e, t, v) => e.arp([1319, 1568, 2093], 0.05, 'square', v * 0.4, t, 0.08) },
  'food.eat': { cd: 250, vol: 0.5, play: (e, t, v) => [0, 0.14, 0.28].forEach((d) => e.noise(0.05, v, t + d, 700, 'lowpass')) },
  // 놀이터 · 온천
  'ride.swing': { cd: 400, vol: 0.4, play: (e, t, v) => e.tone(420, 0.25, 'triangle', v * 0.5, t, 380) },
  'ride.push': { cd: 200, vol: 0.5, play: (e, t, v) => e.tone(260, 0.12, 'square', v * 0.5, t, 520) },
  'ride.slide': { cd: 300, vol: 0.55, play: (e, t, v) => e.tone(1400, 0.7, 'triangle', v * 0.6, t, 300) },
  'ride.launch': { cd: 300, pri: true, vol: 0.7, play: (e, t, v) => (e.tone(300, 0.35, 'square', v * 0.5, t, 1400), e.noise(0.08, v * 0.6, t + 0.4, 600, 'lowpass')) },
  'ride.seesaw': { cd: 300, vol: 0.45, play: (e, t, v) => e.tone(220, 0.08, 'square', v * 0.5, t, 160) },
  'ride.spring': { cd: 300, vol: 0.5, play: (e, t, v) => e.tone(220, 0.3, 'sine', v, t, 660, 12) },
  'bath.in': { cd: 300, vol: 0.55, play: (e, t, v) => (e.noise(0.35, v, t, 900, 'lowpass', 300), e.tone(600, 0.15, 'sine', v * 0.3, t + 0.1, 300)) },
  'bath.out': { cd: 300, vol: 0.45, play: (e, t, v) => e.noise(0.2, v, t, 1400, 'bandpass') },
  // 벤치 · 테이블
  sit: { cd: 200, vol: 0.45, play: (e, t, v) => (e.noise(0.05, v * 0.6, t, 500, 'lowpass'), e.tone(392, 0.07, 'triangle', v * 0.4, t)) },
  stand: { cd: 200, vol: 0.4, play: (e, t, v) => e.tone(392, 0.07, 'triangle', v * 0.4, t, 523) },
  'table.full': { cd: 600, vol: 0.5, play: (e, t, v) => e.arp([440, 440], 0.1, 'square', v * 0.4, t, 0.06) },
  // 숨바꼭질
  'hs.start': { cd: 500, pri: true, vol: 0.8, play: (e, t, v) => e.arp([523, 392, 523, 784], 0.12, 'square', v * 0.5, t, 0.12) },
  'hs.search': { cd: 500, pri: true, vol: 0.8, play: (e, t, v) => e.arp([659, 784, 1047], 0.1, 'square', v * 0.5, t, 0.16) },
  'hs.found': { cd: 500, pri: true, vol: 0.9, play: (e, t, v) => e.fanfare(t, v) },
  'hs.fail': { cd: 500, pri: true, vol: 0.7, play: (e, t, v) => e.arp([523, 440, 349], 0.16, 'triangle', v, t, 0.25) },
  'hs.tick': { cd: 700, pri: true, vol: 0.5, play: (e, t, v) => e.tone(1760, 0.04, 'square', v * 0.5, t) },
  // 가챠 · 행운 추첨 · 시상식
  'stage.ready': { cd: 500, pri: true, vol: 0.7, play: (e, t, v) => e.arp([392, 523, 659], 0.09, 'triangle', v, t, 0.15) },
  'stage.drop': { cd: 300, vol: 0.6, play: (e, t, v) => (e.tone(660, 0.18, 'square', v * 0.5, t, 220), e.noise(0.06, v * 0.6, t + 0.18, 900, 'lowpass')) },
  'stage.tick': { cd: 50, vol: 0.4, play: (e, t, v) => e.tone(1200, 0.03, 'square', v * 0.5, t) },
  'stage.roll': { cd: 800, pri: true, vol: 0.6, play: (e, t, v) => e.drumroll(t, v, 1.2) },
  'stage.reveal': { cd: 500, pri: true, vol: 1, play: (e, t, v) => (e.noise(0.25, v * 0.6, t, 5000, 'highpass'), e.fanfare(t + 0.05, v)) },
  'award.reveal': { cd: 400, pri: true, vol: 0.9, play: (e, t, v) => (e.tone(98, 0.3, 'sine', v, t, 60), e.arp([784, 988, 1319], 0.08, 'square', v * 0.45, t + 0.1, 0.25)) },
  'egg.found': { cd: 500, pri: true, vol: 0.8, play: (e, t, v) => e.arp([1047, 1319, 1568, 2093], 0.07, 'sine', v, t, 0.18) },
  // 레이드
  'raid.count': { cd: 600, pri: true, vol: 0.7, play: (e, t, v) => e.tone(880, 0.12, 'square', v * 0.5, t) },
  'raid.go': { cd: 600, pri: true, vol: 0.9, play: (e, t, v) => (e.tone(1760, 0.3, 'square', v * 0.5, t), e.noise(0.3, v * 0.5, t, 3000, 'highpass')) },
  'raid.atk': { cd: 70, vol: 0.35, play: (e, t, v) => e.noise(0.05, v, t, 2400, 'bandpass') },
  'raid.hit': { cd: 120, vol: 0.6, play: (e, t, v) => (e.tone(160, 0.12, 'square', v * 0.6, t, 70), e.noise(0.08, v * 0.5, t, 800, 'lowpass')) },
  'raid.down': { cd: 200, pri: true, vol: 0.7, play: (e, t, v) => e.tone(523, 0.45, 'square', v * 0.5, t, 130) },
  'raid.help': { cd: 600, pri: true, vol: 0.8, play: (e, t, v) => e.arp([988, 784, 988, 784], 0.08, 'square', v * 0.5, t, 0.07) },
  'raid.revive': { cd: 200, pri: true, vol: 0.8, play: (e, t, v) => e.arp([523, 659, 784, 1047], 0.06, 'triangle', v, t, 0.12) },
  'raid.evade': { cd: 150, vol: 0.45, play: (e, t, v) => e.noise(0.12, v, t, 4000, 'highpass', 1500) },
  'raid.warn': { cd: 900, pri: true, vol: 0.75, play: (e, t, v) => e.arp([880, 0, 880], 0.12, 'square', v * 0.5, t, 0.09) },
  'raid.boom': { cd: 150, vol: 0.7, play: (e, t, v) => (e.tone(110, 0.4, 'sine', v, t, 40), e.noise(0.35, v * 0.7, t, 500, 'lowpass')) },
  'raid.coop': { cd: 400, pri: true, vol: 0.7, play: (e, t, v) => e.arp([659, 880, 1319], 0.07, 'triangle', v, t, 0.15) },
  'raid.shieldOff': { cd: 800, pri: true, vol: 1, play: (e, t, v) => (e.noise(0.5, v * 0.7, t, 2500, 'bandpass', 300), e.arp([392, 523, 784, 1047], 0.08, 'square', v * 0.5, t + 0.2, 0.15)) },
  'raid.final': { cd: 800, pri: true, vol: 0.9, play: (e, t, v) => e.arp([440, 554, 659, 880], 0.07, 'square', v * 0.55, t, 0.12) },
  'raid.victory': { cd: 2000, pri: true, vol: 1, play: (e, t, v) => (e.tone(55, 0.8, 'sine', v, t, 30), e.noise(0.8, v * 0.8, t, 1200, 'lowpass'), e.fanfare(t + 0.6, v)) },
  'raid.defeat': { cd: 2000, pri: true, vol: 0.8, play: (e, t, v) => e.arp([392, 349, 311, 262], 0.22, 'triangle', v, t, 0.35) },
};
export type SfxName = keyof typeof SFX | string;

// ===================================================================== 배경음악 (오리지널 패턴)
interface TrackDef {
  bpm: number;
  /** 마디별 코드 [근음 MIDI, 'M' | 'm'] */
  prog: [number, 'M' | 'm'][];
  lead: OscillatorType;
  leadVol: number;
  /** 16칸: 베이스를 칠 칸 */
  bass: number[];
  /** 16칸 드럼: k=킥 s=스네어 h=하이햇 .=쉼 */
  drums: string;
  /** 멜로디 밀도 0~1 */
  density: number;
  /** 아르페지오 (8분음표 화음 분산) */
  arp?: boolean;
  octave: number;
  seed: number;
}
const TRACKS: Record<TrackId, TrackDef> = {
  azit: { bpm: 96, prog: [[60, 'M'], [57, 'm'], [53, 'M'], [55, 'M']], lead: 'triangle', leadVol: 0.5, bass: [0, 6, 8, 14], drums: 'k...h...k.k.h...', density: 0.45, octave: 12, seed: 3 },
  hsHide: { bpm: 112, prog: [[57, 'm'], [57, 'm'], [53, 'M'], [52, 'M']], lead: 'square', leadVol: 0.28, bass: [0, 3, 8, 11], drums: 'h.h.h.h.h.h.h.hh', density: 0.3, octave: 12, seed: 11 },
  hsSearch: { bpm: 138, prog: [[50, 'm'], [53, 'M'], [48, 'M'], [57, 'm']], lead: 'square', leadVol: 0.3, bass: [0, 2, 4, 6, 8, 10, 12, 14], drums: 'k.h.s.h.k.k.s.hh', density: 0.6, octave: 12, seed: 23 },
  stage: { bpm: 124, prog: [[53, 'M'], [55, 'M'], [57, 'm'], [52, 'M']], lead: 'square', leadVol: 0.25, bass: [0, 4, 8, 12], drums: 'k.h.s.h.k.h.s.hs', density: 0.2, arp: true, octave: 12, seed: 5 },
  raidLobby: { bpm: 110, prog: [[52, 'm'], [52, 'm'], [48, 'M'], [50, 'M']], lead: 'triangle', leadVol: 0.4, bass: [0, 8], drums: 'k.......k...h...', density: 0.2, octave: 12, seed: 31 },
  raid: { bpm: 148, prog: [[52, 'm'], [48, 'M'], [50, 'M'], [47, 'm']], lead: 'square', leadVol: 0.3, bass: [0, 2, 4, 6, 8, 10, 12, 14], drums: 'k.h.s.h.k.k.s.h.', density: 0.65, octave: 12, seed: 41 },
  raidShield: { bpm: 156, prog: [[52, 'm'], [53, 'M'], [52, 'm'], [47, 'M']], lead: 'sawtooth', leadVol: 0.18, bass: [0, 1, 4, 6, 8, 9, 12, 14], drums: 'k.hsk.hsk.hsk.ss', density: 0.7, arp: true, octave: 12, seed: 43 },
  raidFinal: { bpm: 170, prog: [[52, 'm'], [52, 'm'], [53, 'M'], [55, 'M']], lead: 'square', leadVol: 0.32, bass: [0, 2, 4, 6, 8, 10, 12, 14], drums: 'kskskskskskskss', density: 0.85, arp: true, octave: 12, seed: 47 },
  victory: { bpm: 120, prog: [[60, 'M'], [65, 'M'], [67, 'M'], [60, 'M']], lead: 'square', leadVol: 0.3, bass: [0, 4, 8, 12], drums: 'k...s...k.k.s...', density: 0.55, octave: 12, seed: 7 },
  awards: { bpm: 100, prog: [[55, 'M'], [60, 'M'], [62, 'M'], [55, 'M']], lead: 'triangle', leadVol: 0.45, bass: [0, 4, 8, 12], drums: 'k.s.k.s.k.s.ksss', density: 0.4, octave: 12, seed: 13 },
};

/** 시드 고정 난수 (같은 곡은 항상 같은 멜로디) */
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

interface Seq {
  id: TrackId;
  def: TrackDef;
  gain: GainNode;
  step: number;
  next: number;
  melody: (number | null)[];
  alive: boolean;
}

function buildMelody(d: TrackDef): (number | null)[] {
  const r = rng(d.seed);
  const out: (number | null)[] = [];
  for (let bar = 0; bar < d.prog.length * 2; bar++) {
    const [root, q] = d.prog[bar % d.prog.length];
    const tones = [0, q === 'M' ? 4 : 3, 7, 12];
    let last = tones[Math.floor(r() * 3)];
    for (let s = 0; s < 16; s++) {
      const strong = s % 4 === 0;
      if (r() < (strong ? d.density + 0.25 : d.density * 0.6)) {
        // 화음 음 위주로 한 칸씩 움직이는 단순한 선율
        const step = Math.floor(r() * 3) - 1;
        const idx = Math.max(0, Math.min(tones.length - 1, tones.indexOf(last) + step));
        last = strong ? tones[idx] : tones[idx] + (r() < 0.25 ? 2 : 0);
        out.push(root + d.octave + last);
      } else out.push(null);
    }
  }
  return out;
}

// ===================================================================== 엔진
export class Engine {
  readonly role: SoundRole;
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ch: Partial<Record<Channel, GainNode>> = {};
  private s: Settings;
  private lastAt = new Map<string, number>();
  private voices: number[] = [];
  /** 지금 재생 중인 곡 (점검용) */
  get current() {
    return this.seq?.alive ? this.seq.id : null;
  }
  private seq: Seq | null = null;
  private want: TrackId | null = null;
  private timer = 0;
  private noiseBuf: AudioBuffer | null = null;
  private ambSrc: { spring: GainNode; fire: GainNode } | null = null;
  private fireLevel = 0;
  private listeners = new Set<() => void>();
  /** 효과음 거리 감쇠 기준 (화면 중심·내 캐릭터 위치) */
  listener: () => { x: number; y: number; range: number } | null = () => null;
  private files = new Map<string, AudioBuffer | null>();

  constructor(role: SoundRole) {
    this.role = role;
    this.s = { ...DEFAULTS[role] };
    try {
      const raw = localStorage.getItem(`azit.snd.${role}`);
      if (raw) this.s = { ...this.s, ...JSON.parse(raw) };
    } catch {
      /* 기본값 사용 */
    }
    // 브라우저는 사용자가 화면을 한 번 눌러야 소리를 허용 → 첫 터치·키 입력에 맞춰 깨움
    const unlock = () => {
      if (this.s.on) this.ensure();
      void this.ctx?.resume().then(() => this.changed());
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.s.on) void this.ctx?.resume();
    });
  }

  get settings(): Readonly<Settings> {
    return this.s;
  }
  get enabled() {
    return this.s.on;
  }
  /** 소리를 켰지만 브라우저가 아직 막고 있음 → '소리 켜기' 버튼 필요 */
  get locked() {
    return this.s.on && (!this.ctx || this.ctx.state !== 'running');
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const f of this.listeners) f();
  }
  private save() {
    try {
      localStorage.setItem(`azit.snd.${this.role}`, JSON.stringify(this.s));
    } catch {
      /* 저장 실패해도 이번 화면에서는 적용 */
    }
  }

  setEnabled(on: boolean) {
    this.s.on = on;
    this.save();
    if (on) {
      this.ensure();
      void this.ctx?.resume().then(() => {
        this.applyGains(0.3);
        this.changed();
        this.play('ui.open');
      });
    } else this.applyGains(0.3);
    this.changed();
  }

  setVolume(c: Channel | 'master', v: number) {
    this.s[c] = Math.max(0, Math.min(1, v));
    this.save();
    this.applyGains(0.1);
    this.changed();
  }

  /** 오디오 장치 준비 (켜져 있을 때만 — 꺼져 있으면 아무것도 만들지 않음) */
  private ensure() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new C();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    // 갑자기 큰 소리가 나지 않도록 가벼운 리미터
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    for (const c of ['bgm', 'sfx', 'amb'] as Channel[]) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.ch[c] = g;
    }
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyGains(0);
    ctx.onstatechange = () => this.changed();
    this.timer = window.setInterval(() => this.tick(), 50);
    for (const n of FILE_OVERRIDES) void this.loadFile(n);
  }

  private applyGains(fade: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const set = (g: AudioParam, v: number) => {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(v, t + fade);
    };
    set(this.master.gain, this.s.on ? this.s.master : 0);
    for (const c of ['bgm', 'sfx', 'amb'] as Channel[]) if (this.ch[c]) set(this.ch[c]!.gain, this.s[c] * (c === 'bgm' ? 0.5 : c === 'amb' ? 0.6 : 1));
  }

  private get ready() {
    return !!this.ctx && this.s.on && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------- 합성 도구
  private out(c: Channel) {
    return this.ch[c]!;
  }
  /** 효과음 출력 대상 (재생 중 하나로 바꾸기 위해 public) */
  dest: Channel = 'sfx';

  tone(f: number, dur: number, type: OscillatorType, vol: number, t: number, slideTo?: number, vibrato = 0) {
    if (!this.ctx || f <= 0) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    if (vibrato) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = vibrato;
      lg.gain.value = f * 0.06;
      l.connect(lg).connect(o.frequency);
      l.start(t);
      l.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.25), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(this.dest));
    o.start(t);
    o.stop(t + dur + 0.03);
    this.voices.push(t + dur);
  }

  arp(notes: number[], gap: number, type: OscillatorType, vol: number, t: number, dur = 0.15) {
    notes.forEach((f, i) => f > 0 && this.tone(f, dur, type, vol, t + i * gap));
  }

  noise(dur: number, vol: number, t: number, freq: number, kind: BiquadFilterType, sweepTo?: number) {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = kind;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.35), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out(this.dest));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    this.voices.push(t + dur);
  }

  fanfare(t: number, v: number) {
    const n = [523, 659, 784, 1047];
    this.arp(n, 0.09, 'square', v * 0.5, t, 0.14);
    this.tone(1047, 0.6, 'square', v * 0.45, t + 0.4, undefined, 6);
    this.tone(1319, 0.6, 'triangle', v * 0.4, t + 0.4, undefined, 6);
    this.tone(131, 0.7, 'triangle', v * 0.7, t + 0.4);
  }

  drumroll(t: number, v: number, len: number) {
    for (let x = 0; x < len; x += 0.045) this.noise(0.04, v * (0.4 + (x / len) * 0.6), t + x, 1500, 'bandpass');
  }

  // ------------------------------------------------------------- 효과음
  /**
   * 효과음 재생. at: 소리가 난 맵 위치 (있으면 거리에 따라 작아지고, 너무 멀면 생략)
   */
  play(name: SfxName, opt: { at?: { x: number; y: number }; vol?: number } = {}) {
    if (!this.ready) return;
    const def = SFX[name];
    if (!def) return;
    const now = performance.now();
    if (now - (this.lastAt.get(name) ?? -1e9) < def.cd) return;
    const ctx = this.ctx!;
    this.voices = this.voices.filter((e) => e > ctx.currentTime);
    if (!def.pri && this.voices.length >= 14) return; // 동시 재생 제한 (경고·승리음은 예외)
    let v = (def.vol ?? 0.6) * (opt.vol ?? 1);
    if (opt.at && !def.pri) {
      const l = this.listener();
      if (l) {
        const d = Math.hypot(opt.at.x - l.x, opt.at.y - l.y);
        if (d > l.range) return;
        v *= 1 - (d / l.range) * 0.85;
      }
    }
    this.lastAt.set(name, now);
    const file = this.files.get(`sfx/${name}`);
    if (file) return this.playBuffer(file, 'sfx', v);
    this.dest = 'sfx';
    def.play(this, ctx.currentTime + 0.01, v);
  }

  /** 예전 방식의 짧은 음 나열 (숨바꼭질·가챠·레이드 화면에서 사용) */
  notes(list: number[], gap: number) {
    if (!this.ready) return;
    const key = `n:${list.join(',')}`;
    const now = performance.now();
    if (now - (this.lastAt.get(key) ?? -1e9) < 80) return;
    this.lastAt.set(key, now);
    this.dest = 'sfx';
    this.arp(list, gap, 'square', 0.45, this.ctx!.currentTime + 0.02, 0.2);
  }

  private playBuffer(buf: AudioBuffer, c: Channel, v: number, loop = false) {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = this.ctx!.createGain();
    g.gain.value = v;
    src.connect(g).connect(this.out(c));
    src.start();
    return src;
  }

  private async loadFile(name: string) {
    try {
      const r = await fetch(`/sounds/${name}.ogg`);
      if (!r.ok) throw new Error();
      this.files.set(name, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
    } catch {
      this.files.set(name, null); // 파일이 없으면 코드 합성 소리로
    }
  }

  // ------------------------------------------------------------- 음악
  /** 지금 틀 곡 (같은 곡이면 그대로, 다르면 페이드 전환, null 이면 조용히) */
  music(id: TrackId | null) {
    this.want = id;
    if (this.ready) this.syncMusic();
  }

  private syncMusic() {
    const ctx = this.ctx!;
    if (this.seq?.id === this.want && this.seq.alive) return;
    const t = ctx.currentTime;
    if (this.seq) {
      const old = this.seq;
      old.alive = false;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => old.gain.disconnect(), 1500);
      this.seq = null;
    }
    if (!this.want) return;
    const def = TRACKS[this.want];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 1.5);
    gain.connect(this.out('bgm'));
    const file = this.files.get(`bgm/${this.want}`);
    if (file) {
      const src = this.ctx!.createBufferSource();
      src.buffer = file;
      src.loop = true;
      src.connect(gain);
      src.start();
      this.seq = { id: this.want, def, gain, step: 0, next: Infinity, melody: [], alive: true };
      return;
    }
    this.seq = { id: this.want, def, gain, step: 0, next: t + 0.15, melody: buildMelody(def), alive: true };
  }

  /** 50ms 마다: 앞으로 0.25초 분량의 음을 미리 예약 (탭이 잠깐 느려져도 박자 유지) */
  private tick() {
    if (!this.ready) return;
    if ((this.seq?.id ?? null) !== this.want) this.syncMusic();
    this.updateAmbient();
    const sq = this.seq;
    if (!sq || !sq.alive || sq.next === Infinity) return;
    const ctx = this.ctx!;
    const stepDur = 60 / sq.def.bpm / 4;
    if (sq.next < ctx.currentTime - 0.5) sq.next = ctx.currentTime + 0.05; // 오래 멈췄다 돌아오면 다시 맞춤
    while (sq.next < ctx.currentTime + 0.25) {
      this.playStep(sq, sq.step, sq.next, stepDur);
      sq.step++;
      sq.next += stepDur;
    }
  }

  private playStep(sq: Seq, step: number, t: number, sd: number) {
    const d = sq.def;
    const s = step % 16;
    const bar = Math.floor(step / 16) % d.prog.length;
    const [root, q] = d.prog[bar];
    const prev = this.dest;
    // 음악은 bgm 채널의 곡별 gain 으로
    const route = (fn: () => void) => {
      const save = this.ch.bgm;
      this.ch.bgm = sq.gain;
      this.dest = 'bgm';
      fn();
      this.ch.bgm = save;
    };
    route(() => {
      if (d.bass.includes(s)) this.tone(midi(root - 12), sd * 1.8, 'triangle', 0.9, t);
      const dr = d.drums[s];
      if (dr === 'k') this.tone(120, 0.12, 'sine', 1.1, t, 45);
      if (dr === 's') this.noise(0.09, 0.5, t, 1800, 'bandpass');
      if (dr === 'h') this.noise(0.03, 0.25, t, 7000, 'highpass');
      if (d.arp && s % 2 === 0) {
        const tones = [0, q === 'M' ? 4 : 3, 7, 12];
        this.tone(midi(root + 12 + tones[(s / 2) % 4]), sd * 1.5, 'square', 0.18, t);
      }
      const m = sq.melody[step % sq.melody.length];
      if (m !== null) this.tone(midi(m), sd * 1.9, d.lead, d.leadVol, t);
    });
    this.dest = prev;
  }

  // ------------------------------------------------------------- 환경음
  private ambLevels = { spring: 0, fire: 0 };
  /** 0~1: 온천 물소리 · 모닥불 타닥 소리 크기 */
  ambient(spring: number, fire: number) {
    this.ambLevels = { spring, fire };
  }

  private updateAmbient() {
    const ctx = this.ctx!;
    if (!this.ambSrc && this.noiseBuf) {
      const mk = (freq: number, q: number) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.out('amb'));
        src.start();
        return g;
      };
      this.ambSrc = { spring: mk(700, 0.6), fire: mk(300, 0.8) };
    }
    if (!this.ambSrc) return;
    const t = ctx.currentTime;
    this.ambSrc.spring.gain.setTargetAtTime(this.ambLevels.spring * 0.07, t, 0.4);
    this.ambSrc.fire.gain.setTargetAtTime(this.ambLevels.fire * 0.05, t, 0.4);
    // 모닥불 타닥타닥 (불규칙한 짧은 소리)
    this.fireLevel = this.ambLevels.fire;
    if (this.fireLevel > 0.05 && Math.random() < 0.18 * this.fireLevel) {
      this.dest = 'amb';
      this.noise(0.02 + Math.random() * 0.03, 0.35 * this.fireLevel, t + Math.random() * 0.05, 2000 + Math.random() * 3000, 'bandpass');
      this.dest = 'sfx';
    }
  }

  destroy() {
    clearInterval(this.timer);
    void this.ctx?.close();
  }
}

/** 화면당 하나 */
let engine: Engine | null = null;
export function initSound(role: SoundRole) {
  engine ??= new Engine(role);
  if (import.meta.env.DEV) (window as unknown as { __snd: Engine }).__snd = engine; // 개발 점검용
  return engine;
}
export function sound(): Engine | null {
  return engine;
}
/** 효과음 바로 재생 (엔진이 없거나 꺼져 있으면 무시) */
export function sfx(name: SfxName, opt?: { at?: { x: number; y: number }; vol?: number }) {
  engine?.play(name, opt);
}
