/** DOM 헬퍼 + 픽셀 스타일 아이콘 */

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** 8×8 격자 픽셀 아이콘 (문자열 → SVG) */
function pixelIcon(rows: string[], color = 'currentColor'): string {
  const size = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  });
  return `<svg viewBox="0 0 ${rows[0].length} ${size}" fill="${color}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

export const ICON = {
  people: pixelIcon([
    '..##..##..',
    '.####.###.',
    '.####.###.',
    '..##..##..',
    '.####.###.',
    '######.###',
    '######.###',
    '######.###',
  ]),
  menu: pixelIcon(['........', '########', '########', '........', '########', '########', '........', '########', '########']),
  close: pixelIcon(['##....##', '###..###', '.######.', '..####..', '..####..', '.######.', '###..###', '##....##']),
  crown: pixelIcon(['#..##..#', '##.##.##', '########', '########', '.######.', '.######.', '........']),
  sprout: pixelIcon(['##....##', '###..###', '.##..##.', '..####..', '...##...', '...##...', '...##...']),
  pin: pixelIcon(['..####..', '.######.', '###..###', '###..###', '.######.', '..####..', '...##...', '...##...']),
  expand: pixelIcon(['###..###', '##....##', '#......#', '........', '........', '#......#', '##....##', '###..###']),
  wifi: pixelIcon(['.######.', '#......#', '..####..', '.#....#.', '...##...', '...##...']),
  eye: pixelIcon(['..####..', '.#....#.', '#..##..#', '#..##..#', '.#....#.', '..####..']),
  qr: pixelIcon(['###.#.###', '#.#..#.#', '###.#.###', '...#.#...', '#.##.##.#', '...#..#..', '###.##.#.', '#.#..#.##', '###.#.#.#']),
  users: pixelIcon(['.##.', '####', '.##.', '####', '####']),
  check: pixelIcon(['.......#', '......##', '#....##.', '##..##..', '.####...', '..##....']),
  lock: pixelIcon(['..####..', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########']),
  sparkle: pixelIcon(['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...']),
};

export function icon(name: keyof typeof ICON, cls = 'ico'): HTMLSpanElement {
  return h('span', { class: cls, html: ICON[name] });
}

export function roleLabel(role: 'senior' | 'junior') {
  return role === 'senior' ? '선배' : '후배';
}

/** 쌍둥이 고리 로고 (선배·후배) */
export function logoMark(cls = 'logo-mark'): HTMLSpanElement {
  const svg = `<svg viewBox="0 0 22 14" shape-rendering="crispEdges" aria-hidden="true">
    <circle cx="7.5" cy="7" r="5.2" fill="none" stroke="#ff8f7a" stroke-width="2.6"/>
    <circle cx="14.5" cy="7" r="5.2" fill="none" stroke="#86c8f2" stroke-width="2.6"/>
    <path d="M10.6 2.6 A5.2 5.2 0 0 1 12.7 7" fill="none" stroke="#ff8f7a" stroke-width="2.6"/>
  </svg>`;
  return h('span', { class: cls, html: svg });
}
