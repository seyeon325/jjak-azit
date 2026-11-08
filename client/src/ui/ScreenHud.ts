/** 빔프로젝터용 운영자 관전 화면 UI (조작 UI 없음) */
import QRCode from 'qrcode';
import type { WorldStore } from '../state/WorldStore';
import type { ScreenCamMode } from '../game/scenes/WorldScene';
import { h, icon, logoMark, roleLabel } from './dom';

export class ScreenHud {
  readonly el: HTMLElement;
  private total: HTMLElement;
  private sen: HTMLElement;
  private jun: HTMLElement;
  private feed: HTMLElement;
  private qrBox: HTMLElement;
  private conn: HTMLElement;
  private camBtns: Record<ScreenCamMode, HTMLButtonElement>;
  private controls: HTMLElement;
  private idleTimer = 0;

  constructor(
    private store: WorldStore,
    private setCam: (m: ScreenCamMode) => void,
  ) {
    this.total = h('strong', { class: 'stat-num' }, '0');
    this.sen = h('b', {}, '0');
    this.jun = h('b', {}, '0');
    this.feed = h('ul', { class: 'feed' });
    this.qrBox = h('div', { class: 'qr-card' });
    this.conn = h('div', { class: 'conn hidden' });
    this.camBtns = {
      all: h('button', { type: 'button', onclick: () => this.cam('all') }, h('kbd', {}, '1'), ' 전체 보기'),
      follow: h('button', { type: 'button', onclick: () => this.cam('follow') }, h('kbd', {}, '2'), ' 참가자 따라가기'),
    };
    this.controls = h(
      'div',
      { class: 'screen-controls' },
      this.camBtns.all,
      this.camBtns.follow,
      h('button', { type: 'button', onclick: () => this.toggleQr() }, h('kbd', {}, 'Q'), ' QR 보이기/숨기기'),
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
      this.controls,
      this.conn,
    );

    store.on('count', () => this.updateStats());
    store.on('reset', () => this.updateStats());
    store.on('status', () => this.updateStats());
    store.on('join', (p) => this.push(`${p.nickname} ${roleLabel(p.role)}님 입장`, 'join'));
    store.on('leave', (p) => this.push(`${p.nickname} 님 퇴장`, 'leave'));

    window.addEventListener('keydown', (e) => {
      if (e.key === '1') this.cam('all');
      if (e.key === '2') this.cam('follow');
      if (e.key === 'q' || e.key === 'Q') this.toggleQr();
      if (e.key === 'f' || e.key === 'F') this.fullscreen();
    });
    window.addEventListener('pointermove', () => this.wake());
    this.wake();
    this.updateStats();
    this.cam('all');
    this.buildQr();
  }

  private cam(m: ScreenCamMode) {
    this.setCam(m);
    this.camBtns.all.classList.toggle('on', m === 'all');
    this.camBtns.follow.classList.toggle('on', m === 'follow');
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

  private toggleQr() {
    this.qrBox.classList.toggle('hidden');
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
    await QRCode.toCanvas(canvas, url, {
      margin: 1,
      scale: 6,
      color: { dark: '#3d3047', light: '#fff6e4' },
      errorCorrectionLevel: 'M',
    });
    this.qrBox.replaceChildren(
      h('div', { class: 'qr-title' }, icon('qr'), '휴대폰으로 입장하기'),
      canvas,
      h('p', { class: 'qr-url' }, url.replace(/^https?:\/\//, '')),
    );
  }
}
