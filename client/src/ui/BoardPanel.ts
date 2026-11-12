/**
 * 메시지 게시판: 쪽지 쓰기(익명 선택) · 최신순/랜덤 · 상세(댓글·하트) · 내 글 수정/삭제
 * 모든 변경은 서버 이벤트로 실시간 반영됩니다.
 */
import { COMMENT_MAX, NOTE_MAX } from '../../../shared/constants';
import { gradeLabel } from '../../../shared/foods';
import type { BoardComment, BoardMine, BoardNote } from '../../../shared/protocol';
import { TEAMS, teamSvg } from '../../../shared/social';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { sfx } from '../audio/Sound';
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

function who(n: { nickname: string; role: 'senior' | 'junior' | null; grade: number | null; gradeText: string; team: number; anon?: boolean }) {
  const t = TEAMS[n.team];
  return h(
    'span',
    { class: 'who-line' },
    n.anon
      ? h('span', { class: 'note-who anon' }, '?')
      : h('span', { class: `note-who ${n.role}`, html: n.role === 'senior' ? ICON.crown : ICON.sprout }),
    h('b', {}, n.anon ? '익명' : `${gradeLabel(n.grade ?? 0, n.gradeText)} ${n.nickname}`),
    t && !n.anon ? h('span', { class: 'mini-team', style: `--tc:${t.color}`, html: teamSvg(t.symbol, '#fff') }) : null,
  );
}

export function openBoard(parent: HTMLElement, net: Network, store: WorldStore, onClose?: () => void) {
  const unsubs: (() => void)[] = [];
  const sheet = new Sheet(
    parent,
    h('h2', { class: 'sheet-title' }, '메시지 게시판'),
    () => {
      unsubs.forEach((u) => u());
      onClose?.();
    },
    'board-sheet',
  );

  let notes: BoardNote[] = [];
  let mine: BoardMine = { notes: [], comments: [], liked: [] };
  let sort: 'new' | 'random' = 'new';
  let randomOrder: number[] = [];
  let detailId: number | null = null;
  let detailComments: BoardComment[] = [];
  let myComments = new Set<number>();
  let color = Math.floor(Math.random() * NOTE_COLORS.length);
  let anon = false;

  // ---------------------------------------------------------------- 목록 화면
  const listView = h('div', { class: 'board-list-view' });
  const detailView = h('div', { class: 'board-detail hidden' });
  const list = h('ul', { class: 'note-list' }, h('li', { class: 'note-empty' }, '쪽지를 불러오는 중…'));
  const text = h('textarea', { rows: 2, maxlength: NOTE_MAX * 2, placeholder: `선후배에게 한마디 (최대 ${NOTE_MAX}자)`, oninput: () => refreshCount() });
  const count = h('span', { class: 'note-count' });
  const msg = h('p', { class: 'sheet-msg', role: 'status' });
  const swatches = h('div', { class: 'note-colors' });
  const anonBtn = h(
    'button',
    {
      type: 'button',
      class: 'anon-toggle',
      onclick: () => {
        anon = !anon;
        paintAnon();
      },
    },
    '',
  );
  const paintAnon = () => {
    anonBtn.textContent = anon ? '익명으로 남기기' : '닉네임 공개';
    anonBtn.classList.toggle('on', anon);
  };
  const paintColors = () =>
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
            paintColors();
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
        if (!v) return void (msg.textContent = '쪽지 내용을 입력해주세요.');
        postBtn.disabled = true;
        const res = await net.req('boardPost', { text: v, color, anon });
        postBtn.disabled = false;
        if (!res.ok) return void (msg.textContent = res.reason);
        mine.notes.push(res.note.id);
        if (!notes.some((x) => x.id === res.note.id)) notes.push(res.note);
        renderList();
        msg.textContent = anon ? '익명으로 쪽지를 붙였어요! (내 글로 표시돼요)' : '쪽지를 붙였어요!';
        text.value = '';
        refreshCount();
      },
    },
    text,
    h('div', { class: 'compose-row' }, swatches, anonBtn, count, postBtn),
  );
  const sortBtns = h('div', { class: 'sort-tabs' });
  const paintSort = () =>
    sortBtns.replaceChildren(
      ...(['new', 'random'] as const).map((k) =>
        h(
          'button',
          {
            type: 'button',
            class: `tab ${sort === k ? 'on' : ''}`,
            onclick: () => {
              sort = k;
              if (k === 'random') randomOrder = notes.map((n) => n.id).sort(() => Math.random() - 0.5);
              paintSort();
              renderList();
            },
          },
          k === 'new' ? '최신순' : '랜덤',
        ),
      ),
    );
  paintColors();
  paintAnon();
  paintSort();
  refreshCount();
  listView.append(compose, msg, h('div', { class: 'list-head' }, sortBtns, h('span', { class: 'muted small' }, '쪽지를 누르면 댓글·하트')), list);

  const noteCard = (n: BoardNote) => {
    const tilt = ((n.id * 37) % 5) - 2;
    const isMine = mine.notes.includes(n.id);
    return h(
      'li',
      {
        class: `note ${isMine ? 'mine' : ''}`,
        style: `--bg:${NOTE_COLORS[n.color] ?? NOTE_COLORS[0]};--tilt:${tilt * 0.6}deg`,
        onclick: () => openDetail(n.id),
        tabindex: 0,
        role: 'button',
      },
      isMine ? h('span', { class: 'mine-tag' }, '내 글') : null,
      h('p', {}, n.text),
      h(
        'footer',
        {},
        who(n),
        h('span', { class: `stat ${mine.liked.includes(n.id) ? 'liked' : ''}` }, `♥ ${n.likes}`),
        h('span', { class: 'stat' }, `댓글 ${n.comments}`),
      ),
    );
  };

  const renderList = () => {
    let arr = notes.slice();
    if (sort === 'new') arr.sort((a, b) => b.at - a.at);
    else {
      const idx = new Map(randomOrder.map((id, i) => [id, i]));
      arr.sort((a, b) => (idx.get(a.id) ?? -1) - (idx.get(b.id) ?? -1));
    }
    list.replaceChildren(...(arr.length ? arr.map(noteCard) : [h('li', { class: 'note-empty' }, '아직 쪽지가 없어요. 첫 쪽지를 남겨보세요!')]));
  };

  // ---------------------------------------------------------------- 상세 화면
  const openDetail = async (id: number) => {
    detailId = id;
    listView.classList.add('hidden');
    detailView.classList.remove('hidden');
    detailComments = [];
    renderDetail();
    const res = await net.req('boardComments', { id });
    if ('comments' in res) {
      detailComments = res.comments;
      myComments = new Set(res.mine);
      renderDetail();
    }
  };
  const closeDetail = () => {
    detailId = null;
    detailView.classList.add('hidden');
    listView.classList.remove('hidden');
    renderList();
  };

  const renderDetail = () => {
    const n = notes.find((x) => x.id === detailId);
    if (!n) {
      detailView.replaceChildren(h('button', { type: 'button', class: 'back-btn', onclick: closeDetail }, '← 목록'), h('p', { class: 'note-empty' }, '삭제된 쪽지예요.'));
      return;
    }
    const isMine = mine.notes.includes(n.id);
    const liked = mine.liked.includes(n.id);
    const dmsg = h('p', { class: 'sheet-msg' });
    const heart = h(
      'button',
      {
        type: 'button',
        class: `heart-btn ${liked ? 'on' : ''}`,
        onclick: async () => {
          heart.disabled = true;
          const r = await net.req('boardLike', { id: n.id });
          if (r.ok && r.liked) sfx('board.like');
          heart.disabled = false;
          if (!r.ok) return void (dmsg.textContent = r.reason);
          mine.liked = mine.liked.filter((x) => x !== n.id);
          if (r.liked) mine.liked.push(n.id);
          n.likes = r.likes;
          renderDetail();
        },
      },
      `♥ ${n.likes}`,
    );
    const owner = isMine
      ? h(
          'div',
          { class: 'owner-btns' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn-secondary',
              onclick: async () => {
                const v = prompt('쪽지 고치기', n.text);
                if (v === null) return;
                const r = await net.req('boardEdit', { id: n.id, text: v });
                if (!r.ok) dmsg.textContent = r.reason;
              },
            },
            '수정',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn-danger',
              onclick: async () => {
                if (!confirm('이 쪽지를 지울까요? 달린 댓글과 하트도 함께 지워지고 되돌릴 수 없어요.')) return;
                const r = await net.req('boardDelete', { id: n.id });
                if (!r.ok) dmsg.textContent = r.reason;
              },
            },
            '삭제',
          ),
        )
      : null;

    const cText = h('input', { type: 'text', maxlength: COMMENT_MAX * 2, placeholder: `댓글 달기 (최대 ${COMMENT_MAX}자)` });
    const cForm = h(
      'form',
      {
        class: 'comment-form',
        onsubmit: async (e) => {
          e.preventDefault();
          const v = cText.value.trim();
          if (!v) return;
          const r = await net.req('commentPost', { noteId: n.id, text: v });
          if (!r.ok) return void (dmsg.textContent = r.reason);
          myComments.add(r.comment.id);
          cText.value = '';
          renderDetail();
        },
      },
      cText,
      h('button', { type: 'submit', class: 'btn-primary small' }, '등록'),
    );

    const comments = h(
      'ul',
      { class: 'comment-list' },
      ...(detailComments.length
        ? detailComments.map((c) => {
            const mineC = myComments.has(c.id);
            return h(
              'li',
              { class: `comment ${mineC ? 'mine' : ''}` },
              h('div', { class: 'comment-head' }, who(c), h('time', {}, timeAgo(c.at) + (c.editedAt ? ' · 수정됨' : ''))),
              h('p', {}, c.text),
              mineC
                ? h(
                    'div',
                    { class: 'comment-own' },
                    h(
                      'button',
                      {
                        type: 'button',
                        onclick: async () => {
                          const v = prompt('댓글 고치기', c.text);
                          if (v === null) return;
                          const r = await net.req('commentEdit', { id: c.id, text: v });
                          if (!r.ok) dmsg.textContent = r.reason;
                        },
                      },
                      '수정',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        onclick: async () => {
                          if (!confirm('댓글을 지울까요?')) return;
                          const r = await net.req('commentDelete', { id: c.id });
                          if (!r.ok) dmsg.textContent = r.reason;
                        },
                      },
                      '삭제',
                    ),
                  )
                : null,
            );
          })
        : [h('li', { class: 'note-empty small' }, '첫 댓글을 남겨보세요')]),
    );

    detailView.replaceChildren(
      h('button', { type: 'button', class: 'back-btn', onclick: closeDetail }, '← 목록'),
      h(
        'article',
        { class: 'note big', style: `--bg:${NOTE_COLORS[n.color] ?? NOTE_COLORS[0]};--tilt:0deg` },
        isMine ? h('span', { class: 'mine-tag' }, n.anon ? '내 글 (익명)' : '내 글') : null,
        h('p', {}, n.text),
        h('footer', {}, who(n), h('time', {}, timeAgo(n.at) + (n.editedAt ? ' · 수정됨' : ''))),
      ),
      h('div', { class: 'detail-actions' }, heart, owner),
      dmsg,
      h('h3', {}, `댓글 ${detailComments.length}`),
      comments,
      cForm,
    );
  };

  sheet.body.append(listView, detailView);

  // ---------------------------------------------------------------- 데이터 & 실시간
  net.req('boardList').then((res) => {
    if (!('notes' in res)) return;
    notes = res.notes;
    mine = res.mine;
    renderList();
  });
  const upsert = (n: BoardNote) => {
    const i = notes.findIndex((x) => x.id === n.id);
    if (i >= 0) notes[i] = n;
    else {
      notes.push(n);
      randomOrder.push(n.id);
    }
  };
  unsubs.push(
    store.on('note', (n) => {
      upsert(n);
      if (detailId === null) renderList();
    }),
    store.on('noteUpdate', (n) => {
      upsert(n);
      if (detailId === n.id) renderDetail();
      else if (detailId === null) renderList();
    }),
    store.on('noteDelete', (id) => {
      notes = notes.filter((x) => x.id !== id);
      if (detailId === id) renderDetail();
      else if (detailId === null) renderList();
    }),
    store.on('comment', (c) => {
      if (c.noteId !== detailId) return;
      if (!detailComments.some((x) => x.id === c.id)) detailComments.push(c);
      renderDetail();
    }),
    store.on('commentUpdate', (c) => {
      const i = detailComments.findIndex((x) => x.id === c.id);
      if (i >= 0) {
        detailComments[i] = c;
        renderDetail();
      }
    }),
    store.on('commentDelete', (noteId, id) => {
      if (noteId !== detailId) return;
      detailComments = detailComments.filter((x) => x.id !== id);
      renderDetail();
    }),
  );
  return sheet;
}
