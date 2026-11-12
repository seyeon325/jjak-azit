/** 아래에서 올라오는 시트 (모바일) / 가운데 창 (PC) */
import { h, icon } from './dom';
import { sfx } from '../audio/Sound';

export class Sheet {
  readonly backdrop: HTMLElement;
  readonly body: HTMLElement;
  readonly head: HTMLElement;
  private closed = false;

  constructor(
    parent: HTMLElement,
    title: Node | string,
    private onClose?: () => void,
    cls = '',
  ) {
    this.body = h('div', { class: 'sheet-body' });
    this.head = h(
      'div',
      { class: 'sheet-head' },
      typeof title === 'string' ? h('h2', { class: 'sheet-title' }, title) : title,
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': '닫기', onclick: () => this.close() }, icon('close')),
    );
    this.backdrop = h(
      'div',
      {
        class: 'sheet-backdrop',
        onclick: (e) => {
          if (e.target === this.backdrop) this.close();
        },
      },
      h('div', { class: `sheet ${cls}`, role: 'dialog', 'aria-modal': 'true' }, this.head, this.body),
    );
    parent.append(this.backdrop);
    setTimeout(() => this.backdrop.classList.add('open'), 16);
    sfx('ui.open');
  }

  get isOpen() {
    return !this.closed;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    sfx('ui.close');
    this.backdrop.classList.remove('open');
    setTimeout(() => this.backdrop.remove(), 220);
    this.onClose?.();
  }
}
