/** 로그인 화면·메뉴에서 쓰는 캐릭터 미리보기 (Phaser 없이 캔버스로) */
import { buildCharacterSheet, FRAME_H, FRAME_W } from '../game/art/characters';

type Pose = 'idle' | 'walk' | 'tour';

const live = new Set<CharacterPreview>();
let raf = 0;
function loop(t: number) {
  for (const p of live) p.draw(t);
  raf = live.size ? requestAnimationFrame(loop) : 0;
}

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sheet: HTMLCanvasElement;
  private offset = Math.random() * 3000;

  constructor(
    private look: number,
    private color: number,
    private scale = 3,
    private pose: Pose = 'idle',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = FRAME_W * scale;
    this.canvas.height = FRAME_H * scale;
    this.canvas.className = 'char-preview';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.sheet = buildCharacterSheet(look, color);
    live.add(this);
    if (!raf) raf = requestAnimationFrame(loop);
    this.draw(performance.now());
  }

  set(look: number, color: number) {
    if (look === this.look && color === this.color) return;
    this.look = look;
    this.color = color;
    this.sheet = buildCharacterSheet(look, color);
  }

  draw(t: number) {
    if (!this.canvas.isConnected) return;
    const tt = t + this.offset;
    let row = 0;
    let col = 0;
    let flip = false;
    if (this.pose === 'idle') {
      col = tt % 2800 < 140 ? 1 : 0;
    } else if (this.pose === 'walk') {
      col = 2 + (Math.floor(tt / 110) % 4);
    } else {
      // 방향을 돌며 걷기: 아래 → 왼쪽 → 위 → 오른쪽
      const seg = Math.floor(tt / 1600) % 4;
      row = [0, 2, 1, 2][seg];
      flip = seg === 3;
      col = 2 + (Math.floor(tt / 110) % 4);
    }
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.save();
    if (flip) {
      c.translate(this.canvas.width, 0);
      c.scale(-1, 1);
    }
    c.drawImage(this.sheet, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W * this.scale, FRAME_H * this.scale);
    c.restore();
  }

  destroy() {
    live.delete(this);
  }
}
