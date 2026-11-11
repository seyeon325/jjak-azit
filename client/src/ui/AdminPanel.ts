/**
 * 운영자 페이지 (/admin)
 *  - 비밀번호 로그인 → 서버가 발급한 토큰으로 소켓 권한 확인 (비밀번호는 클라이언트 코드에 없음)
 *  - 접속자 · 팀 배정 · 채팅 제한 · 공지 · 표시 설정/단체 사진 · 게시판 관리 · CSV 내보내기 · 팀 이름
 */
import { gradeLabel } from '../../../shared/foods';
import type { AdminNote, AdminPlayer, DisplaySettings } from '../../../shared/protocol';
import { TEAMS, teamSvg } from '../../../shared/social';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { h, icon, logoMark, roleLabel } from './dom';

const TOKEN_KEY = 'azit.admin.v1';

export function adminToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { token: string; exp: number };
    return v.exp > Date.now() ? v.token : null;
  } catch {
    return null;
  }
}
export function clearAdminToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* */
  }
}

/** 로그인 화면. 성공하면 토큰을 돌려줌 */
export function adminLogin(app: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    const pw = h('input', { type: 'password', placeholder: '운영자 비밀번호', autocomplete: 'current-password' });
    const msg = h('p', { class: 'login-msg' });
    const btn = h('button', { type: 'submit', class: 'btn-primary' }, '로그인');
    const el = h(
      'div',
      { class: 'login admin-login' },
      h(
        'form',
        {
          class: 'login-card',
          onsubmit: async (e) => {
            e.preventDefault();
            btn.disabled = true;
            msg.textContent = '';
            try {
              const r = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw.value }),
              });
              const j = (await r.json()) as { ok: boolean; token?: string; expiresAt?: number; reason?: string };
              if (!j.ok || !j.token) throw new Error(j.reason ?? '로그인에 실패했어요.');
              sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: j.token, exp: j.expiresAt }));
              el.remove();
              resolve(j.token);
            } catch (err) {
              msg.textContent = (err as Error).message;
              btn.disabled = false;
            }
          },
        },
        h('header', { class: 'login-head' }, logoMark('logo-mark big'), h('h1', {}, '운영자 페이지'), h('p', {}, '짝선짝후 아지트 관리')),
        h('section', { class: 'step' }, h('div', { class: 'nick-field' }, pw)),
        btn,
        msg,
        h('p', { class: 'muted small' }, '비밀번호는 서버의 ADMIN_PASSWORD 환경변수로 정해요. 설정하지 않았다면 서버 로그에 임시 비밀번호가 표시돼요.'),
      ),
    );
    app.append(el);
    setTimeout(() => pw.focus(), 50);
  });
}

type Tab = 'people' | 'screen' | 'board' | 'teams';

export class AdminPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tabsEl: HTMLElement;
  private tab: Tab = 'people';
  private players: AdminPlayer[] = [];
  private notes: AdminNote[] = [];
  private refreshTimer = 0;

  constructor(
    private store: WorldStore,
    private net: Network,
    private token: string,
    private onTrack: (id: number) => void,
    private onLogout: () => void,
  ) {
    this.body = h('div', { class: 'admin-body' });
    this.tabsEl = h('div', { class: 'tabs' });
    this.el = h(
      'aside',
      { class: 'admin-panel' },
      h(
        'div',
        { class: 'admin-head' },
        h('b', {}, '운영자'),
        this.tabsEl,
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '패널 접기', onclick: () => this.toggleCollapse() }, icon('menu')),
      ),
      this.body,
    );
    const later = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refresh(), 400);
    };
    for (const ev of ['join', 'leave', 'status', 'patch', 'reset'] as const) store.on(ev, later);
    for (const ev of ['note', 'noteUpdate', 'noteDelete', 'comment', 'commentDelete'] as const) store.on(ev, later);
    store.on('display', () => this.tab === 'screen' && this.render());
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'a' || e.key === 'A') && (e.target as HTMLElement).tagName !== 'INPUT') this.toggleCollapse();
    });
    this.refresh();
  }

  /** 패널을 접으면 맵이 화면 전체를 쓰도록 */
  toggleCollapse() {
    const c = this.el.classList.toggle('collapsed');
    this.el.parentElement?.classList.toggle('panel-collapsed', c);
  }

  private async refresh() {
    if (this.tab === 'people') {
      const r = await this.net.req('adminPlayers');
      if (Array.isArray(r)) this.players = r;
    }
    if (this.tab === 'board') {
      const r = await this.net.req('adminBoard');
      if (Array.isArray(r)) this.notes = r;
    }
    this.render();
  }

  private say(text: string) {
    const t = h('p', { class: 'admin-toast' }, text);
    this.el.append(t);
    setTimeout(() => t.remove(), 2500);
  }

  private async call(ev: string, payload: unknown) {
    const r = (await this.net.req(ev as never, payload)) as { ok: boolean; reason?: string };
    if (!r.ok) this.say(r.reason ?? '실패했어요.');
    return r.ok;
  }

  private render() {
    const tabs: [Tab, string][] = [
      ['people', `참가자 ${this.store.onlineCount}`],
      ['screen', '공지·화면'],
      ['board', '게시판'],
      ['teams', '팀 이름'],
    ];
    this.tabsEl.replaceChildren(
      ...tabs.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: `tab ${this.tab === id ? 'on' : ''}`,
            onclick: () => {
              this.tab = id;
              this.refresh();
            },
          },
          label,
        ),
      ),
    );
    this.body.replaceChildren(
      this.tab === 'people' ? this.peopleView() : this.tab === 'screen' ? this.screenView() : this.tab === 'board' ? this.boardView() : this.teamsView(),
    );
  }

  private peopleView() {
    const rows = this.players
      .slice()
      .sort((a, b) => a.team - b.team || a.nickname.localeCompare(b.nickname, 'ko'))
      .map((p) => {
        const sel = h(
          'select',
          {
            onchange: async () => {
              if (await this.call('adminSetTeam', { id: p.id, team: Number(sel.value) })) this.say(`${p.nickname} 님 팀을 바꿨어요.`);
            },
          },
          h('option', { value: '-1' }, '팀 없음'),
          ...TEAMS.map((t) => h('option', { value: String(t.id) }, this.store.teamNames[t.id] ?? t.defaultName)),
        );
        sel.value = String(p.team);
        const t = TEAMS[p.team];
        return h(
          'li',
          { class: p.status === 'away' ? 'away' : '' },
          t ? h('span', { class: 'mini-team', style: `--tc:${t.color}`, html: teamSvg(t.symbol, '#fff') }) : h('span', { class: 'mini-team none' }),
          h('div', { class: 'who' }, h('b', {}, p.nickname), h('small', {}, `${gradeLabel(p.grade, p.gradeText)} · ${roleLabel(p.role)}${p.status === 'away' ? ' · 연결 끊김' : ''}`)),
          sel,
          h(
            'button',
            {
              type: 'button',
              class: `mini-btn ${p.muted ? 'on' : ''}`,
              onclick: async () => {
                if (await this.call('adminMute', { id: p.id, muted: !p.muted })) {
                  p.muted = !p.muted;
                  this.render();
                }
              },
            },
            p.muted ? '제한 해제' : '채팅 제한',
          ),
          h('button', { type: 'button', class: 'mini-btn', onclick: () => this.onTrack(p.id) }, '추적'),
        );
      });
    return h('div', {}, h('ul', { class: 'admin-list' }, ...(rows.length ? rows : [h('li', { class: 'empty' }, '아직 접속한 사람이 없어요')])));
  }

  private screenView() {
    const d = this.store.display;
    const notice = h('input', { type: 'text', maxlength: 80, placeholder: '모두에게 보낼 공지 (예: 5분 뒤 단체 사진!)' });
    const toggle = (k: keyof DisplaySettings, label: string) => {
      const cb = h('input', { type: 'checkbox', onchange: () => this.call('adminDisplay', { [k]: cb.checked }) });
      cb.checked = d[k];
      return h('label', { class: 'toggle' }, cb, h('span', {}, label));
    };
    return h(
      'div',
      { class: 'admin-screen' },
      h('h3', {}, '전체 공지'),
      h(
        'form',
        {
          class: 'row',
          onsubmit: async (e) => {
            e.preventDefault();
            if (await this.call('adminNotice', { text: notice.value })) {
              notice.value = '';
              this.say('공지를 보냈어요.');
            }
          },
        },
        notice,
        h('button', { type: 'submit', class: 'btn-primary small' }, '보내기'),
      ),
      h('h3', {}, '단체 사진'),
      h(
        'button',
        { type: 'button', class: `btn-primary photo-btn ${d.photo ? 'on' : ''}`, onclick: () => this.call('adminDisplay', { photo: !d.photo }) },
        d.photo ? '단체 사진 모드 끝내기' : '단체 사진 모드 시작',
      ),
      h('p', { class: 'muted small' }, '모든 화면에서 이름표·말풍선을 숨기고, 관전 화면은 참가자가 모두 보이게 맞춰요. 끝내면 원래대로 돌아와요.'),
      h('h3', {}, '모든 참가자 화면 표시'),
      toggle('hideNames', '닉네임 숨기기'),
      toggle('hideTeams', '팀 컬러·심볼 숨기기'),
      toggle('hideBubbles', '말풍선 숨기기'),
      h('h3', {}, '기록'),
      h('button', { type: 'button', class: 'btn-secondary', onclick: () => this.downloadCsv() }, '게시판 기록 CSV 내려받기'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn-danger',
          onclick: async () => {
            await fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: `Bearer ${this.token}` } }).catch(() => {});
            this.onLogout();
          },
        },
        '로그아웃',
      ),
    );
  }

  private async downloadCsv() {
    const r = await fetch('/api/admin/export.csv', { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) return this.say('로그인이 만료됐어요. 다시 로그인해주세요.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jjak-azit-board-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private boardView() {
    return h(
      'ul',
      { class: 'admin-notes' },
      ...(this.notes.length
        ? this.notes.map((n) =>
            h(
              'li',
              {},
              h('div', { class: 'an-head' }, h('b', {}, `#${n.id} ${n.author}`), n.anon ? h('em', {}, '익명 게시') : null, h('small', {}, `♥${n.likes} · 키 ${n.ownerKey}`)),
              h('p', {}, n.text),
              h(
                'button',
                {
                  type: 'button',
                  class: 'mini-btn danger',
                  onclick: async () => {
                    if (confirm(`#${n.id} 쪽지를 지울까요? 댓글도 함께 지워져요.`)) await this.call('adminDeleteNote', { id: n.id });
                  },
                },
                '쪽지 삭제',
              ),
              n.commentList.length
                ? h(
                    'ul',
                    { class: 'an-comments' },
                    ...n.commentList.map((c) =>
                      h(
                        'li',
                        {},
                        h('b', {}, c.nickname),
                        h('span', {}, c.text),
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'mini-btn danger',
                            onclick: async () => {
                              if (confirm('이 댓글을 지울까요?')) await this.call('adminDeleteComment', { id: c.id });
                            },
                          },
                          '삭제',
                        ),
                      ),
                    ),
                  )
                : null,
            ),
          )
        : [h('li', { class: 'empty' }, '아직 쪽지가 없어요')]),
    );
  }

  private teamsView() {
    const inputs = TEAMS.map((t) => {
      const i = h('input', { type: 'text', maxlength: 8, value: this.store.teamNames[t.id] ?? t.defaultName });
      return h('label', { class: 'team-name-row', style: `--tc:${t.color}` }, h('i', { html: teamSvg(t.symbol, '#fff') }), i);
    });
    return h(
      'form',
      {
        class: 'admin-teams',
        onsubmit: async (e) => {
          e.preventDefault();
          const names = inputs.map((l) => (l.querySelector('input') as HTMLInputElement).value);
          if (await this.call('adminTeamNames', { names })) this.say('팀 이름을 저장했어요.');
        },
      },
      ...inputs,
      h('button', { type: 'submit', class: 'btn-primary small' }, '저장'),
      h('p', { class: 'muted small' }, '팀 이름은 입장 화면과 참가자 메뉴에 바로 반영돼요.'),
    );
  }
}
