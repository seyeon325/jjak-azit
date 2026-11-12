/**
 * 사운드 디렉터: 서버에서 오는 상태·이벤트를 보고 어떤 음악·효과음을 낼지 정함
 *  - 음악 우선순위: 레이드 > 학회장을 찾아라! > 가챠·행운 추첨 무대 > 아지트 기본
 *  - 효과음은 '소리가 난 위치'를 함께 넘겨 거리 감쇠 (멀리서 난 소리는 작게 / 생략)
 *  - 숨바꼭질·가챠·추첨·레이드 단계 전환음은 각 화면(HideSeekUi·StageShow·RaidUi)이 직접 냄
 */
import { WORLD } from '../../../shared/map';
import type { RaidFx } from '../../../shared/raid';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { WorldStore } from '../state/WorldStore';
import type { Engine, SfxName, TrackId } from './Sound';

const ACT_SFX: Record<string, SfxName> = {
  greet: 'act.greet',
  heart: 'act.heart',
  clap: 'act.clap',
  plane: 'act.plane',
  balloon: 'act.balloon',
  hammer: 'act.hammer',
  launch: 'ride.launch',
  slide: 'ride.slide',
};
const POSE_SFX: Record<string, SfxName> = { jump: 'pose.jump', spin: 'pose.jump', wave: 'pose.wave', v: 'pose.wave', dance: 'pose.dance', push: 'ride.push' };
const SEAT_SFX: Record<string, SfxName> = { swing: 'ride.swing', spring: 'ride.spring', seesaw: 'ride.seesaw' };
const RFX_SFX: Partial<Record<RaidFx['k'], SfxName>> = {
  atk: 'raid.atk',
  hit: 'raid.hit',
  boom: 'raid.boom',
  down: 'raid.down',
  revive: 'raid.revive',
  evade: 'raid.evade',
  coop: 'raid.coop',
  final: 'raid.final',
  shieldOff: 'raid.shieldOff',
  pattern: 'raid.warn',
};

export function startSoundDirector(e: Engine, store: WorldStore, scene: () => WorldScene | null) {
  const role = e.role;
  const posOf = (id: number | undefined) => {
    if (id === undefined) return undefined;
    const p = store.players.get(id)?.info;
    return p ? { x: p.x, y: p.y } : undefined;
  };

  // 듣는 위치: 참가자는 내 캐릭터, 관전 화면은 카메라 중심 (넓게)
  e.listener = () => {
    if (role === 'player') {
      const me = store.self;
      return me ? { x: me.x, y: me.y, range: 300 } : null;
    }
    const cam = scene()?.cameras.main;
    if (!cam) return null;
    return { x: cam.worldView.centerX, y: cam.worldView.centerY, range: Math.max(700, cam.worldView.width) };
  };

  // ------------------------------------------------------------ 음악
  const pickMusic = (): TrackId | null => {
    const r = store.raid;
    const watchRaid = role !== 'player' || store.inRaid;
    if (r.phase !== 'off' && watchRaid) {
      if (r.phase === 'lobby' || r.phase === 'countdown') return 'raidLobby';
      if (r.phase === 'battle') return r.final ? 'raidFinal' : r.boss.shield ? 'raidShield' : 'raid';
      if (r.phase === 'victory') return 'victory';
      if (r.phase === 'awards') return 'awards';
      if (r.phase === 'defeat') return null;
    }
    const hs = store.hs.phase;
    if (hs === 'hiding') return 'hsHide';
    if (hs === 'searching') return 'hsSearch';
    if (hs === 'found') return 'victory';
    if (store.stage.mode !== 'idle' && role !== 'player') return 'stage';
    return 'azit';
  };
  const syncMusic = () => e.music(pickMusic());
  for (const ev of ['raid', 'hs', 'stage', 'reset'] as const) store.on(ev, syncMusic);
  syncMusic();

  // ------------------------------------------------------------ 환경음 (온천 물소리 · 모닥불)
  setInterval(() => {
    const l = e.listener();
    if (!l || store.raid.phase === 'battle') return e.ambient(0, 0);
    const near = (sx: number, sy: number, r: number) => Math.max(0, 1 - Math.hypot(l.x - sx, l.y - sy) / r);
    const sp = WORLD.spots.spring;
    const fire = WORLD.spots.campfire;
    const r = role === 'player' ? 220 : 900;
    e.ambient(near(sp.x, sp.y, r) * (role === 'player' ? 1 : 0.5), near(fire.x, fire.y, r) * (role === 'player' ? 1 : 0.5));
  }, 400);

  // ------------------------------------------------------------ 캐릭터 · 놀이터 · 푸드트럭 · 벤치/테이블
  store.on('emote', (p) => e.play('emote', { at: p }));
  store.on('pose', (p, kind) => POSE_SFX[kind] && e.play(POSE_SFX[kind], { at: p }));
  store.on('fx', (ev) => ACT_SFX[ev.kind] && e.play(ACT_SFX[ev.kind], { at: ev.x !== undefined && ev.y !== undefined ? { x: ev.x, y: ev.y } : posOf(ev.from) }));
  store.on('eat', (p) => e.play('food.eat', { at: p }));
  // 이전 상태를 기억해 '진짜로 바뀐 때'만 소리 (리스폰·재접속 때 같은 값이 다시 와도 조용히)
  const was = new Map<number, { seat: string | null; bath: boolean }>();
  const prevOf = (id: number) => was.get(id) ?? { seat: null, bath: false };
  const remember = () => {
    was.clear();
    for (const { info } of store.players.values()) was.set(info.id, { seat: info.seat ?? null, bath: !!info.bath });
  };
  store.on('reset', remember);
  remember();
  store.on('leave', (p) => was.delete(p.id));
  store.on('patch', (p, d) => {
    const prev = prevOf(p.id);
    if (d.seat !== undefined && (d.seat ?? null) !== prev.seat) {
      if (d.seat) {
        const kind = WORLD.seats.find((s) => s.id === d.seat)?.kind ?? 'bench';
        e.play(SEAT_SFX[kind] ?? 'sit', { at: p });
      } else e.play('stand', { at: p });
    }
    if (d.bath !== undefined && !!d.bath !== prev.bath) e.play(d.bath ? 'bath.in' : 'bath.out', { at: p });
    was.set(p.id, { seat: p.seat ?? null, bath: !!p.bath });
    if (d.food) e.play('food.buy', { at: p });
  });

  // ------------------------------------------------------------ 게시판 · 채팅 · 공지
  const board = WORLD.spots.board;
  store.on('note', () => e.play('board.post', { at: board, vol: 0.7 }));
  store.on('comment', () => e.play('board.comment', { at: board, vol: 0.6 }));
  store.on('notice', () => e.play('ui.notice'));
  if (role === 'player') store.on('chat', (m) => m.from !== store.selfId && e.play('chat.recv', { at: posOf(m.from) }));
  else store.on('join', () => e.play('ui.join'));
  store.on('egg', (ev) => (role !== 'player' || ev.winnerId === store.selfId ? e.play('egg.found') : undefined));

  // ------------------------------------------------------------ 레이드 효과
  store.on('rfx', (list) => {
    if (role === 'player' && !store.inRaid) return;
    for (const f of list) {
      if (f.k === 'help') continue; // RaidUi 가 '살려줘!' 알림과 함께 냄
      const name = RFX_SFX[f.k];
      if (!name) continue;
      // 공격음은 참가자 화면에서 내 공격만 (30명이 동시에 치면 시끄러움)
      if (f.k === 'atk' && role === 'player' && f.id !== store.selfId) continue;
      e.play(name, { vol: f.k === 'atk' && role !== 'player' ? 0.5 : 1 });
    }
  });
}
