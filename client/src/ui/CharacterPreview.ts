/** 로그인 화면·메뉴에서 쓰는 캐릭터 미리보기 (Phaser 없이 캔버스로) */
import { buildCharacterSheet, FRAME_H, FRAME_W } from '../game/art/characters';

export type PreviewPose = 'idle' | 'walk' | 'tour';
/** 0 정면 · 1 뒤 · 2 왼쪽 · 3 오른쪽 */
export type PreviewDir = 0 | 1 | 2 | 3;

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
  dir: PreviewDir = 0;

  constructor(
    private look: number,
    private scale = 3,
    public pose: PreviewPose = 'idle',
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = FRAME_W * scale;
    this.canvas.height = FRAME_H * scale;
    this.canvas.className = 'char-preview';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.sheet = buildCharacterSheet(look);
    live.add(this);
    if (!raf) raf = requestAnimationFrame(loop);
    this.draw(performance.now());
  }

  set(look: number) {
    if (look === this.look) return;
    this.look = look;
    this.sheet = buildCharacterSheet(look);
  }

  draw(t: number) {
    if (!this.canvas.isConnected) return;
    const tt = t + this.offset;
    let dir: PreviewDir = this.dir;
    let walking = this.pose === 'walk';
    if (this.pose === 'tour') {
      // 방향을 돌며 걷기: 정면 → 왼쪽 → 뒤 → 오른쪽
      dir = ([0, 2, 1, 3] as PreviewDir[])[Math.floor(tt / 1600) % 4];
      walking = true;
    }
    const row = dir === 0 ? 0 : dir === 1 ? 1 : 2;
    const flip = dir === 3;
    const col = walking ? 2 + (Math.floor(tt / 110) % 4) : tt % 2800 < 140 ? 1 : 0;
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
