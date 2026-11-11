/**
 * 운영자 페이지 (/admin)
 *  - 비밀번호 로그인 → 서버가 발급한 토큰으로 소켓 권한 확인 (비밀번호는 클라이언트 코드에 없음)
 *  - 오른쪽 패널 + 항상 보이는 '운영자 메뉴' 버튼 (패널을 접어도 버튼은 화면에 남음)
 *  - 메뉴는 SECTIONS 목록 하나로 관리 → 3차(랜덤 추첨·레이드·시상식)는 항목만 추가하면 됨
 *
 * [이전 오류 원인] 접기 버튼이 패널 머리줄 오른쪽 끝에 있었는데, 접으면 패널이 오른쪽으로 밀려나
 * 왼쪽 54px 만 남았기 때문에 다시 펼칠 버튼이 화면 밖으로 나가 버렸습니다. (숨은 단축키 A 로만 복구 가능)
 * → 열기/닫기 버튼을 패널 밖의 고정 버튼으로 분리하고, 열림 상태는 한 곳(open)에서만 관리합니다.
 */
import { gradeLabel } from '../../../shared/foods';
import { HS, HS_PHASE_LABEL, hsActive, POOL_LABEL, type EggAdminRow, type PrizePool, type PrizeSummary } from '../../../shared/events';
import type { AdminHsInfo, AdminNote, AdminPlayer, DisplaySettings } from '../../../shared/protocol';
import { TEAMS, teamSvg } from '../../../shared/social';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { h, icon, logoMark, roleLabel } from './dom';
import type { ScreenHud } from './ScreenHud';

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
export function saveAdminToken(token: string, exp: number) {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp }));
  } catch {
    /* 저장이 안 되면 이번 화면에서만 유지 */
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
              saveAdminToken(j.token, j.expiresAt ?? Date.now() + 3600_000);
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

type SectionId = 'dash' | 'people' | 'board' | 'notice' | 'camera' | 'photo' | 'hs' | 'awards' | 'eggs' | 'prizes' | 'settings';

/** 메뉴 목록 (3차: 'draw' 랜덤 추첨 · 'raid' 과제 괴물 · 'ceremony' 시상식을 여기에 추가) */
const SECTIONS: { id: SectionId; label: string; short: string }[] = [
  { id: 'dash', label: '대시보드', short: '대시보드' },
  { id: 'people', label: '접속자 관리', short: '접속자' },
  { id: 'board', label: '메시지 게시판 관리', short: '게시판' },
  { id: 'notice', label: '전체 공지', short: '공지' },
  { id: 'camera', label: '관전 카메라', short: '카메라' },
  { id: 'photo', label: '단체 사진 모드', short: '단체 사진' },
  { id: 'hs', label: '학회장을 찾아라!', short: '숨바꼭질' },
  { id: 'awards', label: '숨바꼭질 당첨 · 상품 지급 기록', short: '당첨 기록' },
  { id: 'eggs', label: '이스터에그 관리', short: '이스터에그' },
  { id: 'prizes', label: '상품 관리', short: '상품' },
  { id: 'settings', label: '설정', short: '설정' },
];

export class AdminPanel {
  /** 패널 + 열기 버튼을 담는 묶음 (stage 에 그대로 붙임) */
  readonly el: HTMLElement;
  private panel: HTMLElement;
  private fab: HTMLElement;
  private body: HTMLElement;
  private nav: HTMLElement;
  private titleEl: HTMLElement;
  private section: SectionId = 'dash';
  private open = true;
  private players: AdminPlayer[] = [];
  private notes: AdminNote[] = [];
  private hsInfo: AdminHsInfo | null = null;
  private prizes: PrizeSummary | null = null;
  private eggs: EggAdminRow[] = [];
  private refreshTimer = 0;
  private liveTimer = 0;
  private searchSec = HS.searchMs / 1000;
  private hostChoice: number | null = null;

  constructor(
    private store: WorldStore,
    private net: Network,
    private token: string,
    private hud: ScreenHud,
    private onLogout: () => void,
  ) {
    this.body = h('div', { class: 'admin-body' });
    this.nav = h('nav', { class: 'admin-nav', 'aria-label': '운영자 메뉴' });
    this.titleEl = h('span', { class: 'admin-sec-title' });
    this.panel = h(
      'aside',
      { class: 'admin-panel', 'aria-label': '운영자 패널' },
      h(
        'div',
        { class: 'admin-head' },
        h('b', {}, '운영자'),
        this.titleEl,
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '패널 접기', title: '패널 접기 (A)', onclick: () => this.setOpen(false) }, icon('close')),
      ),
      this.nav,
      this.body,
    );
    // 패널 밖에 있는 고정 버튼: 접혀 있을 때 언제든 다시 열 수 있음
    this.fab = h('button', { type: 'button', class: 'admin-fab hidden', 'aria-label': '운영자 메뉴 열기', onclick: () => this.setOpen(true) }, icon('menu'), h('span', {}, '운영자 메뉴'));
    this.el = h('div', { class: 'admin-root' }, this.panel, this.fab);

    const later = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.refresh(), 400);
    };
    for (const ev of ['join', 'leave', 'status', 'patch', 'reset', 'hs', 'egg'] as const) store.on(ev, later);
    for (const ev of ['note', 'noteUpdate', 'noteDelete', 'comment', 'commentDelete'] as const)
      store.on(ev, () => (this.section === 'board' || this.section === 'dash') && later());
    store.on('display', () => (this.section === 'photo' || this.section === 'dash') && this.render());
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (e.key === 'a' || e.key === 'A') this.setOpen(!this.open);
    });
    // 남은 시간처럼 계속 바뀌는 값
    this.liveTimer = window.setInterval(() => {
      for (const el of this.body.querySelectorAll<HTMLElement>('[data-hs-left]')) el.textContent = this.hsLeftText();
    }, 500);
    this.renderNav();
    this.refresh();
  }

  /** 열기/닫기 상태는 여기서만 바꿈 */
  setOpen(v: boolean) {
    this.open = v;
    this.panel.classList.toggle('closed', !v);
    this.fab.classList.toggle('hidden', v);
    this.el.parentElement?.classList.toggle('panel-collapsed', !v);
  }

  private go(id: SectionId) {
    this.section = id;
    this.renderNav();
    this.body.scrollTop = 0;
    this.refresh();
  }

  private renderNav() {
    const cur = SECTIONS.find((s) => s.id === this.section)!;
    this.titleEl.textContent = cur.label;
    this.nav.replaceChildren(
      ...SECTIONS.map((s) =>
        h(
          'button',
          {
            type: 'button',
            class: `admin-nav-btn ${s.id === this.section ? 'on' : ''} ${s.id === 'hs' && hsActive(this.store.hs.phase) ? 'live' : ''}`,
            'aria-current': s.id === this.section ? 'page' : 'false',
            onclick: () => this.go(s.id),
          },
          s.id === 'people' ? `${s.short} ${this.store.onlineCount}` : s.short,
        ),
      ),
    );
  }

  private async refresh() {
    const s = this.section;
    const tasks: Promise<void>[] = [];
    if (s === 'people' || s === 'dash')
      tasks.push(
        this.net.req('adminPlayers').then((r) => {
          if (Array.isArray(r)) this.players = r;
        }),
      );
    if (s === 'board' || s === 'dash')
      tasks.push(
        this.net.req('adminBoard').then((r) => {
          if (Array.isArray(r)) this.notes = r;
        }),
      );
    if (s === 'hs' || s === 'dash')
      tasks.push(
        this.net.req('adminHsInfo').then((r) => {
          if (r && 'state' in r) this.hsInfo = r;
        }),
      );
    if (s === 'hs' || s === 'awards' || s === 'prizes' || s === 'dash')
      tasks.push(
        this.net.req('adminPrizes').then((r) => {
          if (r && 'items' in r) this.prizes = r;
        }),
      );
    if (s === 'eggs' || s === 'dash')
      tasks.push(
        this.net.req('adminEggs').then((r) => {
          if (Array.isArray(r)) this.eggs = r;
        }),
      );
    await Promise.all(tasks);
    this.renderNav();
    this.render();
  }

  private say(text: string) {
    const t = h('p', { class: 'admin-toast' }, text);
    this.panel.append(t);
    setTimeout(() => t.remove(), 2500);
  }

  private async call(ev: string, payload?: unknown) {
    const r = (await (payload === undefined ? this.net.req(ev as never) : this.net.req(ev as never, payload))) as { ok: boolean; reason?: string };
    if (!r.ok) this.say(r.reason ?? '실패했어요.');
    return r.ok;
  }

  private render() {
    const views: Record<SectionId, () => HTMLElement> = {
      dash: () => this.dashView(),
      people: () => this.peopleView(),
      board: () => this.boardView(),
      notice: () => this.noticeView(),
      camera: () => this.cameraView(),
      photo: () => this.photoView(),
      hs: () => this.hsView(),
      awards: () => this.awardsView(),
      eggs: () => this.eggsView(),
      prizes: () => this.prizesView(),
      settings: () => this.settingsView(),
    };
    // 입력 중인 칸이 있으면 다시 그리지 않음 (입력이 지워지지 않게)
    const a = document.activeElement as HTMLElement | null;
    if (a && this.body.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && (a as HTMLInputElement).type !== 'checkbox') return;
    this.body.replaceChildren(views[this.section]());
  }

  // -------------------------------------------------------------- 대시보드

  private dashView() {
    const all = [...this.store.players.values()].map((e) => e.info).filter((p) => p.status === 'online');
    const st = this.store.hs;
    const baemin = this.prizes?.items[0];
    const found = this.eggs.filter((e) => e.winner).length;
    const card = (title: string, value: string, sub: string, go: SectionId) =>
      h('button', { type: 'button', class: 'dash-card', onclick: () => this.go(go) }, h('small', {}, title), h('strong', {}, value), h('span', {}, sub));
    return h(
      'div',
      { class: 'admin-dash' },
      h(
        'div',
        { class: 'dash-grid' },
        card('지금 접속', `${all.length}명`, `선배 ${all.filter((p) => p.role === 'senior').length} · 후배 ${all.filter((p) => p.role === 'junior').length}`, 'people'),
        card('학회장을 찾아라!', HS_PHASE_LABEL[st.phase], st.round ? `${st.round}회차${st.winner ? ` · ${st.winner.nickname}` : ''}` : '아직 시작 전', 'hs'),
        card('이스터에그', `${found} / ${this.eggs.length || 8}`, '최초 달성자가 나온 업적', 'eggs'),
        card(
          '배달의민족 상품권',
          baemin ? `${baemin.total}장` : '-',
          baemin ? `숨바꼭질 ${baemin.used.hideseek}/${baemin.alloc.hideseek} · 추첨 ${baemin.used.draw}/${baemin.alloc.draw}` : '',
          'prizes',
        ),
        card('게시판', `${this.notes.length}개`, '쪽지', 'board'),
        card('화면 표시', this.store.display.photo ? '단체 사진 중' : '평소', this.store.display.hideNames ? '닉네임 숨김' : '닉네임 표시', 'photo'),
      ),
      h('p', { class: 'muted small' }, '카드를 누르면 해당 메뉴로 이동해요. 패널은 오른쪽 위 ✕ 또는 A 키로 접고, ‘운영자 메뉴’ 버튼으로 다시 열 수 있어요.'),
    );
  }

  // -------------------------------------------------------------- 접속자

  private peopleView() {
    const rows = this.players
      .slice()
      .sort((a, b) => Number(b.host) - Number(a.host) || a.team - b.team || a.nickname.localeCompare(b.nickname, 'ko'))
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
        const isHost = p.host || this.hsInfo?.hostId === p.id;
        return h(
          'li',
          { class: p.status === 'away' ? 'away' : '' },
          t ? h('span', { class: 'mini-team', style: `--tc:${t.color}`, html: teamSvg(t.symbol, '#fff') }) : h('span', { class: 'mini-team none' }),
          h(
            'div',
            { class: 'who' },
            h('b', {}, p.nickname, isHost ? h('em', { class: 'host-tag' }, '학회장') : null),
            h('small', {}, `${gradeLabel(p.grade, p.gradeText)} · ${roleLabel(p.role)}${p.status === 'away' ? ' · 연결 끊김' : ''}`),
          ),
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
          h('button', { type: 'button', class: 'mini-btn', onclick: () => this.hud.track(p.id) }, '추적'),
        );
      });
    return h('div', {}, h('ul', { class: 'admin-list' }, ...(rows.length ? rows : [h('li', { class: 'empty' }, '아직 접속한 사람이 없어요')])));
  }

  // -------------------------------------------------------------- 게시판

  private boardView() {
    return h(
      'div',
      {},
      h('button', { type: 'button', class: 'btn-secondary', onclick: () => this.download('/api/admin/export.csv', 'board') }, '게시판 기록 CSV 내려받기'),
      h(
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
      ),
    );
  }

  // -------------------------------------------------------------- 공지 · 카메라 · 단체 사진

  private noticeView() {
    const notice = h('input', { type: 'text', maxlength: 80, placeholder: '모두에게 보낼 공지 (예: 5분 뒤 단체 사진!)' });
    return h(
      'div',
      { class: 'admin-screen' },
      h(
        'form',
        {
          class: 'row',
          onsubmit: async (e) => {
            e.preventDefault();
            if (await this.call('adminNotice', { text: notice.value })) {
              notice.value = '';
              notice.blur();
              this.say('공지를 보냈어요.');
            }
          },
        },
        notice,
        h('button', { type: 'submit', class: 'btn-primary small' }, '보내기'),
      ),
      h('p', { class: 'muted small' }, '모든 참가자 화면 위쪽과 관전 화면에 8초 동안 표시돼요.'),
    );
  }

  private cameraView() {
    const b = (label: string, fn: () => void) => h('button', { type: 'button', class: 'btn-secondary', onclick: fn }, label);
    return h(
      'div',
      { class: 'admin-screen' },
      b('전체 보기 (1)', () => this.hud.cam('all')),
      b('모두 따라가기 (2)', () => this.hud.cam('follow')),
      b('자유 카메라 (3) · 끌어서 이동, 휠로 확대', () => this.hud.cam('free')),
      b('참가자 추적 목록 열기 (L)', () => this.hud.toggleList()),
      h('p', { class: 'muted small' }, '특정 참가자는 ‘접속자 관리’의 추적 버튼으로도 따라갈 수 있어요. 숨바꼭질 수색 중에는 관전 화면에 숨은 학회장이 보이지 않아요.'),
    );
  }

  private photoView() {
    const d = this.store.display;
    const toggle = (k: keyof DisplaySettings, label: string) => {
      const cb = h('input', { type: 'checkbox', onchange: () => this.call('adminDisplay', { [k]: cb.checked }) });
      cb.checked = d[k];
      return h('label', { class: 'toggle' }, cb, h('span', {}, label));
    };
    return h(
      'div',
      { class: 'admin-screen' },
      h(
        'button',
        { type: 'button', class: `btn-primary photo-btn ${d.photo ? 'on' : ''}`, onclick: () => this.call('adminDisplay', { photo: !d.photo }) },
        d.photo ? '단체 사진 모드 끝내기' : '단체 사진 모드 시작',
      ),
      h('p', { class: 'muted small' }, '모든 화면에서 이름표·칭호·말풍선을 숨기고, 관전 화면은 참가자가 모두 보이게 맞춰요. 끝내면 원래대로 돌아와요.'),
      h('h3', {}, '모든 참가자 화면 표시'),
      toggle('hideNames', '닉네임 숨기기'),
      toggle('hideTeams', '팀 컬러·심볼 숨기기'),
      toggle('hideBubbles', '말풍선 숨기기'),
      hsActive(this.store.hs.phase) ? h('p', { class: 'muted small' }, '지금은 숨바꼭질 중이라 닉네임·팀 표시가 자동으로 숨겨져 있어요. 끝나면 이 설정으로 돌아와요.') : null,
    );
  }

  // -------------------------------------------------------------- 학회장을 찾아라!

  private hsLeftText() {
    const st = this.store.hs;
    if (!hsActive(st.phase)) return '-';
    const ms = st.paused ? st.leftMs : Math.max(0, st.endsAt - this.store.serverNow());
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${st.paused ? ' (일시정지)' : ''}`;
  }

  private hsView() {
    const st = this.store.hs;
    const info = this.hsInfo;
    const active = hsActive(st.phase);
    const hosts = info?.hosts ?? [];
    if (this.hostChoice === null || !hosts.some((x) => x.id === this.hostChoice)) this.hostChoice = hosts[0]?.id ?? null;
    const hostSel = h(
      'select',
      { onchange: () => (this.hostChoice = Number(hostSel.value)) },
      ...hosts.map((x) => h('option', { value: String(x.id) }, `${x.nickname}${x.online ? '' : ' (연결 끊김)'}`)),
    );
    if (this.hostChoice !== null) hostSel.value = String(this.hostChoice);
    const sec = h('input', { type: 'number', min: HS.minSearchSec, max: HS.maxSearchSec, step: 10, value: String(this.searchSec), onchange: () => (this.searchSec = Number(sec.value)) });
    const hostName = active && info?.hostId != null ? this.store.players.get(info.hostId)?.info.nickname ?? `#${info.hostId}` : null;
    const cmd = async (c: 'start' | 'end' | 'cancel' | 'reset') => {
      if (c === 'cancel' && !confirm('진행 중인 숨바꼭질을 강제 종료할까요? 우승자 없이 끝나요.')) return;
      if (await this.call('adminHs', { cmd: c, searchSec: Number(sec.value), hostId: this.hostChoice ?? undefined })) {
        this.say(c === 'start' ? '숨바꼭질을 시작했어요!' : c === 'reset' ? '준비 상태로 돌렸어요.' : '종료했어요.');
        this.refresh();
      }
    };
    const rounds = (this.prizes?.rounds ?? []).slice(-6).reverse();
    return h(
      'div',
      { class: 'admin-screen admin-hs' },
      h(
        'div',
        { class: `hs-state-card phase-${st.phase}` },
        h('div', {}, h('small', {}, '현재 상태'), h('strong', {}, HS_PHASE_LABEL[st.phase]), st.round ? h('span', {}, `${st.round}회차`) : null),
        h('div', {}, h('small', {}, '남은 시간'), h('strong', { 'data-hs-left': '1' }, this.hsLeftText())),
        hostName ? h('div', {}, h('small', {}, '학회장'), h('strong', {}, hostName)) : null,
        st.winner ? h('div', {}, h('small', {}, '최초 발견자'), h('strong', {}, st.winner.nickname), h('span', {}, st.winner.prize ? '상품권 배정' : '상품권 할당 소진')) : null,
      ),
      active
        ? h(
            'div',
            { class: 'row wrap' },
            st.phase === 'found' || st.phase === 'timeout'
              ? h('button', { type: 'button', class: 'btn-primary', onclick: () => cmd('end') }, '결과 연출 끝내기')
              : h('button', { type: 'button', class: 'btn-danger', onclick: () => cmd('cancel') }, '강제 종료'),
          )
        : h(
            'div',
            { class: 'hs-start' },
            hosts.length
              ? h('label', { class: 'field' }, h('span', {}, '숨을 학회장'), hostSel)
              : h(
                  'p',
                  { class: 'warn' },
                  '학회장 아바타가 없어요. 휴대폰·PC의 참가자 화면(아지트 주소)에서 입장한 뒤, 메뉴 → 내 캐릭터 → ‘학회장 로그인’을 해주세요.',
                ),
            h('label', { class: 'field' }, h('span', {}, `수색 시간(초, ${HS.minSearchSec}~${HS.maxSearchSec})`), sec),
            h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn-primary', disabled: !hosts.length, onclick: () => cmd('start') }, '숨바꼭질 시작'), st.phase !== 'ready' ? h('button', { type: 'button', class: 'btn-secondary', onclick: () => cmd('reset') }, '준비 상태로') : null),
          ),
      h(
        'ol',
        { class: 'muted small host-guide' },
        h('li', {}, '시작하면 모든 참가자·관전 화면이 15초 동안 가려지고, 학회장 위치는 서버가 아무에게도 보내지 않아요.'),
        h('li', {}, '15초 뒤 학회장 위치가 확정되고, 참가자는 중앙 광장에서 다시 출발해요.'),
        h('li', {}, '학회장 옆에서 가장 먼저 ‘찾았다!!’를 누른 1명이 우승 → 배달의민족 상품권 1장이 기록돼요.'),
        h('li', {}, '이미 상품권이 배정된 뒤에 다시 하면, 우승은 기록되지만 상품권은 중복 배정되지 않아요.'),
      ),
      h('h3', {}, '최근 회차'),
      rounds.length
        ? h(
            'ul',
            { class: 'admin-list compact' },
            ...rounds.map((r) =>
              h(
                'li',
                {},
                h('b', {}, `${r.round}회차`),
                h('span', { class: 'grow' }, r.result === 'found' ? `발견: ${r.winner}${r.prize ? ' · 상품권' : ''}` : r.result === 'timeout' ? '시간 종료 (우승자 없음)' : '강제 종료'),
                h('small', {}, time(r.endedAt)),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, '아직 진행한 회차가 없어요.'),
    );
  }

  // -------------------------------------------------------------- 당첨 · 지급 기록

  private awardsView() {
    const list = (this.prizes?.awards ?? []).slice().reverse();
    return h(
      'div',
      { class: 'admin-screen' },
      h('button', { type: 'button', class: 'btn-secondary', onclick: () => this.download('/api/admin/prizes.csv', 'prizes') }, '당첨 기록 CSV 내려받기'),
      list.length
        ? h(
            'ul',
            { class: 'admin-awards' },
            ...list.map((a) =>
              h(
                'li',
                { class: a.paid ? 'paid' : '' },
                h('div', { class: 'aw-head' }, h('b', {}, a.nickname), h('em', {}, a.paid ? '지급 완료' : '미지급')),
                h('p', {}, `${a.eventName} ${a.round}회차 · ${a.itemName} ${a.qty}장`),
                h('small', {}, `당첨 ${time(a.at)} · 참가자 #${a.playerId}${a.paidAt ? ` · 지급 ${time(a.paidAt)}` : ''}`),
                h(
                  'div',
                  { class: 'row wrap' },
                  h(
                    'button',
                    {
                      type: 'button',
                      class: `mini-btn ${a.paid ? '' : 'on'}`,
                      onclick: async () => {
                        if (await this.call('adminPrizeSet', { op: 'paid', awardId: a.id, paid: !a.paid })) this.refresh();
                      },
                    },
                    a.paid ? '지급 취소' : '지급 완료로 표시',
                  ),
                  a.paid
                    ? null
                    : h(
                        'button',
                        {
                          type: 'button',
                          class: 'mini-btn danger',
                          onclick: async () => {
                            if (!confirm(`${a.nickname} 님의 당첨(${a.itemName} 1장)을 취소할까요?\n취소하면 이 이벤트의 상품권 할당이 다시 1장 남아요.`)) return;
                            if (await this.call('adminPrizeSet', { op: 'revoke', awardId: a.id })) this.refresh();
                          },
                        },
                        '당첨 취소',
                      ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, '아직 당첨 기록이 없어요. 숨바꼭질 최초 발견자가 나오면 자동으로 기록돼요.'),
      h('p', { class: 'muted small' }, '실제 상품권은 행사장에서 직접 전달하고, 전달한 뒤 ‘지급 완료로 표시’를 눌러주세요.'),
    );
  }

  // -------------------------------------------------------------- 이스터에그

  private eggsView() {
    return h(
      'div',
      { class: 'admin-screen' },
      h('button', { type: 'button', class: 'btn-secondary', onclick: () => this.download('/api/admin/eggs.csv', 'eggs') }, '획득 기록 CSV 내려받기'),
      h(
        'ul',
        { class: 'admin-eggs' },
        ...this.eggs.map((e) => {
          const need = h('input', { type: 'number', min: 1, max: 3600, value: String(e.need), disabled: e.kind === 'once' || e.kind === 'zones' });
          const unit = e.kind === 'time' ? '초' : e.kind === 'count' ? '회' : e.kind === 'zones' ? '곳' : '';
          const set = async (o: Record<string, unknown>) => {
            if (await this.call('adminEggSet', { id: e.id, ...o })) this.refresh();
          };
          return h(
            'li',
            { class: e.enabled ? '' : 'off' },
            h('div', { class: 'egg-head' }, h('b', {}, e.title), e.winner ? h('em', { class: 'won' }, '달성자 있음') : h('em', {}, '미발견')),
            h('p', { class: 'muted small' }, e.rule),
            h(
              'div',
              { class: 'row wrap' },
              e.kind === 'time' || e.kind === 'count'
                ? h(
                    'form',
                    {
                      class: 'row',
                      onsubmit: (ev) => {
                        ev.preventDefault();
                        need.blur();
                        void set({ need: Number(need.value) });
                      },
                    },
                    h('label', { class: 'need' }, '조건 ', need, ` ${unit}`),
                    h('button', { type: 'submit', class: 'mini-btn' }, '저장'),
                  )
                : h('span', { class: 'muted small' }, e.kind === 'zones' ? '주요 공간 7곳' : '한 번 상호작용'),
              h('button', { type: 'button', class: `mini-btn ${e.enabled ? 'on' : ''}`, onclick: () => set({ enabled: !e.enabled }) }, e.enabled ? '사용 중' : '중지됨'),
              h('button', { type: 'button', class: 'mini-btn', onclick: () => set({ broadcast: !e.broadcast }) }, e.broadcast ? '전체 알림' : '개인 알림'),
            ),
            e.winner
              ? h(
                  'div',
                  { class: 'egg-winner' },
                  h('span', {}, `최초 달성자: ${e.winner.nickname} · ${time(e.winner.at)}`),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'mini-btn danger',
                      onclick: () => {
                        if (confirm(`‘${e.title}’ 기록만 초기화할까요?\n${e.winner!.nickname} 님의 칭호도 회수되고, 다른 이스터에그 기록은 그대로 남아요.`)) void set({ reset: true });
                      },
                    },
                    '이 기록 초기화',
                  ),
                )
              : null,
          );
        }),
      ),
      h('p', { class: 'muted small' }, '조건은 참가자에게 공개되지 않아요. 학회장 계정은 최초 달성 경쟁에서 제외돼요.'),
    );
  }

  // -------------------------------------------------------------- 상품

  private prizesView() {
    const items = this.prizes?.items ?? [];
    return h(
      'div',
      { class: 'admin-screen' },
      ...items.map((it) => {
        const total = h('input', { type: 'number', min: 0, max: 99, value: String(it.total) });
        const pools = Object.keys(it.alloc) as PrizePool[];
        const inputs = pools.map((p) => [p, h('input', { type: 'number', min: 0, max: 99, value: String(it.alloc[p]) })] as const);
        return h(
          'form',
          {
            class: 'prize-card',
            onsubmit: async (e) => {
              e.preventDefault();
              (document.activeElement as HTMLElement | null)?.blur();
              if (!confirm('상품 수량·할당을 바꿀까요?')) return;
              const alloc: Partial<Record<PrizePool, number>> = {};
              for (const [p, i] of inputs) alloc[p] = Number(i.value);
              if (await this.call('adminPrizeSet', { op: 'alloc', itemId: it.id, total: Number(total.value), alloc })) {
                this.say('저장했어요.');
                this.refresh();
              }
            },
          },
          h('h3', {}, it.name),
          h('label', { class: 'field' }, h('span', {}, '전체 보유 수량'), total),
          ...inputs.map(([p, i]) => h('label', { class: 'field' }, h('span', {}, `${POOL_LABEL[p]} 할당 · 배정 ${it.used[p]}장`), i)),
          h('p', { class: 'muted small' }, `남은 수량: 숨바꼭질 ${it.alloc.hideseek - it.used.hideseek}장 · 랜덤 추첨 ${it.alloc.draw - it.used.draw}장 · 미할당 ${it.total - pools.reduce((n, p) => n + it.alloc[p], 0)}장`),
          h('button', { type: 'submit', class: 'btn-secondary' }, '수량·할당 저장'),
        );
      }),
      h('p', { class: 'muted small' }, '상품권 4장 = 숨바꼭질 최초 발견자 1장 + 3차 랜덤 추첨 3장. 할당은 여기서 직접 바꾼 경우에만 달라지고, 이미 배정된 수량보다 적게 줄일 수는 없어요.'),
    );
  }

  // -------------------------------------------------------------- 설정

  private settingsView() {
    const inputs = TEAMS.map((t) => {
      const i = h('input', { type: 'text', maxlength: 8, value: this.store.teamNames[t.id] ?? t.defaultName });
      return h('label', { class: 'team-name-row', style: `--tc:${t.color}` }, h('i', { html: teamSvg(t.symbol, '#fff') }), i);
    });
    return h(
      'div',
      { class: 'admin-screen' },
      h('h3', {}, '팀 이름'),
      h(
        'form',
        {
          class: 'admin-teams',
          onsubmit: async (e) => {
            e.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
            const names = inputs.map((l) => (l.querySelector('input') as HTMLInputElement).value);
            if (await this.call('adminTeamNames', { names })) this.say('팀 이름을 저장했어요.');
          },
        },
        ...inputs,
        h('button', { type: 'submit', class: 'btn-primary small' }, '저장'),
        h('p', { class: 'muted small' }, '팀 이름은 입장 화면과 참가자 메뉴에 바로 반영돼요.'),
      ),
      h('h3', {}, '계정'),
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

  private async download(url: string, name: string) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!r.ok) return this.say('로그인이 만료됐어요. 다시 로그인해주세요.');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jjak-azit-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  destroy() {
    clearInterval(this.liveTimer);
    this.el.remove();
  }
}

function time(ms: number) {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
