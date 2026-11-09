/** 테스트용 간단 길찾기 (충돌 격자 위 BFS) */
import type { CollisionGrid } from '../shared/map';

export function findPath(grid: CollisionGrid, sx: number, sy: number, tx: number, ty: number): { x: number; y: number }[] | null {
  const cell = grid.cell;
  const cols = grid.cols;
  const rows = grid.rows;
  const toPos = (c: number, r: number) => ({ x: c * cell + cell / 2, y: r * cell + cell - 1 });
  const ok = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && grid.canStand(toPos(c, r).x, toPos(c, r).y);
  const sc = Math.floor(sx / cell);
  const sr = Math.floor(sy / cell);
  // 목표 근처에서 설 수 있는 칸 찾기
  let tc = Math.floor(tx / cell);
  let tr = Math.floor(ty / cell);
  if (!ok(tc, tr)) {
    let best: [number, number] | null = null;
    for (let d = 1; d < 8 && !best; d++)
      for (let dr = -d; dr <= d && !best; dr++)
        for (let dc = -d; dc <= d; dc++)
          if (ok(tc + dc, tr + dr)) {
            best = [tc + dc, tr + dr];
            break;
          }
    if (!best) return null;
    [tc, tr] = best;
  }
  const prev = new Int32Array(cols * rows).fill(-1);
  const start = sr * cols + sc;
  prev[start] = start;
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    const c = cur % cols;
    const r = (cur / cols) | 0;
    if (c === tc && r === tr) break;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      const ni = nr * cols + nc;
      if (!ok(nc, nr) || prev[ni] !== -1) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  const goal = tr * cols + tc;
  if (prev[goal] === -1) return null;
  const path: { x: number; y: number }[] = [];
  for (let i = goal; i !== start; i = prev[i]) path.push(toPos(i % cols, (i / cols) | 0));
  return path.reverse();
}

/** 경로를 따라 stepPx 씩 쪼갠 좌표 목록 */
export function densify(from: { x: number; y: number }, path: { x: number; y: number }[], stepPx: number) {
  const out: { x: number; y: number }[] = [];
  let p = from;
  for (const q of path) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const n = Math.max(1, Math.ceil(d / stepPx));
    for (let i = 1; i <= n; i++) out.push({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n });
    p = q;
  }
  return out;
}
