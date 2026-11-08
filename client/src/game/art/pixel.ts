/**
 * 아주 작은 픽셀 드로잉 도구.
 * 모든 그래픽(캐릭터·타일·소품)을 외부 이미지 없이 코드로 그려 텍스처로 만듭니다.
 */

const hexCache = new Map<string, number>();

export function hex(c: string): number {
  // '#rrggbb' 또는 '#rrggbbaa' → ABGR(리틀엔디안 Uint32)
  const hit = hexCache.get(c);
  if (hit !== undefined) return hit;
  const v = c.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const a = v.length >= 8 ? parseInt(v.slice(6, 8), 16) : 255;
  const out = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  hexCache.set(c, out);
  return out;
}

export function mix(a: string, b: string, t: number): string {
  const pa = a.replace('#', '');
  const pb = b.replace('#', '');
  const ch = (i: number) =>
    Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/** 좌표 기반 결정적 해시 (0~1) */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type Shader = (dx: number, dy: number) => string | null;

export class PixelCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly buf: Uint32Array;
  private img: ImageData;

  constructor(readonly w: number, readonly h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  set(x: number, y: number, c: string | number) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = typeof c === 'number' ? c : hex(c);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.buf[y * this.w + x];
  }

  opaque(x: number, y: number) {
    return this.get(x, y) >>> 24 > 0;
  }

  clear(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.buf[y * this.w + x] = 0;
  }

  rect(x: number, y: number, w: number, h: number, c: string) {
    const v = hex(c);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v);
  }

  hline(x0: number, x1: number, y: number, c: string) {
    this.rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c);
  }

  vline(x: number, y0: number, y1: number, c: string) {
    this.rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c);
  }

  /** 채운 타원. shade 콜백(-1~1 정규화 좌표)으로 픽셀별 색을 정할 수 있음 */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string | Shader) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const col = typeof c === 'string' ? c : c(dx, dy);
        if (col) this.set(x, y, col);
      }
  }

  circle(cx: number, cy: number, r: number, c: string | Shader) {
    this.ellipse(cx, cy, r, r, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const v = hex(c);
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, v);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** 불투명 픽셀 둘레에 1px 외곽선 */
  outline(c: string, diagonal = false) {
    const v = hex(c);
    const src = new Uint32Array(this.buf);
    const op = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < this.w && y < this.h && src[y * this.w + x] >>> 24 > 0;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (op(x, y)) continue;
        let n = op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1);
        if (!n && diagonal) n = op(x - 1, y - 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x + 1, y + 1);
        if (n) this.buf[y * this.w + x] = v;
      }
  }

  /** 다른 PixelCanvas를 픽셀 단위로 합성 */
  blit(src: PixelCanvas, dx: number, dy: number, flipX = false) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const v = src.buf[y * src.w + (flipX ? src.w - 1 - x : x)];
        if (v >>> 24 === 0) continue;
        this.set(dx + x, dy + y, v);
      }
  }

  /** 반투명 색을 기존 픽셀 위에 덧칠 */
  tint(x: number, y: number, c: string, alpha: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    const cur = this.buf[i];
    if (cur >>> 24 === 0) return;
    const v = hex(c);
    const r = (cur & 255) * (1 - alpha) + (v & 255) * alpha;
    const g = ((cur >>> 8) & 255) * (1 - alpha) + ((v >>> 8) & 255) * alpha;
    const b = ((cur >>> 16) & 255) * (1 - alpha) + ((v >>> 16) & 255) * alpha;
    this.buf[i] = ((cur & 0xff000000) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }

  flush(): HTMLCanvasElement {
    this.ctx.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

export const PIXEL_FONT = '12px Galmuri11';
export const PIXEL_FONT_BOLD = 'bold 12px "Galmuri11 Bold", Galmuri11';

/**
 * 픽셀 폰트(갈무리)로 글자를 찍고 알파를 이진화해 또렷한 픽셀 글자로 만듭니다.
 * (cx = 가운데 x, y = 글자 위쪽)
 */
export function drawPixelText(
  pc: PixelCanvas,
  text: string,
  cx: number,
  y: number,
  color: string,
  opts: { font?: string; shadow?: string } = {},
) {
  const font = opts.font ?? PIXEL_FONT;
  const tmp = document.createElement('canvas');
  let ctx = tmp.getContext('2d', { willReadFrequently: true })!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 2;
  const h = 16;
  tmp.width = w;
  tmp.height = h;
  ctx = tmp.getContext('2d', { willReadFrequently: true })!;
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillText(text, 1, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const x0 = Math.round(cx - w / 2);
  const col = hex(color);
  const sh = opts.shadow ? hex(opts.shadow) : 0;
  const on = new Uint8Array(w * (h + 1));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) on[j * w + i] = data[(j * w + i) * 4 + 3] > 100 ? 1 : 0;
  if (sh)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if (on[j * w + i] && !on[(j + 1) * w + i]) pc.set(x0 + i, y + j + 1, sh);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (on[j * w + i]) pc.set(x0 + i, y + j, col);
}

export function measurePixelText(text: string, font = PIXEL_FONT): number {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = font;
  return Math.ceil(ctx.measureText(text).width);
}
