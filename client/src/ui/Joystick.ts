/**
 * 모바일 가상 조이스틱.
 * 화면 왼쪽 아래 영역 어디든 엄지를 대면 그 자리에 조이스틱이 생깁니다.
 */
import type { InputController } from '../game/InputController';
import { h } from './dom';

const RADIUS = 46;

export class Joystick {
  readonly el: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private pointerId: number | null = null;
  private cx = 0;
  private cy = 0;

  constructor(private input: InputController) {
    this.knob = h('div', { class: 'joy-knob' });
    this.base = h('div', { class: 'joy-base' }, h('i', { class: 'joy-arrows' }), this.knob);
    this.el = h('div', { class: 'joy-zone', 'aria-label': '이동 조이스틱' }, this.base);
    this.el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
  }

  private down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    const zone = this.el.getBoundingClientRect();
    this.cx = Math.min(Math.max(e.clientX, zone.left + RADIUS + 8), zone.right - RADIUS - 8);
    this.cy = Math.min(Math.max(e.clientY, zone.top + RADIUS + 8), zone.bottom - RADIUS - 8);
    this.base.classList.add('active');
    this.base.style.left = `${this.cx - zone.left}px`;
    this.base.style.top = `${this.cy - zone.top}px`;
    this.update(e.clientX, e.clientY);
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.update(e.clientX, e.clientY);
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.input.joy.x = 0;
    this.input.joy.y = 0;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
  };

  private update(x: number, y: number) {
    let dx = x - this.cx;
    let dy = y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.input.joy.x = dx / RADIUS;
    this.input.joy.y = dy / RADIUS;
  }

  destroy() {
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
    this.el.remove();
  }
}
