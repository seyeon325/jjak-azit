/**
 * 상호작용 버튼: 상호작용 지점 근처에서만 나타납니다.
 * 푸드트럭 → '메뉴 보기' / 음식을 들고 있으면 → '먹기'
 * 온천 가장자리 → '온천 들어가기' / 온천 안 → '나가기'
 * 게시판 앞 → '게시판'
 * PC: E 또는 스페이스 = 첫 번째 버튼
 */
import type { InteractState } from '../game/scenes/WorldScene';
import { buildFood } from '../game/art/foods';
import { h } from './dom';

export interface ActionHandlers {
  onMenu: () => void;
  onEat: () => void;
  onBath: (on: boolean) => void;
  onBoard: () => void;
}

interface Btn {
  id: string;
  label: string;
  kind: 'food' | 'eat' | 'bath' | 'out' | 'board';
  run: () => void;
  food?: string;
}

export class ActionBar {
  readonly el: HTMLElement;
  private buttons: Btn[] = [];
  private busy = false;
  private suspended = false;

  constructor(private handlers: ActionHandlers) {
    this.el = h('div', { class: 'action-bar', 'aria-live': 'polite' });
    window.addEventListener('keydown', this.onKey);
  }

  /** 시트가 열려 있으면 단축키 잠시 끄기 */
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
    const btns: Btn[] = [];
    if (s.bath) btns.push({ id: 'out', label: '나가기', kind: 'out', run: () => this.handlers.onBath(false) });
    else {
      if (s.food && !s.eating) {
        btns.push({ id: 'eat', label: '먹기', kind: 'eat', food: s.food, run: () => this.handlers.onEat() });
      }
      if (s.nearFood && !s.food && !s.eating) btns.push({ id: 'menu', label: '메뉴 보기', kind: 'food', run: () => this.handlers.onMenu() });
      if (s.nearSpring && !s.eating) btns.push({ id: 'bath', label: '온천 들어가기', kind: 'bath', run: () => this.handlers.onBath(true) });
      if (s.nearBoard) btns.push({ id: 'board', label: '게시판', kind: 'board', run: () => this.handlers.onBoard() });
    }
    const key = btns.map((b) => b.id + (b.food ?? '')).join('|');
    const prev = this.buttons.map((b) => b.id + (b.food ?? '')).join('|');
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
