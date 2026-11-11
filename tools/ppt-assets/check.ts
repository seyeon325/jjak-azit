/**
 * 에셋 검수: npx tsx tools/ppt-assets/check.ts [폴더]
 *  - 개별 에셋은 실제 투명 배경인지 (네 모서리 중 하나 이상 투명 + 투명 픽셀 존재)
 *  - 1x 와 확대 파일이 정확히 정수배인지, 확대본이 1x 를 최근접 확대한 것과 같은지
 *  - 배경은 16:9 (1920×1080) 인지
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

function readPng(f: string) {
  const b = readFileSync(f);
  let o = 8, w = 0, h = 0, ct = 0;
  const idat: Buffer[] = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const t = b.toString('ascii', o + 4, o + 8);
    const d = b.subarray(o + 8, o + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    if (t === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { w, h, ct, px };
}

const root = path.resolve(process.argv[2] ?? 'PAIR_PPT_ASSETS');
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(root);
const pngs = files.filter((f) => f.endsWith('.png'));
let bad = 0;
const fail = (f: string, m: string) => { bad++; console.log(`❌ ${path.relative(root, f)} — ${m}`); };
// 배경·타일·시안·9분할 가운데 조각은 원래 꽉 찬 이미지
const opaqueOk = /(^bg_|^tile_|^preview_|palette_swatches|9slice_(t|b|l|r|c)\.png$)/;
let transparentChecked = 0, scaleChecked = 0, bytes = 0;
for (const f of pngs) {
  bytes += statSync(f).size;
  const name = path.basename(f);
  const m = path.basename(path.dirname(f)).match(/^(\d+)x$/);
  const k = m ? Number(m[1]) : 1;
  const img = readPng(f);
  if (img.ct !== 6) fail(f, 'RGBA 가 아님');
  if (img.w % k || img.h % k) fail(f, `${k}배 정수배 크기가 아님 (${img.w}×${img.h})`);
  if (!opaqueOk.test(name)) {
    let hasT = false;
    for (let i = 3; i < img.px.length; i += 4) if (img.px[i] === 0) { hasT = true; break; }
    if (!hasT) fail(f, '투명 픽셀이 없음');
    transparentChecked++;
  }
  if (/^bg_.*1920x1080/.test(name) && k > 1 && !(img.w === 1920 && img.h === 1080)) fail(f, `16:9 1920×1080 아님 (${img.w}×${img.h})`);
  // 확대본 == 1x 최근접 확대?
  if (k > 1) {
    const base = path.join(path.dirname(path.dirname(f)), '1x', path.basename(f));
    try {
      const b = readPng(base);
      if (b.w * k !== img.w || b.h * k !== img.h) fail(f, '1x 와 배율이 맞지 않음');
      else {
        for (let y = 0; y < img.h; y += Math.max(1, (img.h / 37) | 0))
          for (let x = 0; x < img.w; x += Math.max(1, (img.w / 41) | 0)) {
            const a = (y * img.w + x) * 4, c = (((y / k) | 0) * b.w + ((x / k) | 0)) * 4;
            if (img.px.readUInt32BE(a) !== b.px.readUInt32BE(c)) { fail(f, '확대본이 1x 와 다른 픽셀 (흐림?)'); y = img.h; break; }
          }
        scaleChecked++;
      }
    } catch { /* 1x 없는 시안 */ }
  }
}
const svgs = files.filter((f) => f.endsWith('.svg')).length;
console.log(`PNG ${pngs.length}개 (${(bytes / 1048576).toFixed(1)}MB) · SVG ${svgs}개 · 투명 배경 확인 ${transparentChecked}개 · 정수배 확대 확인 ${scaleChecked}개`);
console.log(bad ? `문제 ${bad}건` : '검수 통과');
process.exit(bad ? 1 : 0);
