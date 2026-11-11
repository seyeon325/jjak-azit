/** 팀 · 이모티콘 · 포즈 · 플레이어 상호작용 · 모닥불 질문 (클라이언트·서버 공용) */

export interface TeamDef {
  id: number;
  key: string;
  defaultName: string;
  color: string;
  dark: string;
  symbol: 'star' | 'drop' | 'leaf' | 'sun' | 'moon' | 'heart';
}

export const TEAMS: TeamDef[] = [
  { id: 0, key: 'red', defaultName: '레드팀', color: '#ff6b6b', dark: '#d44e4e', symbol: 'star' },
  { id: 1, key: 'blue', defaultName: '블루팀', color: '#5aa3f0', dark: '#3c82cf', symbol: 'drop' },
  { id: 2, key: 'green', defaultName: '그린팀', color: '#62c46a', dark: '#43a24c', symbol: 'leaf' },
  { id: 3, key: 'yellow', defaultName: '옐로팀', color: '#ffcb3d', dark: '#e0a91c', symbol: 'sun' },
  { id: 4, key: 'purple', defaultName: '퍼플팀', color: '#a98bf0', dark: '#8668d6', symbol: 'moon' },
  { id: 5, key: 'pink', defaultName: '핑크팀', color: '#ff8fc0', dark: '#e66ea2', symbol: 'heart' },
];
export const TEAM_NONE = -1;

/** 팀 심볼 7×7 픽셀 */
export const TEAM_SYMBOL_ROWS: Record<TeamDef['symbol'], string[]> = {
  star: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  drop: ['...#...', '..###..', '.#####.', '#######', '#######', '.#####.', '..###..'],
  leaf: ['....###', '..#####', '.######', '.#####.', '.####..', '#.#....', '#......'],
  sun: ['#..#..#', '.#####.', '.#####.', '#######', '.#####.', '.#####.', '#..#..#'],
  moon: ['..###..', '.###...', '###....', '###....', '###....', '.###...', '..###..'],
  heart: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
};

export function teamSvg(symbol: TeamDef['symbol'], color = 'currentColor') {
  const rows = TEAM_SYMBOL_ROWS[symbol];
  let rects = '';
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  });
  return `<svg viewBox="0 0 7 7" fill="${color}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

export const EMOTES = ['heart', 'laugh', 'clap', 'angry', 'cry', 'question', 'panic', 'star'] as const;
export type EmoteId = (typeof EMOTES)[number];
export const EMOTE_LABEL: Record<EmoteId, string> = {
  heart: '하트',
  laugh: '웃음',
  clap: '박수',
  angry: '화남',
  cry: '울음',
  question: '물음표',
  panic: '당황',
  star: '별',
};

export const POSES = ['wave', 'v', 'jump', 'spin', 'sit', 'dance', 'surprised'] as const;
export type PoseId = (typeof POSES)[number] | 'bump' | 'push';
export const POSE_LABEL: Record<(typeof POSES)[number], string> = {
  wave: '손 흔들기',
  v: '브이',
  jump: '점프',
  spin: '빙글',
  sit: '앉기',
  dance: '춤추기',
  surprised: '놀람',
};

export const INTERACTIONS = ['greet', 'heart', 'clap', 'plane', 'balloon', 'hammer', 'dance', 'follow'] as const;
export type InteractionId = (typeof INTERACTIONS)[number];
export interface InteractionDef {
  label: string;
  /** 장난 (상대가 거부 설정 시 불가) */
  prank: boolean;
  /** 최대 거리 px */
  range: number;
  /** 쿨타임 ms */
  cooldown: number;
  /** 상대 수락이 필요한 요청 */
  request?: boolean;
}
export const INTERACTION_DEF: Record<InteractionId, InteractionDef> = {
  greet: { label: '인사하기', prank: false, range: 110, cooldown: 1200 },
  heart: { label: '하트 보내기', prank: false, range: 130, cooldown: 1500 },
  clap: { label: '박수 보내기', prank: false, range: 130, cooldown: 1500 },
  plane: { label: '종이비행기', prank: true, range: 150, cooldown: 2500 },
  balloon: { label: '물풍선', prank: true, range: 120, cooldown: 3000 },
  hammer: { label: '뿅망치', prank: true, range: 40, cooldown: 3000 },
  dance: { label: '함께 춤추기', prank: false, range: 120, cooldown: 5000, request: true },
  follow: { label: '따라가기', prank: false, range: 120, cooldown: 5000, request: true },
};

export const FIRE_QUESTIONS = [
  '이번 학기 가장 힘들었던 과제는?',
  '선배에게 궁금한 것은?',
  '학교생활하면서 가장 기억에 남는 일은?',
  '우리 조가 함께 해보고 싶은 활동은?',
  '요즘 가장 많이 쓰는 툴이나 프로그램은?',
  '학교 근처 최애 맛집은 어디?',
  '1학년 때의 나에게 해주고 싶은 말은?',
  '졸업 작품으로 만들어보고 싶은 것은?',
  'AR·VR로 꼭 만들어보고 싶은 경험은?',
  '밤샘 작업할 때 꼭 필요한 간식은?',
  '전공을 선택하게 된 계기는?',
  '방학 때 꼭 해보고 싶은 것은?',
  '가장 좋아하는 게임이나 영화는?',
  '팀플에서 나는 어떤 역할을 주로 맡아?',
  '요즘 빠져 있는 취미는?',
  '10년 뒤 나는 어떤 일을 하고 있을까?',
];

export function gradeText(grade: number | undefined, text?: string | null): string {
  if (grade && grade >= 1 && grade <= 4) return `${grade}학년`;
  const t = (text ?? '').trim();
  return t || '기타';
}
