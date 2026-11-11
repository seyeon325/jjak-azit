/** 이모티콘·포즈 퀵 메뉴, 참가자 상호작용 메뉴, 받은 요청 카드 */
import type { PlayerInfo, RequestEvent } from '../../../shared/protocol';
import {
  EMOTE_LABEL,
  EMOTES,
  INTERACTION_DEF,
  INTERACTIONS,
  POSE_LABEL,
  POSES,
  type EmoteId,
  type InteractionId,
  type PoseId,
} from '../../../shared/social';
import { gradeLabel } from '../../../shared/foods';
import { buildEmote } from '../game/art/social';
import { h } from './dom';
import { Sheet } from './Sheet';

function emoteIcon(e: EmoteId) {
  const src = buildEmote(e);
  const c = h('canvas', { class: 'emote-icon', width: src.width * 3, height: src.height * 3 });
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const POSE_ICON: Record<(typeof POSES)[number], string> = {
  wave: '∿',
  v: 'V',
  jump: '⤴',
  spin: '↻',
  sit: '▂',
  dance: '♪',
  surprised: '!',
};

export function openEmoteMenu(
  parent: HTMLElement,
  onEmote: (e: EmoteId) => void,
  onPose: (p: PoseId) => void,
  onClose?: () => void,
) {
  const sheet = new Sheet(parent, h('h2', { class: 'sheet-title' }, '표정 · 동작'), onClose, 'emote-sheet');
  const pick = (fn: () => void) => () => {
    fn();
    sheet.close();
  };
  sheet.body.append(
    h('h3', {}, '이모티콘'),
    h(
      'div',
      { class: 'emote-grid' },
      ...EMOTES.map((e) => h('button', { type: 'button', class: 'emote-btn', onclick: pick(() => onEmote(e)) }, emoteIcon(e), h('span', {}, EMOTE_LABEL[e]))),
    ),
    h('h3', {}, '동작'),
    h(
      'div',
      { class: 'pose-grid' },
      ...POSES.map((p) => h('button', { type: 'button', class: 'pose-btn', onclick: pick(() => onPose(p)) }, h('i', {}, POSE_ICON[p]), h('span', {}, POSE_LABEL[p]))),
    ),
    h('p', { class: 'muted small' }, '움직이면 동작이 멈춰요. 여럿이 같이 춤추면 더 신나요!'),
  );
  return sheet;
}

const ACT_ICON: Record<InteractionId, string> = {
  greet: '∿',
  heart: '♥',
  clap: '✦',
  plane: '✈',
  balloon: '●',
  hammer: 'T',
  dance: '♪',
  follow: '→',
};

export function openPlayerMenu(
  parent: HTMLElement,
  target: PlayerInfo,
  distance: number,
  onPick: (k: InteractionId) => Promise<string | null>,
  onClose?: () => void,
) {
  const sheet = new Sheet(
    parent,
    h('h2', { class: 'sheet-title' }, `${gradeLabel(target.grade, target.gradeText)} ${target.nickname}`, h('small', { class: 'muted' }, ' 님에게')),
    onClose,
    'player-sheet',
  );
  const msg = h('p', { class: 'sheet-msg', role: 'status' });
  const grid = h('div', { class: 'act-grid' });
  for (const k of INTERACTIONS) {
    const def = INTERACTION_DEF[k];
    const blocked = def.prank && target.noPrank;
    const far = distance > def.range;
    const b = h(
      'button',
      {
        type: 'button',
        class: `act-card ${def.prank ? 'prank' : ''}`,
        disabled: blocked,
        onclick: async () => {
          b.disabled = true;
          const err = await onPick(k);
          b.disabled = false;
          if (err) msg.textContent = err;
          else sheet.close();
        },
      },
      h('i', {}, ACT_ICON[k]),
      h('span', {}, def.label),
      blocked ? h('small', {}, '장난 거부 중') : far ? h('small', {}, '더 가까이') : def.request ? h('small', {}, '상대 수락 필요') : null,
    );
    grid.append(b);
  }
  sheet.body.append(grid, msg, h('p', { class: 'muted small' }, '물풍선·뿅망치 같은 장난은 화면 연출뿐이에요. 내 장난 받기 설정은 메뉴 → 내 캐릭터에서 바꿀 수 있어요.'));
  return sheet;
}

/** 받은 요청 (함께 춤추기 / 따라가기) */
export function showRequest(parent: HTMLElement, r: RequestEvent, onAnswer: (accept: boolean) => void) {
  const text = r.kind === 'dance' ? `${r.nickname} 님이 같이 춤추자고 해요!` : `${r.nickname} 님이 나를 따라가고 싶어 해요.`;
  let done = false;
  const answer = (a: boolean) => {
    if (done) return;
    done = true;
    onAnswer(a);
    card.classList.add('out');
    setTimeout(() => card.remove(), 250);
  };
  const card = h(
    'div',
    { class: 'req-card', role: 'alertdialog' },
    h('p', {}, text),
    h(
      'div',
      { class: 'req-btns' },
      h('button', { type: 'button', class: 'btn-secondary', onclick: () => answer(false) }, '괜찮아요'),
      h('button', { type: 'button', class: 'btn-primary small', onclick: () => answer(true) }, '좋아요'),
    ),
  );
  parent.append(card);
  setTimeout(() => answer(false), 14_000);
}
