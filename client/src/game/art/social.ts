/** 소셜 연출용 픽셀 아트: 이모티콘 말풍선, 팀 링, 종이비행기, 물풍선, 뿅망치 등 */
import { EMOTES, TEAM_SYMBOL_ROWS, TEAMS, type EmoteId } from '../../../../shared/social';
import { PixelCanvas } from './pixel';

const OUT = '#3d3047';

type Grid = string[];
function paint(pc: PixelCanvas, rows: Grid, ox: number, oy: number, colors: Record<string, string>) {
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = colors[r[x]];
      if (c) pc.set(ox + x, oy + y, c);
    }
  });
}

const EMOTE_ART: Record<EmoteId, { rows: Grid; colors: Record<string, string> }> = {
  heart: {
    rows: ['.rr.rr.', 'rwrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
    colors: { r: '#ff6b8a', w: '#ffd0dc' },
  },
  laugh: {
    rows: ['..yyy..', '.yyyyy.', 'yk.y.ky', 'yyyyyyy', 'ymmmmmy', '.ymmmy.', '..yyy..'],
    colors: { y: '#ffd66e', k: OUT, m: '#c0505a', '.': '' },
  },
  clap: {
    rows: ['l.....l', '.l...l.', '..s.s..', '.sssss.', '.sssss.', '..sss..'],
    colors: { l: '#ffd66e', s: '#f7cfab' },
  },
  angry: {
    rows: ['rr...rr', 'r.r.r.r', '..rrr..', '.r...r.', 'rr...rr'],
    colors: { r: '#ff5a5a' },
  },
  cry: {
    rows: ['..sss..', '.sssss.', 'skbsbks', 'sbsssbs', 'sb.m.bs', '.b...b.', '.b...b.'],
    colors: { s: '#bfe4fb', k: OUT, b: '#5aa3f0', m: OUT },
  },
  question: {
    rows: ['.ppp.', 'p...p', '...p.', '..p..', '..p..', '.....', '..p..'],
    colors: { p: '#957bd8' },
  },
  panic: {
    rows: ['o.o.b', 'o.o.b', 'o.o..', 'o.o.b', '.....', 'o.o..'],
    colors: { o: '#ff8f4c', b: '#86c8f2' },
  },
  star: {
    rows: ['...y...', '..yyy..', 'yyyyyyy', '.ywyyy.', '..yyy..', '.yy.yy.', '.y...y.'],
    colors: { y: '#ffd66e', w: '#fff6c8' },
  },
};

/** 이모티콘: 하얀 말풍선 안 아이콘 (15×16) */
export function buildEmote(id: EmoteId): HTMLCanvasElement {
  const pc = new PixelCanvas(17, 17);
  // 말풍선
  for (let y = 1; y <= 12; y++)
    for (let x = 1; x <= 15; x++) {
      const corner = (x === 1 || x === 15) && (y === 1 || y === 12);
      if (!corner) pc.set(x, y, '#ffffff');
    }
  pc.set(7, 13, '#ffffff');
  pc.set(8, 13, '#ffffff');
  pc.set(8, 14, '#ffffff');
  const a = EMOTE_ART[id];
  const w = a.rows[0].length;
  const h = a.rows.length;
  paint(pc, a.rows, 1 + Math.floor((15 - w) / 2), 1 + Math.floor((12 - h) / 2), a.colors);
  pc.outline(OUT);
  return pc.flush();
}

export const EMOTE_KEYS = EMOTES.map((e) => `emote-${e}`);

/** 발밑 팀 컬러 링 */
export function buildTeamRing(color: string): HTMLCanvasElement {
  const pc = new PixelCanvas(18, 8);
  pc.ellipse(9, 4, 8.5, 3.5, (dx, dy) => (dx * dx + dy * dy > 0.5 ? color : null));
  return pc.flush();
}

/** 팀 심볼 (캐릭터 위) */
export function buildTeamBadge(teamId: number): HTMLCanvasElement {
  const t = TEAMS[teamId];
  const pc = new PixelCanvas(11, 11);
  pc.circle(5.5, 5.5, 5, t.color);
  paint(pc, TEAM_SYMBOL_ROWS[t.symbol], 2, 2, { '#': '#ffffff' });
  pc.outline(OUT);
  return pc.flush();
}

export function buildPlane(): HTMLCanvasElement {
  const pc = new PixelCanvas(12, 9);
  paint(
    pc,
    ['w..........', 'www........', 'wwwww......', 'wwwwwwwww..', 'gggggwwwwww', '.ggg.......', '..g........'],
    0,
    1,
    { w: '#ffffff', g: '#cfd3e0' },
  );
  pc.outline(OUT);
  return pc.flush();
}

export function buildBalloon(): HTMLCanvasElement {
  const pc = new PixelCanvas(10, 11);
  pc.ellipse(5, 5, 4, 4.5, (dx, dy) => (dx + dy < -0.6 ? '#d6ecfd' : dx + dy > 0.6 ? '#4a8ed0' : '#6fb2ec'));
  pc.set(5, 10, '#4a8ed0');
  pc.outline(OUT);
  return pc.flush();
}

export function buildDrop(): HTMLCanvasElement {
  const pc = new PixelCanvas(3, 4);
  pc.set(1, 0, '#bfe4fb');
  pc.rect(0, 1, 3, 2, '#86c8f2');
  pc.set(1, 3, '#5aa3f0');
  return pc.flush();
}

export function buildHammer(): HTMLCanvasElement {
  const pc = new PixelCanvas(14, 14);
  // 머리 (빨강·노랑 장난감 망치)
  pc.rect(1, 1, 12, 6, '#ff6b6b');
  pc.rect(1, 1, 3, 6, '#ffd66e');
  pc.rect(10, 1, 3, 6, '#ffd66e');
  pc.hline(1, 12, 1, '#ffb0b0');
  // 손잡이
  pc.rect(6, 7, 2, 6, '#b9875a');
  pc.outline(OUT);
  return pc.flush();
}

export function buildImpact(): HTMLCanvasElement {
  const pc = new PixelCanvas(13, 13);
  paint(
    pc,
    ['......y......', '...y..y..y...', '....y.y.y....', '.....yyy.....', '.y..yywyy..y.', '..yyywwwyyy..', 'yyyywwwwwyyyy', '..yyywwwyyy..', '.y..yywyy..y.', '.....yyy.....', '....y.y.y....', '...y..y..y...', '......y......'],
    0,
    0,
    { y: '#ffd66e', w: '#ffffff' },
  );
  return pc.flush();
}
