/**
 * 학회장을 찾아라! 화면 연출 (참가자 화면·관전 화면 공용)
 *  - 숨는 동안: 블라인드 + 15초 카운트다운 (학회장 본인은 안내 배너만)
 *  - 수색 중: 남은 시간 배너
 *  - 발견: '찾았다!!' → 카메라가 학회장·발견자로 확대 → 폭죽 → 우승자·상품 안내
 *  - 시간 종료: 학회장 위치 공개
 * 블라인드는 화면 가림일 뿐이고, 실제 위치 보호는 서버가 좌표를 보내지 않는 방식으로 처리합니다.
 */
import type { HsState } from '../../../shared/events';
import type { WorldScene } from '../game/scenes/WorldScene';
import type { WorldStore } from '../state/WorldStore';
import { h } from './dom';
import { sfx, sound } from '../audio/Sound';

/** 예전 효과음 함수 — 이제 사운드 엔진(audio/Sound.ts)으로 연결 */
export function chime(notes: number[] = [784, 988, 1319], gap = 0.09) {
  sound()?.notes(notes, gap);
}

export class HideSeekUi {
  readonly el: HTMLElement;
  private blind: HTMLElement;
  private blindCount: HTMLElement;
  private blindSub: HTMLElement;
  private banner: HTMLElement;
  private splash: HTMLElement;
  private result: HTMLElement;
  private timer = 0;
  private splashTimer = 0;
  private later: number[] = [];

  constructor(
    private store: WorldStore,
    private scene: () => WorldScene | null,
    private mode: 'player' | 'screen',
  ) {
    this.blindCount = h('div', { class: 'hs-count' }, '15');
    this.blindSub = h('p', {}, '15초 후 수색이 시작됩니다.');
    this.blind = h(
      'div',
      { class: 'hs-blind hidden', role: 'alert' },
      h('div', { class: 'hs-blind-card' }, h('div', { class: 'hs-eyes' }, h('i'), h('i')), h('h2', {}, '학회장이 숨어 있습니다!'), this.blindSub, this.blindCount),
    );
    this.banner = h('div', { class: 'hs-banner hidden' });
    this.splash = h('div', { class: 'hs-splash hidden' });
    this.result = h('div', { class: 'hs-result hidden' });
    this.el = h('div', { class: `hs-layer ${mode}` }, this.blind, this.banner, this.splash, this.result);

    store.on('hs', (st, prev) => this.apply(st, prev, false));
    store.on('reset', () => this.apply(store.hs, null, true));
    this.timer = window.setInterval(() => this.tick(), 200);
    this.apply(store.hs, null, true);
  }

  private get host() {
    return this.mode === 'player' && this.store.iAmHost;
  }

  private apply(st: HsState, prev: HsState | null, restore: boolean) {
    const changed = restore || !prev || prev.phase !== st.phase || prev.round !== st.round;
    const s = this.scene();
    if (changed) {
      this.later.forEach(clearTimeout);
      this.later = [];
    }
    document.body.classList.toggle('hs-on', this.store.hsActive);

    // 블라인드: 숨는 동안 학회장이 아닌 모든 화면
    this.blind.classList.toggle('hidden', !(st.phase === 'hiding' && !this.host));

    if (!changed) return this.tick();

    switch (st.phase) {
      case 'hiding':
        this.result.classList.add('hidden');
        s?.focusOn(null);
        if (this.host) this.flash('숨을 곳으로 가세요!', '15초 안에 원하는 장소로 이동하세요. 다른 화면은 가려져 있어요.');
        else if (!restore) sfx('hs.start');
        break;
      case 'searching':
        s?.focusOn(null);
        if (this.host) this.flash('수색 시작!', '이제 움직일 수 없어요. 들키지 않길!');
        else this.flash('학회장을 찾아라!', '가장 먼저 발견하는 사람이 승리합니다!');
        if (!restore) sfx('hs.search');
        break;
      case 'found': {
        const pts = [st.reveal, st.winnerPos].filter(Boolean) as { x: number; y: number }[];
        this.flash('찾았다!!', '', 'big');
        sfx('hs.found');
        this.wait(500, () => this.scene()?.focusOn(pts));
        this.wait(1300, () => {
          for (const p of pts) this.scene()?.celebrate(p.x, p.y);
        });
        this.wait(restore ? 0 : 2600, () => this.showResult(st));
        break;
      }
      case 'timeout':
        this.flash('아쉽게도 아무도 학회장을 찾지 못했습니다!', '학회장은 여기 숨어 있었어요.');
        sfx('hs.fail');
        if (st.reveal) this.wait(600, () => this.scene()?.focusOn([st.reveal!]));
        break;
      case 'finished':
      case 'cancelled':
      case 'ready':
        s?.focusOn(null);
        this.hideSplash();
        if (st.phase !== 'finished' || !st.winner) this.result.classList.add('hidden');
        else this.wait(9000, () => this.result.classList.add('hidden'));
        break;
    }
    this.tick();
  }

  private wait(ms: number, fn: () => void) {
    this.later.push(window.setTimeout(fn, ms));
  }

  private tick() {
    const st = this.store.hs;
    const left = st.paused ? st.leftMs : Math.max(0, st.endsAt - this.store.serverNow());
    const sec = Math.ceil(left / 1000);
    if (st.phase === 'hiding') {
      this.blindCount.textContent = st.paused ? '…' : String(Math.max(1, sec));
      this.blindSub.textContent = st.paused ? '학회장 연결이 잠시 끊겼어요. 다시 연결되면 이어서 진행해요.' : `${Math.max(1, sec)}초 후 수색이 시작됩니다.`;
    }
    let text: Node[] | null = null;
    if (st.paused && (st.phase === 'hiding' || st.phase === 'searching')) text = [h('b', {}, '잠시 멈춤'), h('span', {}, '학회장 연결이 끊겼어요 · 기다리는 중')];
    else if (st.phase === 'hiding' && this.host) text = [h('b', {}, '숨는 중'), h('span', {}, `숨을 곳으로 이동하세요 · ${sec}초`)];
    else if (st.phase === 'searching')
      text = this.host
        ? [h('b', {}, '숨는 중'), h('span', {}, `참가자들이 찾고 있어요 · ${fmt(sec)}`)]
        : [h('b', {}, '학회장을 찾아라!'), h('span', { class: 'hs-time' }, fmt(sec))];
    else if (st.phase === 'timeout') text = [h('b', {}, '시간 종료'), h('span', {}, '학회장은 여기 숨어 있었어요!')];
    else if (st.phase === 'found') text = [h('b', {}, '발견 성공!'), h('span', {}, st.winner ? `${st.winner.nickname} 님이 찾았어요` : '')];
    this.banner.classList.toggle('hidden', !text);
    this.banner.classList.toggle('urgent', st.phase === 'searching' && !st.paused && sec <= 10);
    if (text) this.banner.replaceChildren(...text);
  }

  private flash(title: string, sub: string, cls = '') {
    clearTimeout(this.splashTimer);
    this.splash.className = `hs-splash ${cls}`;
    this.splash.replaceChildren(h('strong', {}, title), sub ? h('p', {}, sub) : '');
    void this.splash.offsetWidth;
    this.splash.classList.add('show');
    this.splashTimer = window.setTimeout(() => this.hideSplash(), cls === 'big' ? 2300 : 2800);
  }

  private hideSplash() {
    this.splash.classList.add('hidden');
    this.splash.classList.remove('show');
  }

  private showResult(st: HsState) {
    if (!st.winner) return;
    const mine = this.store.selfId === st.winner.id;
    this.result.replaceChildren(
      h(
        'div',
        { class: 'hs-result-card' },
        h('p', { class: 'hs-r-top' }, '학회장을 찾았습니다!'),
        h('p', { class: 'hs-r-label' }, '최초 발견자'),
        h('strong', { class: 'hs-r-name' }, st.winner.nickname),
        st.winner.prize ? h('p', { class: 'hs-r-prize' }, '배달의민족 상품권 당첨!') : h('p', { class: 'hs-r-note' }, '이번 회차 상품권은 이미 지급되었어요'),
        mine && st.winner.prize ? h('p', { class: 'hs-r-note' }, '축하해요! 행사장에서 상품권을 받아가세요.') : null,
        this.mode === 'player'
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn-primary small',
                onclick: () => {
                  this.result.classList.add('hidden');
                  this.scene()?.focusOn(null);
                },
              },
              '닫기',
            )
          : null,
      ),
    );
    this.result.classList.remove('hidden');
    if (mine) sfx('stage.reveal');
    // 관전 화면은 마무리되면 자동으로 닫힘
    this.wait(this.mode === 'screen' ? 14000 : 20000, () => this.result.classList.add('hidden'));
  }

  destroy() {
    clearInterval(this.timer);
    this.el.remove();
  }
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}
