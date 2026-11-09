/** 메시지 게시판: 쪽지 읽기 + 쓰기 (실시간으로 새 쪽지가 붙음) */
import { NOTE_MAX } from '../../../shared/constants';
import { gradeLabel } from '../../../shared/foods';
import type { BoardNote } from '../../../shared/protocol';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { h, ICON } from './dom';
import { Sheet } from './Sheet';

export const NOTE_COLORS = ['#fff1a8', '#c9f2e2', '#d6ecfd', '#ffd9e4', '#e8defc'];

function timeAgo(at: number) {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

function noteEl(n: BoardNote, fresh = false) {
  const tilt = ((n.id * 37) % 5) - 2;
  return h(
    'li',
    { class: `note ${fresh ? 'fresh' : ''}`, style: `--bg:${NOTE_COLORS[n.color] ?? NOTE_COLORS[0]};--tilt:${tilt * 0.6}deg` },
    h('p', {}, n.text),
    h(
      'footer',
      {},
      h('span', { class: `note-who ${n.role}`, html: n.role === 'senior' ? ICON.crown : ICON.sprout }),
      h('b', {}, `${gradeLabel(n.grade)} ${n.nickname}`),
      h('time', {}, timeAgo(n.at)),
    ),
  );
}

export function openBoard(parent: HTMLElement, net: Network, store: WorldStore, onClose?: () => void) {
  let unsub: (() => void) | null = null;
  const sheet = new Sheet(
    parent,
    h('h2', { class: 'sheet-title' }, '메시지 게시판'),
    () => {
      unsub?.();
      onClose?.();
    },
    'board-sheet',
  );
  let color = Math.floor(Math.random() * NOTE_COLORS.length);
  const list = h('ul', { class: 'note-list' }, h('li', { class: 'note-empty' }, '쪽지를 불러오는 중…'));
  const text = h('textarea', {
    rows: 2,
    maxlength: NOTE_MAX * 2,
    placeholder: '선후배에게 한마디 남겨요 (최대 60자)',
    oninput: () => refreshCount(),
  });
  const count = h('span', { class: 'note-count' });
  const msg = h('p', { class: 'sheet-msg', role: 'status' });
  const swatches = h('div', { class: 'note-colors' });
  const paint = () =>
    swatches.replaceChildren(
      ...NOTE_COLORS.map((c, i) =>
        h('button', {
          type: 'button',
          class: `note-swatch ${i === color ? 'on' : ''}`,
          style: `--c:${c}`,
          'aria-label': `쪽지 색 ${i + 1}`,
          onclick: () => {
            color = i;
            compose.style.setProperty('--bg', NOTE_COLORS[color]);
            paint();
          },
        }),
      ),
    );
  const refreshCount = () => {
    const n = Array.from(text.value.trim()).length;
    count.textContent = `${Math.min(n, NOTE_MAX)}/${NOTE_MAX}`;
    count.classList.toggle('over', n > NOTE_MAX);
  };
  const postBtn = h('button', { type: 'submit', class: 'btn-primary small' }, '붙이기');
  const compose = h(
    'form',
    {
      class: 'compose',
      style: `--bg:${NOTE_COLORS[color]}`,
      onsubmit: async (e) => {
        e.preventDefault();
        const v = Array.from(text.value.trim()).slice(0, NOTE_MAX).join('');
        if (!v) {
          msg.textContent = '쪽지 내용을 입력해주세요.';
          return;
        }
        postBtn.disabled = true;
        const res = await net.boardPost(v, color);
        postBtn.disabled = false;
        if (!res.ok) {
          msg.textContent = res.reason;
          return;
        }
        msg.textContent = '쪽지를 붙였어요!';
        text.value = '';
        refreshCount();
      },
    },
    text,
    h('div', { class: 'compose-row' }, swatches, count, postBtn),
  );
  paint();
  refreshCount();
  sheet.body.append(compose, msg, list);

  const render = (notes: BoardNote[]) => {
    list.replaceChildren(
      ...(notes.length
        ? notes
            .slice()
            .reverse()
            .map((n) => noteEl(n))
        : [h('li', { class: 'note-empty' }, '아직 쪽지가 없어요. 첫 쪽지를 남겨보세요!')]),
    );
  };
  net.boardList().then(render);
  unsub = store.on('note', (n) => {
    list.querySelector('.note-empty')?.remove();
    list.prepend(noteEl(n, true));
  });
  return sheet;
}
