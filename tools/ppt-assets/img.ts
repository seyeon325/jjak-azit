/**
 * PPT 에셋용 이미지 도구 (Node 전용)
 *  - 게임 그래픽 코드(PixelCanvas)는 브라우저 캔버스를 쓰지만, 실제 그림은 픽셀 버퍼(Uint32)에 그립니다.
 *    그래서 아주 작은 가짜 캔버스(installCanvasShim)만 있으면 Node 에서도 원본 그대로 그릴 수 있습니다.
 *  - 확대는 항상 정수배 최근접(nearest) → 픽셀이 흐려지지 않음
 *  - PNG 저장은 Node 내장 zlib 사용 (외부 라이브러리 없음)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ------------------------------------------------------------------ 가짜 캔버스

interface FakeImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

class FakeCtx {
  font = '';
  fillStyle: unknown = '';
  textBaseline = '';
  constructor(readonly canvas: FakeCanvas) {}
  createImageData(w: number, h: number): FakeImageData {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(img: FakeImageData) {
    this.canvas.__img = img;
  }
  getImageData(x: number, y: number, w: number, h: number): FakeImageData {
    const out = this.createImageData(w, h);
    const src = this.canvas.__img;
    if (!src) return out; // 글자 그리기용 임시 캔버스 → 비어 있음 (에셋에 글자가 들어가지 않음)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const sx = x + i;
        const sy = y + j;
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
        for (let k = 0; k < 4; k++) out.data[(j * w + i) * 4 + k] = src.data[(sy * src.width + sx) * 4 + k];
      }
    return out;
  }
  /** 갈무리 12px 기준 대략 폭 (간판 판자 크기를 원래와 같게 유지) */
  measureText(t: string) {
    let w = 0;
    for (const ch of t) w += ch.charCodeAt(0) > 0x2e80 ? 12 : 7;
    return { width: w };
  }
  fillText() {}
  fillRect() {}
  createRadialGradient() {
    return { addColorStop() {} };
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  __img: FakeImageData | null = null;
  private ctx: FakeCtx | null = null;
  getContext() {
    return (this.ctx ??= new FakeCtx(this));
  }
}

export function installCanvasShim() {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => new FakeCanvas() };
}

// ------------------------------------------------------------------ 이미지

/** RGBA 이미지 (메모리 배치 R,G,B,A = PixelCanvas 와 같음) */
export class Img {
  readonly d: Uint32Array;
  constructor(
    readonly w: number,
    readonly h: number,
    d?: Uint32Array,
  ) {
    this.d = d ?? new Uint32Array(w * h);
  }

  static fromCanvas(c: unknown): Img {
    const img = (c as FakeCanvas).__img;
    if (!img) throw new Error('그려지지 않은 캔버스');
    return new Img(img.width, img.height, new Uint32Array(new Uint8ClampedArray(img.data).buffer));
  }

  static fromPixel(pc: { w: number; h: number; buf: Uint32Array }): Img {
    return new Img(pc.w, pc.h, new Uint32Array(pc.buf));
  }

  get(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[y * this.w + x];
  }

  set(x: number, y: number, v: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = v >>> 0;
  }

  /** 알파 합성 (반투명 그림자도 정확히) */
  over(x: number, y: number, v: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const sa = v >>> 24;
    if (!sa) return;
    const i = y * this.w + x;
    if (sa === 255) {
      this.d[i] = v >>> 0;
      return;
    }
    const dv = this.d[i];
    const da = dv >>> 24;
    const a = sa / 255;
    const oa = a + (da / 255) * (1 - a);
    const ch = (s: number) => {
      const sc = (v >>> s) & 255;
      const dc = (dv >>> s) & 255;
      return Math.round((sc * a + dc * (da / 255) * (1 - a)) / (oa || 1));
    };
    this.d[i] = ((Math.round(oa * 255) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
  }

  blit(src: Img, dx: number, dy: number, flipX = false) {
    dx = Math.round(dx);
    dy = Math.round(dy);
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) this.over(dx + x, dy + y, src.d[y * src.w + (flipX ? src.w - 1 - x : x)]);
    return this;
  }

  crop(x: number, y: number, w: number, h: number): Img {
    const out = new Img(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.d[j * w + i] = this.get(x + i, y + j);
    return out;
  }

  /** 투명 여백 추가 */
  pad(l: number, t = l, r = l, b = t): Img {
    return new Img(this.w + l + r, this.h + t + b).blit(this, l, t);
  }

  /** 투명한 가장자리 잘라내기 */
  trim(): Img {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.d[y * this.w + x] >>> 24) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    if (x1 < 0) return new Img(1, 1);
    return this.crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  flipX(): Img {
    return new Img(this.w, this.h).blit(this, 0, 0, true);
  }

  /** 정수배 최근접 확대 */
  scale(k: number): Img {
    if (k === 1) return this;
    const out = new Img(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) {
      const sy = (y / k) | 0;
      for (let x = 0; x < out.w; x++) out.d[y * out.w + x] = this.d[sy * this.w + ((x / k) | 0)];
    }
    return out;
  }

  /** 모든 불투명 픽셀을 한 색으로 (실루엣) */
  fill(v: number): Img {
    const out = new Img(this.w, this.h);
    for (let i = 0; i < this.d.length; i++) if (this.d[i] >>> 24) out.d[i] = v >>> 0;
    return out;
  }

  /** 실제로 반투명/투명 픽셀이 있는지 (검수용) */
  transparentCount() {
    let n = 0;
    for (const v of this.d) if (v >>> 24 < 255) n++;
    return n;
  }

  toPNG(): Buffer {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    const bytes = new Uint8Array(this.d.buffer, this.d.byteOffset, this.d.byteLength);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      raw.set(bytes.subarray(y * this.w * 4, (y + 1) * this.w * 4), y * (this.w * 4 + 1) + 1);
    }
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // 8bit
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }

  /** 픽셀을 그대로 사각형으로 옮긴 SVG (가로로 이어진 같은 색은 한 사각형으로) */
  toSVG(unit = 1): string {
    const parts: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let x = 0;
      while (x < this.w) {
        const v = this.d[y * this.w + x];
        if (!(v >>> 24)) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < this.w && this.d[y * this.w + x + run] === v) run++;
        const r = v & 255;
        const g = (v >>> 8) & 255;
        const b = (v >>> 16) & 255;
        const a = (v >>> 24) / 255;
        const fill = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
        parts.push(`<rect x="${x * unit}" y="${y * unit}" width="${run * unit}" height="${unit}" fill="${fill}"${a < 1 ? ` fill-opacity="${a.toFixed(3)}"` : ''}/>`);
        x += run;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w * unit}" height="${this.h * unit}" viewBox="0 0 ${this.w * unit} ${this.h * unit}" shape-rendering="crispEdges">${parts.join('')}</svg>`;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** '#rrggbb' / '#rrggbbaa' → 픽셀 값 */
export function rgba(c: string): number {
  const v = c.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const a = v.length >= 8 ? parseInt(v.slice(6, 8), 16) : 255;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export function writeFile(file: string, data: Buffer | string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}
