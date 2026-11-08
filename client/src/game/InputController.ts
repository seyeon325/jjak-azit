/** 키보드(WASD·방향키) + 가상 조이스틱 입력을 하나의 방향 벡터로 합칩니다 */
const KEYMAP: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

export class InputController {
  private keys = new Set<string>();
  /** 조이스틱 값 (-1~1) */
  joy = { x: 0, y: 0 };
  enabled = true;

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.clear);
  }

  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onDown = (e: KeyboardEvent) => {
    if (!KEYMAP[e.code] || this.isTyping(e)) return;
    this.keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  clear = () => {
    this.keys.clear();
    this.joy.x = 0;
    this.joy.y = 0;
  };

  vector(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      x += KEYMAP[k][0];
      y += KEYMAP[k][1];
    }
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    if (x || y) {
      const len = Math.hypot(x, y);
      return { x: x / len, y: y / len };
    }
    const jl = Math.hypot(this.joy.x, this.joy.y);
    if (jl < 0.18) return { x: 0, y: 0 };
    // 조이스틱은 기울인 정도만큼 (최소 속도 보장)
    const mag = Math.min(1, 0.45 + jl * 0.75);
    return { x: (this.joy.x / jl) * mag, y: (this.joy.y / jl) * mag };
  }

  destroy() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.clear);
  }
}
