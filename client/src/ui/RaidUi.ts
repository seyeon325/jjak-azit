/**
 * 과제 괴물 레이드 화면 UI (참가자 · 관전/빔프로젝터 공용)
 *  - 초대장 · 대기실 · 보스 체력 · 남은 시간 · 공격/회피/부활/최후의 제출 버튼 · 안내 문구
 *  - 승리/실패 결과 · 특별 시상식
 *  - 장면 전환: 참가자(전투 인원)와 관전 화면은 레이드 장면으로, 끝나면 아지트로 복귀
 */
import type Phaser from 'phaser';
import { RAID, type RaidAward, type RaidState } from '../../../shared/raid';
import { buildCharacterSheet, FRAME_H, FRAME_W } from '../game/art/characters';
import { pixelEl } from '../game/art/prizes';
import type { RaidCtx, RaidScene } from '../game/scenes/RaidScene';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { h } from './dom';
import { chime } from './HideSeekUi';
import { WorldOverlay } from './WorldOverlay';

const SHOW_PHASES = new Set(['countdown', 'battle', 'victory', 'defeat', 'awards']);

function avatarEl(look: number, scale: number) {
  const sheet = buildCharacterSheet(look);
  const c = document.createElement('canvas');
  c.width = FRAME_W;
  c.height = FRAME_H;
  c.getContext('2d')!.drawImage(sheet, 3 * FRAME_W, 4 * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  return pixelEl(c, scale);
}

export class RaidUi {
  readonly el: HTMLElement;
  private invite: HTMLElement;
  private lobby: HTMLElement;
  private hud: HTMLElement;
  private bossName: HTMLElement;
  private bossBar: HTMLElement;
  private bossFill: HTMLElement;
  private timerEl: HTMLElement;
  private hearts: HTMLElement;
  private banner: HTMLElement;
  private bubble: HTMLElement;
  private btns: HTMLElement;
  private atkBtn: HTMLButtonElement;
  private dodgeBtn: HTMLButtonElement;
  private reviveBtn: HTMLButtonElement;
  private finalBtn: HTMLButtonElement;
  private downNote: HTMLElement;
  private finalBox: HTMLElement;
  private result: HTMLElement;
  private awards: HTMLElement;
  private countdown: HTMLElement;
  private overlay: WorldOverlay;
  private sceneOn = false;
  private atkHold = 0;
  private lastBanner = '';
  private lastPhase = 'off';
  private endAt = 0;

  constructor(
    private store: WorldStore,
    private net: Network,
    private game: () => Phaser.Game | null,
    private mode: 'player' | 'screen',
    host: HTMLElement,
    private onSceneChange?: (on: boolean) => void,
    private input?: RaidCtx['input'],
  ) {
    this.overlay = new WorldOverlay(host);
    this.overlay.root.classList.add('raid-overlay');
    this.invite = h(
      'div',
      { class: 'raid-invite hidden' },
      h('b', {}, '과제 괴물이 나타났다!'),
      h('span', {}, '모두 힘을 합쳐 노트북 괴물을 물리쳐요'),
      h('button', { type: 'button', class: 'btn-primary small', onclick: () => this.join() }, '참여하기'),
    );
    this.lobby = h('div', { class: 'raid-lobby hidden' });
    this.bossName = h('b', {}, '과제 괴물');
    this.bossFill = h('i', {});
    this.bossBar = h('div', { class: 'raid-hp' }, this.bossFill);
    this.timerEl = h('span', { class: 'raid-time' }, '');
    this.hearts = h('div', { class: 'raid-hearts' });
    this.banner = h('div', { class: 'raid-banner hidden' });
    this.bubble = h('div', { class: 'raid-bubble hidden' });
    this.countdown = h('div', { class: 'raid-count hidden' });
    const btn = (cls: string, label: string, sub: string, a: 'atk' | 'dodge' | 'revive' | 'final') => {
      const b = h('button', { type: 'button', class: `raid-btn ${cls}` }, h('span', {}, label), h('small', {}, sub));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.act(a);
        if (a === 'atk') {
          clearInterval(this.atkHold);
          this.atkHold = window.setInterval(() => this.act('atk'), RAID.atkCd + 20);
        }
      });
      const stop = () => clearInterval(this.atkHold);
      if (a === 'atk') ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
      return b;
    };
    this.atkBtn = btn('atk', '공격', 'Space', 'atk');
    this.dodgeBtn = btn('dodge', '회피', 'Shift', 'dodge');
    this.reviveBtn = btn('revive hidden', '살리기', 'E', 'revive');
    this.finalBtn = btn('final hidden', '최후의 제출!', 'F', 'final');
    this.btns = h('div', { class: 'raid-btns' }, this.finalBtn, this.reviveBtn, this.dodgeBtn, this.atkBtn);
    this.downNote = h('div', { class: 'raid-down hidden' });
    this.finalBox = h('div', { class: 'raid-final hidden' });
    this.result = h('div', { class: 'raid-result hidden' });
    this.awards = h('div', { class: 'raid-awards hidden' });
    this.hud = h(
      'div',
      { class: 'raid-hud hidden' },
      h('div', { class: 'raid-top' }, h('div', { class: 'raid-boss' }, this.bossName, this.bossBar), this.timerEl),
      this.hearts,
      this.banner,
      this.bubble,
      this.countdown,
      this.finalBox,
      this.downNote,
      mode === 'player' ? this.btns : null,
    );
    this.el = h('div', { class: `raid-ui ${mode}` }, this.invite, this.lobby, this.hud, this.result, this.awards);
    store.on('raid', (st, prev) => this.apply(st, prev));
    store.on('reset', () => this.apply(store.raid, null));
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'KeyJ') clearInterval(this.atkHold);
    });
    window.setInterval(() => this.tick(), 100);
    this.apply(store.raid, null);
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.sceneOn || this.mode !== 'player' || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const map: Record<string, 'atk' | 'dodge' | 'revive' | 'final'> = { Space: 'atk', KeyJ: 'atk', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyK: 'dodge', KeyE: 'revive', KeyF: 'final', Enter: 'final' };
    const a = map[e.code];
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    this.act(a);
    if (a === 'atk') {
      clearInterval(this.atkHold);
      this.atkHold = window.setInterval(() => this.act('atk'), RAID.atkCd + 20);
    }
  };

  private scene(): RaidScene | null {
    const g = this.game();
    const s = g?.scene.getScene('raid') as RaidScene | undefined;
    return s && g!.scene.isActive('raid') ? s : null;
  }

  private act(a: 'atk' | 'dodge' | 'revive' | 'final') {
    this.scene()?.action(a);
  }

  private async join() {
    const r = await this.net.req('raidJoin');
    if (!r.ok) alert(r.reason);
  }

  /** 참가자(전투 인원)·관전 화면이면 레이드 장면을 보여줌 */
  private wantScene(st: RaidState) {
    if (!SHOW_PHASES.has(st.phase)) return false;
    return this.mode === 'screen' || this.store.inRaid;
  }

  private setScene(on: boolean) {
    const g = this.game();
    if (!g || on === this.sceneOn) return;
    this.sceneOn = on;
    document.body.classList.toggle('raid-on', on);
    const ctx: RaidCtx = { mode: this.mode, store: this.store, net: this.net, overlay: this.overlay, input: this.input };
    if (on) {
      g.scene.sleep('world');
      if (g.scene.getScene('raid')) g.scene.run('raid', { ctx });
      else
        void import('../game/scenes/RaidScene').then(({ RaidScene: Scene }) => {
          if (this.sceneOn && !g.scene.getScene('raid')) g.scene.add('raid', Scene, true, { ctx });
        });
    } else {
      g.scene.stop('raid');
      g.scene.wake('world');
      this.overlay.clear();
    }
    this.onSceneChange?.(on);
  }

  // -------------------------------------------------------------- 상태 반영

  private apply(st: RaidState, prev: RaidState | null) {
    const inRaid = this.store.inRaid;
    const show = this.wantScene(st);
    this.setScene(show);
    // 초대장 (참가자 화면, 아직 참여 안 함)
    const inviteOn = this.mode === 'player' && !inRaid && (st.phase === 'lobby' || st.phase === 'battle' || st.phase === 'countdown') && !this.store.hostAccount;
    this.invite.classList.toggle('hidden', !inviteOn);
    (this.invite.querySelector('button') as HTMLButtonElement).textContent = st.phase === 'lobby' ? '참여하기' : '지금 합류하기';
    // 대기실
    const lobbyOn = st.phase === 'lobby' && (inRaid || this.mode === 'screen');
    this.lobby.classList.toggle('hidden', !lobbyOn);
    if (lobbyOn) this.renderLobby(st);
    this.hud.classList.toggle('hidden', !show || st.phase === 'awards');
    // 결과 · 시상식
    // 승리하면 먼저 노트북 화면이 깨지고 꺼지는 장면을 보여준 뒤 결과 카드
    if ((st.phase === 'victory' || st.phase === 'defeat') && this.endAt === 0) {
      this.endAt = Date.now();
      window.setTimeout(() => this.apply(this.store.raid, null), 4600);
    }
    if (st.phase !== 'victory' && st.phase !== 'defeat') this.endAt = 0;
    const resultOn = show && (st.phase === 'victory' || st.phase === 'defeat') && Date.now() - this.endAt >= 4500;
    this.result.classList.toggle('hidden', !resultOn);
    if (resultOn && (prev?.phase !== st.phase || this.result.childElementCount === 0)) this.renderResult(st);
    const awardsOn = show && st.phase === 'awards';
    this.awards.classList.toggle('hidden', !awardsOn);
    if (awardsOn && (prev?.shown !== st.shown || prev?.phase !== 'awards')) this.renderAwards(st);
    // 효과음 (단계 전환)
    if (prev && st.phase !== this.lastPhase) {
      if (st.phase === 'battle') chime([523, 659, 784], 0.1);
      if (st.phase === 'victory') chime([784, 988, 1175, 1568], 0.1);
      if (st.phase === 'defeat') chime([523, 440, 349], 0.15);
    }
    this.lastPhase = st.phase;
    if (show) this.renderHud(st);
  }

  private renderLobby(st: RaidState) {
    const names = st.joined.map((id) => this.store.players.get(id)?.info).filter(Boolean);
    this.lobby.replaceChildren(
      h(
        'div',
        { class: 'raid-lobby-card' },
        h('small', {}, '과제 괴물을 물리쳐라!'),
        h('h2', {}, '레이드 대기실'),
        h('p', { class: 'raid-lobby-n' }, `${names.length}명 참여 중`),
        h('div', { class: 'chips' }, ...names.slice(0, 40).map((p) => h('span', { class: `chip ${p!.role}` }, p!.nickname))),
        this.mode === 'player'
          ? h('p', { class: 'muted small' }, '학회장이 시작하면 3초 뒤 전투가 시작돼요. 이동: 조이스틱/WASD · 공격: Space · 회피: Shift')
          : h('p', { class: 'raid-lobby-how' }, "휴대폰 화면의 '참여하기'를 눌러 함께해요!"),
        this.mode === 'player'
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn-secondary small',
                onclick: () => this.net.socket.emit('raidLeave'),
              },
              '나가기',
            )
          : null,
      ),
    );
  }

  private renderHud(st: RaidState) {
    const r = st.boss.max ? st.boss.hp / st.boss.max : 1;
    this.bossFill.style.width = `${Math.max(0, r * 100)}%`;
    this.bossBar.classList.toggle('shield', st.boss.shield);
    this.bossName.textContent = `과제 괴물 · ${st.stage === 1 ? '1페이즈 밀린 과제' : st.stage === 2 ? '2페이즈 선후배 협동' : '3페이즈 최후의 일격'}${st.paused ? ' (일시정지)' : ''}`;
    // 내 체력
    const me = this.mode === 'player' ? st.players.find((p) => p[0] === this.store.selfId) : undefined;
    this.hearts.classList.toggle('hidden', !me);
    if (me) {
      const key = `${me[3]}-${me[4]}`;
      if (this.hearts.dataset.k !== key) {
        this.hearts.dataset.k = key;
        this.hearts.replaceChildren(...Array.from({ length: RAID.playerHp }, (_, i) => h('i', { class: i < me[3] ? 'on' : '' })));
      }
    }
    // 큰 안내 문구
    const ban = st.banner ?? '';
    if (ban !== this.lastBanner) {
      this.lastBanner = ban;
      this.banner.classList.toggle('hidden', !ban);
      if (ban) {
        this.banner.textContent = ban;
        this.banner.classList.remove('show');
        void this.banner.offsetWidth;
        this.banner.classList.add('show');
      }
    }
    // 보스 말풍선
    this.bubble.classList.toggle('hidden', !st.boss.msg);
    if (st.boss.msg) this.bubble.textContent = st.boss.msg;
    // 최후의 일격
    const fin = st.final;
    this.finalBox.classList.toggle('hidden', !fin);
    if (fin) {
      const left = Math.max(0, Math.ceil((fin.endsAt - this.store.serverNow()) / 1000));
      const mine = fin.ids.includes(this.store.selfId ?? -1);
      this.finalBox.replaceChildren(
        h('b', {}, `마감 ${left}초 전!`),
        h('div', { class: 'raid-final-bar' }, h('i', { style: `width:${Math.min(100, (fin.ids.length / fin.need) * 100)}%` })),
        h('span', {}, `제출 ${fin.ids.length} / ${fin.need}명${mine ? ' · 나도 제출 완료!' : ''}`),
      );
    }
    if (this.mode === 'player') {
      const down = me?.[4] === 1;
      this.finalBtn.classList.toggle('hidden', !fin || down || !!fin?.ids.includes(this.store.selfId ?? -1));
      this.reviveBtn.classList.toggle('hidden', down || !this.scene()?.reviveTarget());
      this.atkBtn.disabled = down || st.phase !== 'battle';
      this.dodgeBtn.disabled = down || st.phase !== 'battle';
      this.downNote.classList.toggle('hidden', !down);
      if (down) this.downNote.textContent = '쓰러졌어요… 잠시 뒤 자동으로 일어나요. 동료가 다가와 살려줄 수도 있어요!';
      this.btns.classList.toggle('hidden', st.phase !== 'battle' && st.phase !== 'countdown');
    }
  }

  private tick() {
    const st = this.store.raid;
    if (!this.sceneOn) return;
    // 남은 시간 · 카운트다운
    const now = this.store.serverNow();
    if (st.phase === 'countdown') {
      const s = Math.max(1, Math.ceil((st.countdownEnd - now) / 1000));
      this.countdown.classList.remove('hidden');
      if (this.countdown.textContent !== String(s)) {
        this.countdown.textContent = String(s);
        chime([440], 0.05);
      }
    } else this.countdown.classList.add('hidden');
    const left = st.phase === 'battle' ? Math.max(0, Math.ceil((st.endsAt - (st.paused ? st.now : now)) / 1000)) : 0;
    this.timerEl.textContent = st.phase === 'battle' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    this.timerEl.classList.toggle('urgent', st.phase === 'battle' && left <= 30);
    // 보스 말풍선 위치
    const sc = this.scene();
    if (sc && !this.bubble.classList.contains('hidden')) {
      const p = sc.bossScreenPos();
      this.bubble.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
    }
    if (this.mode === 'player' && st.phase === 'battle') this.reviveBtn.classList.toggle('hidden', !sc?.reviveTarget());
    if (st.final) this.renderHud(st);
  }

  private renderResult(st: RaidState) {
    const r = st.result;
    if (!r) return;
    const me = this.mode === 'player' ? st.players.find((p) => p[0] === this.store.selfId) : undefined;
    this.result.replaceChildren(
      h(
        'div',
        { class: `raid-result-card ${r.victory ? 'win' : 'lose'}` },
        h('h2', {}, r.victory ? '과제 제출 완료!' : '마감 시간 초과…'),
        h('p', {}, r.victory ? '모두의 힘으로 과제 괴물을 물리쳤어요!' : '아쉽지만 다음 마감엔 꼭!'),
        h(
          'div',
          { class: 'raid-totals' },
          h('span', {}, h('b', {}, `${r.players}명`), '참가'),
          h('span', {}, h('b', {}, `${Math.floor(r.timeMs / 60000)}분 ${Math.round((r.timeMs % 60000) / 1000)}초`), '전투 시간'),
          h('span', {}, h('b', {}, String(r.totalDamage)), '총 데미지'),
          h('span', {}, h('b', {}, String(r.totalRevives)), '부활 지원'),
        ),
        me ? h('p', { class: 'muted small' }, '학회장이 곧 특별 시상식을 시작해요!') : null,
      ),
    );
  }

  private renderAwards(st: RaidState) {
    const card = (a: RaidAward, fresh: boolean) =>
      h(
        'div',
        { class: `raid-award ${fresh ? 'pop' : ''}` },
        h('small', {}, a.desc),
        h('b', { class: 'raid-award-title' }, a.title),
        a.playerId !== null ? h('div', { class: 'raid-award-av' }, avatarEl(a.look, 5)) : null,
        h('strong', {}, a.nickname),
        a.value ? h('span', {}, a.value) : null,
      );
    this.awards.replaceChildren(
      h(
        'div',
        { class: 'raid-awards-board' },
        h('h2', {}, '레이드 특별 시상식'),
        h('p', { class: 'muted' }, '실제 전투 기록으로 뽑은 재미있는 칭호예요'),
        h(
          'div',
          { class: 'raid-award-grid' },
          ...st.awards.map((a, i) => (i < st.shown ? card(a, i === st.shown - 1) : h('div', { class: 'raid-award hidden-card' }, h('b', {}, '?')))),
        ),
      ),
    );
    if (st.shown > 0) chime([784, 988, 1319], 0.08);
  }
}
