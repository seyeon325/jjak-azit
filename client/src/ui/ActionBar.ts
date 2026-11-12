/**
 * 상황별 상호작용 버튼 (오른쪽 아래). 가까운 대상부터 최대 3개를 보여줍니다.
 * PC: E · 스페이스 · 엔터 = 첫 번째(가장 가까운) 버튼
 */
import type { InteractState } from '../game/scenes/WorldScene';
import { buildFood } from '../game/art/foods';
import { h } from './dom';

export interface ActionHandlers {
  onMenu: () => void;
  onEat: () => void;
  onBath: (on: boolean) => void;
  onBoard: () => void;
  onSit: (seat: string) => void;
  onStand: () => void;
  onSlide: () => void;
  onPush: (seat: string) => void;
  onPlayer: (id: number) => void;
  onFireChat: () => void;
  onUnfollow: () => void;
  onFull: () => void;
  onFind: () => void;
  onSecret: () => void;
}

interface Btn {
  id: string;
  label: string;
  kind: string;
  run: () => void;
  food?: string;
  /** 정렬용 거리 (작을수록 먼저) */
  d: number;
}

const SIT_LABEL: Record<string, string> = { bench: '앉기', log: '앉기', table: '테이블에 앉기', swing: '그네 타기', seesaw: '시소 타기', spring: '스프링 타기' };
const STAND_LABEL: Record<string, string> = { bench: '일어나기', log: '일어나기', table: '일어나기', swing: '내리기', seesaw: '내리기', spring: '내리기' };

export class ActionBar {
  readonly el: HTMLElement;
  private buttons: Btn[] = [];
  private busy = false;
  private suspended = false;

  constructor(private handlers: ActionHandlers) {
    this.el = h('div', { class: 'action-bar', 'aria-live': 'polite' });
    window.addEventListener('keydown', this.onKey);
  }

  suspend(v: boolean) {
    this.suspended = v;
  }

  private onKey = (e: KeyboardEvent) => {
    if (this.suspended || !this.buttons.length) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      this.trigger(this.buttons[0]);
    }
  };

  private async trigger(b: Btn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await b.run();
    } finally {
      setTimeout(() => (this.busy = false), 250);
    }
  }

  update(s: InteractState) {
    const H = this.handlers;
    let btns: Btn[] = [];
    if (s.sliding || s.frozen) btns = [];
    else if (s.findHost) btns = [{ id: 'find', label: '찾았다!!', kind: 'find', d: -99, run: () => H.onFind() }];
    else if (s.seated) {
      btns.push({ id: 'stand', label: STAND_LABEL[s.seated.kind] ?? '일어나기', kind: 'out', d: 0, run: () => H.onStand() });
      if (s.inFire) btns.push({ id: 'firechat', label: '모닥불 대화', kind: 'fire', d: 1, run: () => H.onFireChat() });
    } else if (s.bath) btns.push({ id: 'out', label: '나가기', kind: 'out', d: 0, run: () => H.onBath(false) });
    else {
      if (s.food && !s.eating) btns.push({ id: 'eat', label: '먹기', kind: 'eat', food: s.food, d: 5, run: () => H.onEat() });
      if (s.nearFood && !s.food && !s.eating) btns.push({ id: 'menu', label: '메뉴 보기', kind: 'food', d: 10, run: () => H.onMenu() });
      if (s.nearSpring && !s.eating) btns.push({ id: 'bath', label: '온천 들어가기', kind: 'bath', d: 12, run: () => H.onBath(true) });
      if (s.nearBoard) btns.push({ id: 'board', label: '게시판', kind: 'board', d: 14, run: () => H.onBoard() });
      if (s.seat && !s.eating) btns.push({ id: `sit:${s.seat.id}`, label: SIT_LABEL[s.seat.kind] ?? '앉기', kind: 'sit', d: s.seat.d, run: () => H.onSit(s.seat!.id) });
      if (s.tableFull) btns.push({ id: 'full', label: '테이블 만석 (4/4)', kind: 'out', d: 20, run: () => H.onFull() });
      if (s.push) btns.push({ id: `push:${s.push.seat}`, label: `밀기 (${s.push.name})`, kind: 'push', d: s.push.d - 4, run: () => H.onPush(s.push!.seat) });
      if (s.nearSlide !== null && !s.eating) btns.push({ id: 'slide', label: '미끄러지기', kind: 'slide', d: s.nearSlide, run: () => H.onSlide() });
      if (s.inFire && !s.seat) btns.push({ id: 'firechat', label: '대화 참여', kind: 'fire', d: 30, run: () => H.onFireChat() });
      if (s.player) btns.push({ id: `p:${s.player.id}`, label: `${s.player.name} 님`, kind: 'player', d: s.player.d + 8, run: () => H.onPlayer(s.player!.id) });
      if (s.secret) btns.push({ id: 'secret', label: '반짝이는 무언가?', kind: 'secret', d: 2, run: () => H.onSecret() });
      if (s.following !== null) btns.push({ id: 'unfollow', label: '따라가기 그만', kind: 'out', d: 1, run: () => H.onUnfollow() });
      btns.sort((a, b) => a.d - b.d);
      btns = btns.slice(0, 3);
    }
    const key = btns.map((b) => b.id + b.label).join('|');
    const prev = this.buttons.map((b) => b.id + b.label).join('|');
    this.buttons = btns;
    if (key === prev) return;
    this.el.replaceChildren(
      ...btns.map((b, i) => {
        const el = h('button', { type: 'button', class: `act-btn ${b.kind} ${i === 0 ? 'primary' : ''}`, onclick: () => this.trigger(b) });
        if (b.food) {
          const c = buildFood(b.food as never);
          const img = h('canvas', { class: 'act-food', width: 12, height: 12 });
          img.getContext('2d')!.drawImage(c, 0, 0);
          el.append(img);
        }
        el.append(h('span', {}, b.label));
        if (i === 0) el.append(h('kbd', { class: 'act-key' }, 'E'));
        return el;
      }),
    );
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}
