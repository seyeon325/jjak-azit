/**
 * 빔프로젝터용 관전 화면 UI
 *  - 카메라: 전체 보기 / 모두 따라가기 / 참가자 추적 / 자유 카메라 / 단체 사진
 *  - 참가자 목록 + 닉네임 검색 → 선택한 사람을 부드럽게 따라감 (캐릭터 이동에는 영향 없음)
 */
import QRCode from 'qrcode';
import { gradeLabel } from '../../../shared/foods';
import { TEAMS, teamSvg } from '../../../shared/social';
import type { ScreenCamMode, WorldScene } from '../game/scenes/WorldScene';
import type { WorldStore } from '../state/WorldStore';
import { h, icon, logoMark, roleLabel } from './dom';

export class ScreenHud {
  readonly el: HTMLElement;
  private total: HTMLElement;
  private sen: HTMLElement;
  private jun: HTMLElement;
  private feed: HTMLElement;
  private qrBox: HTMLElement;
  private conn: HTMLElement;
  private camBtns: Record<'all' | 'follow' | 'free', HTMLButtonElement>;
  private controls: HTMLElement;
  private listPanel: HTMLElement;
  private listEl: HTMLElement;
  private search: HTMLInputElement;
  private trackChip: HTMLElement;
  private idleTimer = 0;
  private mode: ScreenCamMode = 'all';
  private beforePhoto: ScreenCamMode = 'all';
  private trackId: number | null = null;

  constructor(
    private store: WorldStore,
    private scene: () => WorldScene | null,
    host: HTMLElement,
  ) {
    this.total = h('strong', { class: 'stat-num' }, '0');
    this.sen = h('b', {}, '0');
    this.jun = h('b', {}, '0');
    this.feed = h('ul', { class: 'feed' });
    this.qrBox = h('div', { class: 'qr-card' });
    this.conn = h('div', { class: 'conn hidden' });
    this.trackChip = h('div', { class: 'track-chip hidden' });
    this.camBtns = {
      all: h('button', { type: 'button', onclick: () => this.cam('all') }, h('kbd', {}, '1'), ' 전체'),
      follow: h('button', { type: 'button', onclick: () => this.cam('follow') }, h('kbd', {}, '2'), ' 모두 따라가기'),
      free: h('button', { type: 'button', onclick: () => this.cam('free') }, h('kbd', {}, '3'), ' 자유 카메라'),
    };
    this.search = h('input', {
      type: 'search',
      placeholder: '닉네임 검색',
      oninput: () => this.renderList(),
      onkeydown: (e) => e.stopPropagation(),
    });
    this.listEl = h('ul', { class: 'spec-list' });
    this.listPanel = h(
      'aside',
      { class: 'spec-panel hidden' },
      h('div', { class: 'spec-head' }, h('b', {}, '참가자 추적'), h('button', { type: 'button', class: 'icon-btn small', onclick: () => this.toggleList() }, icon('close'))),
      this.search,
      this.listEl,
      h('p', { class: 'muted small' }, '이름을 누르면 그 사람을 따라가요. 퇴장하면 전체 보기로 돌아와요.'),
    );
    this.controls = h(
      'div',
      { class: 'screen-controls' },
      this.camBtns.all,
      this.camBtns.follow,
      this.camBtns.free,
      h('button', { type: 'button', onclick: () => this.toggleList() }, h('kbd', {}, 'L'), ' 참가자'),
      h('button', { type: 'button', onclick: () => this.qrBox.classList.toggle('hidden') }, h('kbd', {}, 'Q'), ' QR'),
      h('button', { type: 'button', onclick: () => this.fullscreen() }, h('kbd', {}, 'F'), ' 전체 화면'),
    );

    this.el = h(
      'div',
      { class: 'screen-hud' },
      h(
        'div',
        { class: 'screen-brand' },
        logoMark('logo-mark big'),
        h('div', {}, h('h1', {}, '짝선짝후 아지트'), h('p', {}, '2026 PAIR · AR·VR미디어디자인전공 선후배 교류')),
      ),
      h(
        'div',
        { class: 'screen-stats' },
        h('div', { class: 'stat-main' }, icon('people'), h('span', {}, '지금 아지트에'), this.total, h('span', {}, '명')),
        h('div', { class: 'stat-sub' }, h('span', { class: 'role-dot senior' }), '선배 ', this.sen, h('span', { class: 'role-dot junior' }), '후배 ', this.jun),
      ),
      this.feed,
      this.qrBox,
      this.trackChip,
      this.listPanel,
      this.controls,
      this.conn,
    );

    for (const ev of ['count', 'reset', 'status', 'patch'] as const) store.on(ev, () => this.updateStats());
    store.on('join', (p) => this.push(`${p.nickname} ${roleLabel(p.role)}님 입장`, 'join'));
    store.on('leave', (p) => this.push(`${p.nickname} 님 퇴장`, 'leave'));
    store.on('display', () => this.applyPhoto());
    store.on('notice', (t) => this.push(`공지: ${t}`, 'join'));

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === '1') this.cam('all');
      if (e.key === '2') this.cam('follow');
      if (e.key === '3') this.cam('free');
      if (e.key === 'l' || e.key === 'L') this.toggleList();
      if (e.key === 'q' || e.key === 'Q') this.qrBox.classList.toggle('hidden');
      if (e.key === 'f' || e.key === 'F') this.fullscreen();
      if (e.key === 'Escape') this.cam('all');
      const s = this.scene();
      if (!s) return;
      const step = 40;
      if (e.key === 'ArrowLeft') this.free(() => s.panBy(-step, 0));
      if (e.key === 'ArrowRight') this.free(() => s.panBy(step, 0));
      if (e.key === 'ArrowUp') this.free(() => s.panBy(0, -step));
      if (e.key === 'ArrowDown') this.free(() => s.panBy(0, step));
      if (e.key === '+' || e.key === '=') this.free(() => s.zoomBy(1.15));
      if (e.key === '-') this.free(() => s.zoomBy(1 / 1.15));
    });
    // 자유 카메라: 끌어서 이동, 휠로 확대
    let drag: { x: number; y: number } | null = null;
    host.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
    window.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('pointermove', (e) => {
      this.wake();
      if (!drag || e.buttons === 0) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 2) return;
      drag = { x: e.clientX, y: e.clientY };
      this.free(() => this.scene()?.panBy(-dx, -dy));
    });
    host.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.free(() => this.scene()?.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1));
      },
      { passive: false },
    );
    this.wake();
    this.updateStats();
    this.cam('all');
    this.buildQr();
  }

  /** 추적 대상이 퇴장했을 때 (씬에서 호출) */
  trackLost() {
    this.trackId = null;
    this.cam('all');
  }

  private free(fn: () => void) {
    if (this.mode !== 'free') this.setButtons('free');
    this.mode = 'free';
    fn();
  }

  private setButtons(m: ScreenCamMode) {
    for (const k of Object.keys(this.camBtns) as (keyof typeof this.camBtns)[]) this.camBtns[k].classList.toggle('on', k === m);
  }

  cam(m: ScreenCamMode) {
    const s = this.scene();
    this.mode = m;
    if (m !== 'track') this.trackId = null;
    if (s) {
      if (m === 'free') s.resetFree();
      s.screenCamMode = m;
      s.trackId = this.trackId;
    }
    this.setButtons(m);
    this.trackChip.classList.toggle('hidden', m !== 'track');
    this.renderList();
  }

  track(id: number) {
    this.trackId = id;
    const s = this.scene();
    if (s) {
      s.trackId = id;
      s.screenCamMode = 'track';
    }
    this.mode = 'track';
    this.setButtons('track');
    const p = this.store.players.get(id)?.info;
    this.trackChip.replaceChildren(h('span', {}, `추적 중 · ${p?.nickname ?? ''}`), h('button', { type: 'button', onclick: () => this.cam('all') }, '전체로'));
    this.trackChip.classList.remove('hidden');
    this.renderList();
  }

  toggleList() {
    this.listPanel.classList.toggle('hidden');
    if (!this.listPanel.classList.contains('hidden')) {
      this.renderList();
      this.search.focus();
    }
  }

  private renderList() {
    if (this.listPanel.classList.contains('hidden')) return;
    const q = this.search.value.trim();
    const items = [...this.store.players.values()]
      .map((e) => e.info)
      .filter((p) => !q || p.nickname.includes(q))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, 'ko'));
    this.listEl.replaceChildren(
      ...(items.length
        ? items.map((p) => {
            const t = TEAMS[p.team];
            return h(
              'li',
              { class: `${p.id === this.trackId ? 'on' : ''} ${p.status === 'away' ? 'away' : ''}`, onclick: () => this.track(p.id) },
              t ? h('span', { class: 'mini-team', style: `--tc:${t.color}`, html: teamSvg(t.symbol, '#fff') }) : h('span', { class: 'mini-team none' }),
              h('small', {}, gradeLabel(p.grade, p.gradeText)),
              h('b', {}, p.nickname),
              h('em', { class: p.role }, roleLabel(p.role)),
            );
          })
        : [h('li', { class: 'empty' }, '찾는 사람이 없어요')]),
    );
  }

  private applyPhoto() {
    const photo = this.store.display.photo;
    const was = this.el.classList.contains('photo');
    this.el.classList.toggle('photo', photo);
    document.body.classList.toggle('photo-mode', photo);
    const s = this.scene();
    if (photo && !was) {
      this.beforePhoto = this.mode === 'photo' ? 'all' : this.mode;
      if (s) s.screenCamMode = 'photo';
      this.mode = 'photo';
    } else if (!photo && was) this.cam(this.beforePhoto === 'track' && this.trackId === null ? 'all' : this.beforePhoto);
  }

  private wake() {
    this.controls.classList.remove('idle');
    document.body.classList.remove('hide-cursor');
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.controls.classList.add('idle');
      document.body.classList.add('hide-cursor');
    }, 3500);
  }

  private fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  private updateStats() {
    let s = 0;
    let j = 0;
    for (const e of this.store.players.values()) {
      if (e.info.status !== 'online') continue;
      if (e.info.role === 'senior') s++;
      else j++;
    }
    this.total.textContent = String(s + j);
    this.sen.textContent = String(s);
    this.jun.textContent = String(j);
    this.renderList();
  }

  private push(text: string, kind: 'join' | 'leave') {
    const li = h('li', { class: kind }, h('i', {}), text);
    this.feed.prepend(li);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => li.classList.add('old'), 8000);
  }

  setConn(ok: boolean) {
    this.conn.className = ok ? 'conn hidden' : 'conn lost';
    this.conn.replaceChildren(h('i', {}), '서버와 연결이 끊겼어요 · 다시 연결하는 중…');
  }

  private async buildQr() {
    let url = location.origin;
    try {
      const info = (await fetch('/api/info').then((r) => r.json())) as { publicUrl: string | null; lanUrls: string[] };
      const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
      if (info.publicUrl) url = info.publicUrl;
      else if (local && info.lanUrls.length) url = info.lanUrls[0];
    } catch {
      /* 기본값: 현재 주소 */
    }
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, url, { margin: 1, scale: 6, color: { dark: '#3d3047', light: '#fff6e4' }, errorCorrectionLevel: 'M' });
    this.qrBox.replaceChildren(h('div', { class: 'qr-title' }, icon('qr'), '휴대폰으로 입장하기'), canvas, h('p', { class: 'qr-url' }, url.replace(/^https?:\/\//, '')));
  }
}
