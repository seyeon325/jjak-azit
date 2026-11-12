/** 참가자 게임 화면 UI: 상단 바, 구역 안내, 입·퇴장 알림, 연결 상태, 메뉴 */
import { foodDef, gradeLabel } from '../../../shared/foods';
import { WORLD, type Zone } from '../../../shared/map';
import type { FoodId, PlayerInfo } from '../../../shared/protocol';
import { LOOKS } from '../game/art/characters';
import type { InteractState } from '../game/scenes/WorldScene';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { ActionBar } from './ActionBar';
import { openBoard } from './BoardPanel';
import { CharacterPreview } from './CharacterPreview';
import { h, icon, ICON, logoMark, roleLabel } from './dom';
import { openFoodMenu } from './FoodMenu';
import { ChatBar } from './ChatBar';
import { openEmoteMenu, openPlayerMenu, showRequest } from './SocialMenu';
import type { WorldOverlay } from './WorldOverlay';
import { Storage } from '../net/Network';
import { CAMPFIRE_R } from '../../../shared/constants';
import { WORLD as MAP } from '../../../shared/map';
import { TEAMS, teamSvg, type InteractionId } from '../../../shared/social';
import { teamName } from '../state/WorldStore';
import { Sheet } from './Sheet';
import { EGG_BY_ID, HS, HS_PHASE_LABEL, type EggEvent, type MyTitles } from '../../../shared/events';
import { sfx, sound } from '../audio/Sound';
import { soundControls } from '../audio/SoundPanel';
import { saveAdminToken } from './AdminPanel';

/** 받침에 따라 을/를 */
function objectParticle(word: string) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return '을(를)';
  return c % 28 ? '을' : '를';
}

export type ConnState = 'ok' | 'lost' | 'restoring' | 'restored' | 'error';

const PHASE_TEXT: Record<number, string> = { 2: '2차 업데이트 예정', 3: '3차 업데이트 예정' };

export class Hud {
  readonly el: HTMLElement;
  private count: HTMLElement;
  private zoneChip: HTMLElement;
  private zoneCard: HTMLElement;
  private toasts: HTMLElement;
  private conn: HTMLElement;
  private menu: HTMLElement | null = null;
  private zoneTimer = 0;
  private connTimer = 0;
  private unsubs: (() => void)[] = [];
  private seenZones = new Set<string>();

  private actionBar: ActionBar;
  private panel: Sheet | null = null;
  /** 열려 있는 게시판 (멀어지면 자동으로 닫음) */
  private boardSheet: Sheet | null = null;
  readonly chat: ChatBar;
  private fireCard: HTMLElement;
  private statusChip: HTMLElement;
  private noticeEl: HTMLElement;
  private last: InteractState | null = null;
  private statusKey = '-';
  private wasInFire = false;
  private prefs = Storage.prefs;

  constructor(
    private store: WorldStore,
    private net: Network,
    private overlay: WorldOverlay,
    private actions: { onRecreate: () => void },
  ) {
    this.count = h('span', { class: 'count-num' }, String(store.onlineCount));
    this.zoneChip = h('div', { class: 'zone-chip hidden' });
    this.zoneCard = h('div', { class: 'zone-card hidden', onclick: () => this.zoneCard.classList.add('hidden') });
    this.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.conn = h('div', { class: 'conn hidden', role: 'status' });
    this.actionBar = new ActionBar({
      onMenu: () => this.openFood(),
      onEat: () => this.act({ t: 'eat' }),
      onBath: (on) => this.act({ t: 'bath', on }),
      onBoard: () => this.openBoardPanel(),
      onSit: (seat) => this.act({ t: 'sit', seat }),
      onStand: () => this.act({ t: 'stand' }),
      onSlide: () => this.act({ t: 'slide' }),
      onPush: (seat) => this.act({ t: 'push', seat }),
      onPlayer: (id) => this.openPlayer(id),
      onFireChat: () => this.chat.open('fire'),
      onUnfollow: () => this.net.socket.emit('unfollow'),
      onFull: () => (sfx('table.full'), this.toast('이 테이블은 4자리가 모두 찼어요. 다른 테이블을 이용해주세요.', 'info')),
      onFind: async () => {
        const r = await this.net.req('hsFind');
        if (!r.ok) this.toast(r.reason, 'info');
      },
      onSecret: () => this.act({ t: 'secret' }),
    });
    this.chat = new ChatBar(store, net, (open) => {
      document.body.classList.toggle('typing', open);
      this.actionBar.suspend(open || !!this.panel?.isOpen);
    });
    this.fireCard = h('div', { class: 'fire-card hidden' });
    this.statusChip = h('div', { class: 'status-chip hidden' });
    this.noticeEl = h('div', { class: 'notice hidden', role: 'alert' });

    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.hostBtn = h(
      'button',
      { class: 'icon-btn quick host hidden', type: 'button', 'aria-label': '학회장 메뉴', onclick: () => this.openHostSheet() },
      h('span', { class: 'qi' }, '★'),
      h('small', {}, '학회장'),
    );

    this.el = h(
      'div',
      { class: 'hud' },
      h(
        'div',
        { class: 'topbar' },
        h('div', { class: 'top-left' }, h('div', { class: 'brand-chip' }, logoMark(), h('span', {}, '짝선짝후 아지트')), this.zoneChip),
        h(
          'div',
          { class: 'top-right' },
          h(
            'button',
            { class: 'pill count-pill', type: 'button', 'aria-label': '접속 인원 보기', onclick: () => this.openMenu('people') },
            icon('people'),
            this.count,
            h('span', { class: 'count-unit' }, '명'),
          ),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': '메뉴', onclick: () => this.openMenu('guide') }, icon('menu')),
        ),
      ),
      h(
        'div',
        { class: 'quickbar' },
        h('button', { class: 'icon-btn quick chat', type: 'button', 'aria-label': '채팅', onclick: () => this.chat.open() }, h('span', { class: 'qi' }, '말'), h('small', {}, '채팅')),
        h('button', { class: 'icon-btn quick emo', type: 'button', 'aria-label': '표정·동작', onclick: () => this.openEmotes() }, h('span', { class: 'qi' }, '^^'), h('small', {}, '표정')),
        this.hostBtn,
      ),
      this.chat.mini,
      this.fireCard,
      this.statusChip,
      this.noticeEl,
      this.conn,
      this.zoneCard,
      this.toasts,
      this.actionBar.el,
      this.chat.el,
      !isTouch ? h('div', { class: 'key-hint' }, h('kbd', {}, 'W A S D'), ' 또는 ', h('kbd', {}, '방향키'), '로 이동') : null,
    );

    this.unsubs.push(
      store.on('count', (n) => {
        this.count.textContent = String(n);
        if (this.menuTab !== 'me') this.refreshMenu(); // 내 캐릭터 탭은 입력 중일 수 있어 그대로 둠
      }),
      store.on('join', (p) => {
        if (p.id !== store.selfId) this.toast(`${p.nickname} ${roleLabel(p.role)}님이 아지트에 왔어요`, 'join');
      }),
      store.on('leave', (p, reason) =>
        this.toast(
          reason === 'timeout' ? `${p.nickname} 님의 연결이 끊겨 퇴장했어요` : `${p.nickname} 님이 아지트를 떠났어요`,
          'leave',
        ),
      ),
      store.on('status', () => this.menuTab !== 'me' && this.refreshMenu()),
      store.on('patch', (p) => {
        if (p.id === store.selfId) this.refreshMenu();
      }),
      store.on('note', (n) => {
        if (n.nickname !== store.self?.nickname) this.toast(`${n.nickname} 님이 게시판에 쪽지를 남겼어요`, 'info');
      }),
      store.on('chat', (m) => this.overlay.bubble(m.from, m.text, 4200, `ch-${m.ch}`)),
      store.on('req', (r) =>
        showRequest(this.el, r, (accept) => this.net.socket.emit('respond', { reqId: r.reqId, accept })),
      ),
      store.on('info', (t) => this.toast(t, 'info')),
      store.on('notice', (t) => this.showNotice(t)),
      store.on('muted', (m) => this.toast(m ? '학회장이 채팅을 잠시 제한했어요.' : '채팅 제한이 풀렸어요.', 'info')),
      store.on('fireQ', (q) => this.renderFire(q)),
      store.on('display', () => this.applyDisplay()),
      store.on('reset', () => {
        this.applyDisplay();
        if (this.prefs.noPrank) this.net.socket.emit('setPref', { noPrank: true });
      }),
      store.on('egg', (ev) => this.onEgg(ev)),
      store.on('hs', (st, prev) => {
        this.renderHostSheet();
        // 숨바꼭질이 시작되면 열린 메뉴·시트를 닫아 화면을 비움
        if (st.phase === 'hiding' && prev.phase !== 'hiding') {
          this.panel?.close();
          this.closeMenu();
          this.chat.close();
        }
      }),
    );
  }

  /** 레이드 장면 중에는 아지트 버튼·단축키를 잠시 멈춤 */
  setRaidMode(on: boolean) {
    this.actionBar.suspend(on);
    if (on) {
      this.panel?.close();
      this.closeMenu();
      this.chat.close();
    }
  }

  /** 학회장(관리자 인증) 계정이 되면 학회장 버튼 표시 */
  setHostAccount(v: boolean) {
    this.store.hostAccount = v;
    this.hostBtn.classList.toggle('hidden', !v);
    this.refreshMenu();
  }

  // -------------------------------------------------------------- 이스터에그

  private onEgg(ev: EggEvent) {
    if (ev.winnerId === this.store.selfId) {
      const pop = h(
        'div',
        { class: 'egg-pop', style: `--ec:${EGG_BY_ID.get(ev.id)?.color ?? '#ffd84d'}` },
        h('i', { class: 'egg-spark a' }),
        h('i', { class: 'egg-spark b' }),
        h('i', { class: 'egg-spark c' }),
        h('small', {}, '숨겨진 업적 발견!'),
        h('strong', {}, ev.title),
        h('span', {}, '최초 달성자가 되었습니다!'),
      );
      this.el.append(pop);
      sfx('egg.found');
      setTimeout(() => pop.classList.add('out'), 2800);
      setTimeout(() => pop.remove(), 3300);
      this.refreshMenu();
    } else this.toast(`${ev.nickname} 님이 숨겨진 업적 ‘${ev.title}’의 최초 달성자가 됐어요!`, 'info');
  }

  // -------------------------------------------------------------- 학회장 메뉴 (숨바꼭질 진행)

  private hostBtn: HTMLElement;
  private hostSheet: Sheet | null = null;
  private searchSec = HS.searchMs / 1000;

  private openHostSheet() {
    if (this.hostSheet?.isOpen) return;
    this.actionBar.suspend(true);
    this.hostSheet = new Sheet(this.el, '학회장 메뉴', () => {
      this.actionBar.suspend(false);
      this.hostSheet = null;
    });
    this.renderHostSheet();
  }

  private renderHostSheet() {
    const sh = this.hostSheet;
    if (!sh?.isOpen) return;
    const st = this.store.hs;
    const active = this.store.hsActive;
    const sel = h(
      'select',
      { onchange: () => (this.searchSec = Number(sel.value)) },
      ...[60, 90, 120, 180, 240, 300].map((s) => h('option', { value: String(s) }, `${s / 60 >= 1 && s % 60 === 0 ? `${s / 60}분` : `${s}초`}`)),
    );
    sel.value = String(this.searchSec);
    const run = async (cmd: 'start' | 'end') => {
      if (cmd === 'end' && !confirm('진행 중인 숨바꼭질을 종료할까요?')) return;
      const r = await this.net.req('adminHs', { cmd, searchSec: this.searchSec });
      if (!r.ok) this.toast(r.reason, 'info');
      else if (cmd === 'start') sh.close();
    };
    sh.body.replaceChildren(
      h(
        'div',
        { class: 'host-sheet' },
        h('h3', {}, '학회장을 찾아라!'),
        h('p', { class: 'host-state' }, h('b', {}, HS_PHASE_LABEL[st.phase]), st.round ? ` · ${st.round}회차` : '', st.winner && !active ? ` · 지난 우승: ${st.winner.nickname}` : ''),
        active
          ? h('button', { type: 'button', class: 'btn-danger', onclick: () => run('end') }, st.phase === 'found' || st.phase === 'timeout' ? '결과 연출 끝내기' : '숨바꼭질 강제 종료')
          : h(
              'div',
              { class: 'host-start' },
              h('label', {}, '수색 시간 ', sel),
              h('button', { type: 'button', class: 'btn-primary', onclick: () => run('start') }, '숨바꼭질 시작'),
            ),
        h(
          'ol',
          { class: 'host-guide muted small' },
          h('li', {}, '시작하면 다른 모든 화면이 15초 동안 가려지고, 내 위치는 서버가 아무에게도 보내지 않아요.'),
          h('li', {}, '15초 안에 숨을 곳으로 이동하세요. 그 자리가 숨은 위치로 확정되고 움직일 수 없어요.'),
          h('li', {}, '참가자는 중앙 광장에서 출발해요. 가장 먼저 옆에서 ‘찾았다!!’를 누른 한 명이 우승해요.'),
          h('li', {}, '당첨·상품 지급 기록은 학회장 페이지(/admin)에서 확인할 수 있어요.'),
        ),
      ),
    );
  }

  // -------------------------------------------------------------- 학회장 로그인

  private hostLoginView() {
    if (this.store.hostAccount)
      return h('p', { class: 'muted small host-on' }, '★ 학회장으로 로그인되어 있어요. 화면 오른쪽 ‘★ 학회장’ 버튼으로 숨바꼭질을 진행해요.');
    const pw = h('input', { type: 'password', placeholder: '학회장 비밀번호', autocomplete: 'current-password' });
    const msg = h('p', { class: 'muted small' });
    return h(
      'details',
      { class: 'host-login' },
      h('summary', {}, '학회장 로그인 (운영진 전용)'),
      h(
        'form',
        {
          class: 'row',
          onsubmit: async (e) => {
            e.preventDefault();
            msg.textContent = '';
            try {
              const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
              const j = (await r.json()) as { ok: boolean; token?: string; expiresAt?: number; reason?: string };
              if (!j.ok || !j.token) throw new Error(j.reason ?? '로그인에 실패했어요.');
              saveAdminToken(j.token, j.expiresAt ?? Date.now() + 3600_000);
              const a = await this.net.req('adminAuth', { token: j.token });
              if (!a.ok) throw new Error(a.reason);
              this.setHostAccount(true);
              this.toast('학회장으로 로그인했어요.', 'info');
            } catch (err) {
              msg.textContent = (err as Error).message;
            }
          },
        },
        pw,
        h('button', { type: 'submit', class: 'btn-primary small' }, '로그인'),
      ),
      msg,
    );
  }

  // -------------------------------------------------------------- 칭호

  private titlesView() {
    const box = h('div', { class: 'titles' }, h('h3', {}, '내 칭호'), h('p', { class: 'muted small' }, '불러오는 중…'));
    void this.net.req('myTitles').then((r) => {
      const t = r as MyTitles;
      if (!('owned' in t)) return;
      const list = t.owned.length
        ? h(
            'div',
            { class: 'title-list' },
            ...t.owned.map((o) =>
              h(
                'button',
                {
                  type: 'button',
                  class: `title-chip ${t.equipped === o.id ? 'on' : ''}`,
                  style: `--ec:${EGG_BY_ID.get(o.id)?.color ?? '#ffd84d'}`,
                  onclick: async () => {
                    const next = t.equipped === o.id ? null : o.id;
                    const res = await this.net.req('setTitle', { id: next });
                    if (!res.ok) return this.toast(res.reason, 'info');
                    box.replaceWith(this.titlesView());
                  },
                },
                o.title,
                h('small', {}, t.equipped === o.id ? '장착 중 · 눌러서 해제' : '눌러서 장착'),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, '아직 칭호가 없어요. 아지트 곳곳에 숨겨진 업적을 가장 먼저 달성하면 특별한 칭호를 받아요!');
      box.replaceChildren(h('h3', {}, '내 칭호'), list);
    });
    return box;
  }

  // -------------------------------------------------------------- 구역 안내

  setZone(z: Zone | null) {
    clearTimeout(this.zoneTimer);
    if (!z) {
      this.zoneChip.classList.add('hidden');
      this.zoneCard.classList.add('hidden');
      return;
    }
    this.zoneChip.replaceChildren(icon('pin'), h('span', {}, z.name));
    this.zoneChip.classList.remove('hidden');
    if (this.store.hsActive) return; // 숨바꼭질 중에는 큰 구역 안내 카드를 띄우지 않음 (안내 배너와 겹침)
    this.zoneCard.replaceChildren(
      h('div', { class: 'zone-card-title' }, h('strong', {}, z.name), z.phase > 1 ? h('em', { class: `badge phase-${z.phase}` }, PHASE_TEXT[z.phase]) : null),
      h('p', {}, z.desc),
    );
    this.zoneCard.className = `zone-card phase-${z.phase}`;
    // 같은 구역 안내는 처음엔 길게, 다시 들어오면 짧게
    const first = !this.seenZones.has(z.id);
    this.seenZones.add(z.id);
    this.zoneTimer = window.setTimeout(() => this.zoneCard.classList.add('hidden'), first ? 4200 : 2400);
  }

  // -------------------------------------------------------------- 상호작용

  setInteract(s: InteractState) {
    this.last = s;
    this.checkBoardRange();
    this.actionBar.update(s);
    // 채팅 채널
    const partner = this.benchPartner();
    const table = this.tableCount();
    this.chat.setState({ fire: s.inFire, fireCount: this.fireCount(), bench: partner, table });
    // 모닥불 카드
    if (s.inFire && !this.wasInFire) {
      this.net.req('fireQuestion', { next: false }).then((r) => 'question' in r && this.renderFire(r.question));
      this.toast('모닥불 대화에 참여했어요. 채팅이 모닥불 주변 사람에게만 전달돼요.', 'info');
    }
    if (!s.inFire) this.fireCard.classList.add('hidden');
    this.wasInFire = s.inFire;
    // 상태 칩 (벤치 대화 / 따라가기)
    const me = this.store.self;
    const followers = [...this.store.players.values()].filter((e) => e.info.followId === this.store.selfId).map((e) => e.info.nickname);
    // 글자가 바뀔 때만 다시 그림 (매번 새로 만들면 휴대폰에서 '그만' 버튼 터치가 씹힘)
    let text: string | null = null;
    let stop = false;
    if (s.seated?.kind === 'bench') text = partner ? `${partner} 님과 벤치 대화 중 (둘만 보여요)` : '벤치에 앉았어요 · 옆자리를 기다리는 중';
    else if (s.seated?.kind === 'table') text = (table ?? 1) >= 2 ? `테이블 대화 중 ${table}/4 · 같은 테이블만 보여요` : '테이블에 앉았어요 · 1/4 · 다른 사람을 기다리는 중';
    else if (me?.followId != null) {
      text = `${this.store.players.get(me.followId)?.info.nickname ?? ''} 님을 따라가는 중`;
      stop = true;
    } else if (followers.length) {
      text = `${followers.join(', ')} 님이 따라오는 중`;
      stop = true;
    }
    const chipKey = text === null ? '' : `${text}|${stop}`;
    if (chipKey !== this.statusKey) {
      this.statusKey = chipKey;
      this.statusChip.classList.toggle('hidden', text === null);
      if (text !== null)
        this.statusChip.replaceChildren(h('span', {}, text), stop ? h('button', { type: 'button', onclick: () => this.net.socket.emit('unfollow') }, '그만') : '');
    }
  }

  private fireCount() {
    const c = MAP.spots.campfire;
    let n = 0;
    for (const e of this.store.players.values()) if (e.info.status === 'online' && Math.hypot(e.info.x - c.x, e.info.y - c.y) <= CAMPFIRE_R) n++;
    return n;
  }

  private checkBoardRange() {
    if (!this.boardSheet || !this.last || !this.boardFar(this.last)) return;
    this.boardSheet.close();
    this.boardSheet = null;
    this.toast('게시판에서 멀어져서 게시판을 닫았어요.', 'info');
  }

  /** 게시판에서 확실히 멀어졌는지 (경계에서 깜빡이지 않도록 14px 여유) */
  private boardFar(s: InteractState) {
    if (s.frozen || s.bath) return true;
    const me = this.store.self;
    const b = MAP.spots.board;
    return !me || Math.hypot(me.x - b.x, me.y - b.y) > b.r + 14;
  }

  /** 테이블에 앉아 있으면 같은 테이블 인원(나 포함), 아니면 null */
  private tableCount(): number | null {
    const me = this.store.self;
    if (!me?.seat?.startsWith('table')) return null;
    const group = me.seat.split('-')[0];
    let n = 0;
    for (const e of this.store.players.values()) if (e.info.seat?.startsWith(group + '-')) n++;
    return Math.max(1, n);
  }

  private benchPartner(): string | null {
    const me = this.store.self;
    if (!me?.seat?.startsWith('bench')) return null;
    const group = me.seat.split('-')[0];
    for (const e of this.store.players.values()) if (e.info.id !== me.id && e.info.seat?.startsWith(group + '-')) return e.info.nickname;
    return null;
  }

  private renderFire(q: string) {
    if (!this.last?.inFire) return;
    this.fireCard.classList.remove('hidden');
    this.fireCard.replaceChildren(
      h('div', { class: 'fire-head' }, h('b', {}, '모닥불 대화 참여 중'), h('span', {}, `${this.fireCount()}명`)),
      h('p', { class: 'fire-q' }, q),
      h(
        'div',
        { class: 'fire-btns' },
        h(
          'button',
          {
            type: 'button',
            onclick: async () => {
              const r = await this.net.req('fireQuestion', { next: true });
              if ('question' in r) this.renderFire(r.question);
            },
          },
          '다른 질문',
        ),
        h('button', { type: 'button', class: 'on', onclick: () => this.chat.open('fire') }, '대화하기'),
      ),
    );
  }

  private showNotice(t: string) {
    this.noticeEl.replaceChildren(h('b', {}, '학회장 공지'), h('span', {}, t));
    this.noticeEl.classList.remove('hidden');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.add('hidden'), 8000);
    this.toast(`공지: ${t}`, 'info');
  }
  private noticeTimer = 0;

  applyDisplay() {
    const d = this.store.display;
    this.overlay.setHidden({ names: d.hideNames || d.photo || this.prefs.hideNames, teams: d.hideTeams, bubbles: d.hideBubbles || d.photo });
  }

  private openEmotes() {
    if (this.panel?.isOpen) return;
    this.actionBar.suspend(true);
    this.panel = openEmoteMenu(
      this.el,
      (e) => this.net.socket.emit('emote', e),
      (p) => this.net.socket.emit('pose', p),
      () => this.actionBar.suspend(false),
    );
  }

  /** 다른 참가자 상호작용 메뉴 */
  openPlayer(id: number) {
    const t = this.store.players.get(id)?.info;
    const me = this.store.self;
    if (!t || !me || id === me.id) return;
    if (this.store.hsActive) return; // 숨바꼭질 중에는 이름이 보이는 메뉴를 열지 않음
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    if (d > 160) return this.toast(`${t.nickname} 님에게 조금 더 가까이 가주세요.`, 'info');
    if (this.panel?.isOpen) return;
    this.actionBar.suspend(true);
    this.panel = openPlayerMenu(
      this.el,
      t,
      d,
      async (k: InteractionId) => {
        const r = await this.net.req('interact', { kind: k, target: id });
        if (!r.ok) return r.reason;
        if (k === 'dance' || k === 'follow') this.toast(`${t.nickname} 님에게 요청을 보냈어요.`, 'info');
        return null;
      },
      () => this.actionBar.suspend(false),
    );
  }

  private async act(req: Parameters<Network['act']>[0]) {
    const res = await this.net.act(req);
    if (!res.ok) this.toast(res.reason, 'info');
  }

  private openFood() {
    if (this.panel?.isOpen) return;
    this.actionBar.suspend(true);
    this.panel = openFoodMenu(
      this.el,
      async (id: FoodId) => {
        const res = await this.net.act({ t: 'food', food: id });
        if (!res.ok) return res.reason;
        const name = foodDef(id)?.name ?? '';
        this.toast(`${name}${objectParticle(name)} 받았어요! ‘먹기’를 눌러 먹어요`, 'info');
        return null;
      },
      () => this.actionBar.suspend(false),
    );
  }

  openBoardPanel() {
    if (this.panel?.isOpen) return;
    // 게시판은 게시판 앞에서만 (서버도 위치를 다시 확인함)
    if (!this.last?.nearBoard) {
      this.toast('게시판 앞으로 가까이 가면 쪽지를 볼 수 있어요.', 'info');
      return;
    }
    this.actionBar.suspend(true);
    const timer = window.setInterval(() => this.checkBoardRange(), 400);
    const sheet = openBoard(this.el, this.net, this.store, () => {
      clearInterval(timer);
      this.actionBar.suspend(false);
      if (this.boardSheet === sheet) this.boardSheet = null;
    });
    this.panel = this.boardSheet = sheet;
  }

  // -------------------------------------------------------------- 알림

  toast(text: string, kind: 'join' | 'leave' | 'info' = 'info') {
    const t = h('div', { class: `toast ${kind}` }, h('i', {}), text);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  setConn(state: ConnState, detail?: string) {
    clearTimeout(this.connTimer);
    const text: Record<ConnState, string> = {
      ok: '',
      lost: '연결이 잠시 끊겼어요 · 다시 연결하는 중…',
      restoring: '아지트로 돌아가는 중…',
      restored: '다시 연결됐어요!',
      error: detail ?? '연결할 수 없어요. 잠시 후 다시 시도해주세요.',
    };
    if (state === 'ok') {
      this.conn.classList.add('hidden');
      return;
    }
    this.conn.className = `conn ${state}`;
    this.conn.replaceChildren(h('i', {}), text[state]);
    if (state === 'restored') this.connTimer = window.setTimeout(() => this.conn.classList.add('hidden'), 1800);
  }

  // -------------------------------------------------------------- 메뉴

  private menuTab: 'guide' | 'people' | 'me' = 'guide';
  private menuBody: HTMLElement | null = null;
  private menuTabs: HTMLElement | null = null;
  private previews: CharacterPreview[] = [];

  openMenu(tab: 'guide' | 'people' | 'me') {
    this.menuTab = tab;
    if (!this.menu) {
      this.menuBody = h('div', { class: 'sheet-body' });
      this.menuTabs = h('div', { class: 'tabs', role: 'tablist' });
      this.menu = h(
        'div',
        {
          class: 'sheet-backdrop',
          onclick: (e) => {
            if (e.target === this.menu) this.closeMenu();
          },
        },
        h(
          'div',
          { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '메뉴' },
          h(
            'div',
            { class: 'sheet-head' },
            this.menuTabs,
            h('button', { class: 'icon-btn small', type: 'button', 'aria-label': '닫기', onclick: () => this.closeMenu() }, icon('close')),
          ),
          this.menuBody,
        ),
      );
      this.el.append(this.menu);
      setTimeout(() => this.menu?.classList.add('open'), 16);
    }
    this.refreshMenu();
  }

  closeMenu() {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    this.previews.forEach((p) => p.destroy());
    this.previews = [];
    m.classList.remove('open');
    setTimeout(() => m.remove(), 220);
  }

  private refreshMenu() {
    if (!this.menu || !this.menuBody || !this.menuTabs) return;
    const tabs: [typeof this.menuTab, string][] = [
      ['guide', '안내'],
      ['people', `참가자 ${this.store.onlineCount}`],
      ['me', '내 캐릭터'],
    ];
    this.menuTabs.replaceChildren(
      ...tabs.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `tab ${this.menuTab === id ? 'on' : ''}`,
            'aria-selected': String(this.menuTab === id),
            onclick: () => {
              this.menuTab = id;
              this.refreshMenu();
            },
          },
          label,
        ),
      ),
    );
    this.previews.forEach((p) => p.destroy());
    this.previews = [];
    const body = this.menuBody;
    body.replaceChildren();
    if (this.menuTab === 'guide') body.append(this.guideView());
    if (this.menuTab === 'people') body.append(this.peopleView());
    if (this.menuTab === 'me') body.append(this.meView());
  }

  private guideView() {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    const order = ['plaza', 'board', 'foodtruck', 'spring', 'campfire', 'playground', 'portal'];
    const zones = order.map((id) => WORLD.zones.find((z) => z.id === id)!).filter(Boolean);
    return h(
      'div',
      { class: 'guide' },
      h('h3', {}, '소리'),
      sound() ? soundControls(sound()!, '휴대폰 소리는 기본으로 꺼져 있어요. 행사 음악은 빔프로젝터 스피커에서 나와요. 이어폰을 꽂았다면 켜 보세요!') : null,
      h('h3', {}, '이렇게 움직여요'),
      h(
        'p',
        { class: 'muted' },
        isTouch ? '화면 왼쪽 아래를 엄지로 누른 채 원하는 방향으로 밀어보세요.' : 'W A S D 또는 방향키로 이동해요. 휴대폰에서는 화면 왼쪽 아래 조이스틱을 쓰면 돼요.',
      ),
      h('p', { class: 'muted' }, '푸드트럭·온천·게시판·벤치·놀이기구·다른 참가자 가까이 가면 오른쪽 아래에 버튼이 나타나요.' + (isTouch ? '' : ' (E 키로도 누를 수 있어요)')),
      h('p', { class: 'muted' }, '오른쪽 위 ‘채팅’으로 대화하고, ‘표정’으로 이모티콘·동작을 보여줄 수 있어요. 다른 캐릭터를 눌러도 상호작용 메뉴가 열려요.'),
      h('h3', {}, '아지트 둘러보기'),
      h(
        'ul',
        { class: 'zone-list' },
        ...zones.map((z) =>
          h(
            'li',
            {},
            h('div', {}, h('strong', {}, z.name), h('span', { class: 'muted' }, z.desc)),
            h('em', { class: `badge phase-${z.phase}` }, z.phase === 1 ? '이용 가능' : `${z.phase}차 예정`),
          ),
        ),
      ),
      h('h3', {}, '앞으로 열릴 기능'),
      h(
        'ol',
        { class: 'roadmap' },
        h('li', { class: 'done' }, h('b', {}, '1차'), ' 아지트 공간 · 캐릭터 · 실시간 이동 · 게시판 · 푸드트럭 · 온천'),
        h('li', { class: 'done' }, h('b', {}, '2차'), ' 채팅 · 모닥불·벤치 대화 · 이모티콘·포즈 · 장난 기믹 · 놀이터'),
        h('li', {}, h('b', {}, '3차'), " '과제 괴물' 협동 레이드"),
      ),
    );
  }

  private peopleView() {
    const all = [...this.store.players.values()].map((e) => e.info);
    const group = (role: 'senior' | 'junior') =>
      all
        .filter((p) => p.role === role)
        .sort((a, b) => Number(b.id === this.store.selfId) - Number(a.id === this.store.selfId) || a.joinedAt - b.joinedAt);
    const row = (p: PlayerInfo) => {
      const pv = new CharacterPreview(p.look, 2, 'idle');
      this.previews.push(pv);
      return h(
        'li',
        { class: p.status === 'away' ? 'away' : '' },
        h('span', { class: 'mini' }, pv.canvas),
        h('span', { class: 'who' }, h('small', { class: 'grade' }, gradeLabel(p.grade)), p.nickname, p.id === this.store.selfId ? h('em', { class: 'me-tag' }, '나') : null),
        p.food ? h('span', { class: 'muted small' }, foodDef(p.food)?.name ?? '') : p.bath ? h('span', { class: 'muted small' }, '♨ 온천') : null,
        p.status === 'away' ? h('span', { class: 'muted small' }, '연결 끊김') : null,
      );
    };
    const sen = group('senior');
    const jun = group('junior');
    return h(
      'div',
      { class: 'people' },
      h('h3', {}, h('span', { class: 'role-dot senior' }), `선배 ${sen.length}`),
      sen.length ? h('ul', { class: 'people-list' }, ...sen.map(row)) : h('p', { class: 'muted' }, '아직 선배가 없어요'),
      h('h3', {}, h('span', { class: 'role-dot junior' }), `후배 ${jun.length}`),
      jun.length ? h('ul', { class: 'people-list' }, ...jun.map(row)) : h('p', { class: 'muted' }, '아직 후배가 없어요'),
    );
  }

  private toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
    const input = h('input', { type: 'checkbox', onchange: () => onChange(input.checked) });
    input.checked = value;
    return h('label', { class: 'toggle' }, input, h('span', {}, label));
  }

  private meView() {
    const me = this.store.self;
    if (!me) return h('p', { class: 'muted' }, '캐릭터 정보를 불러오는 중이에요');
    const pv = new CharacterPreview(me.look, 5, 'tour');
    this.previews.push(pv);
    const fsSupported = !!document.documentElement.requestFullscreen;
    return h(
      'div',
      { class: 'me' },
      h('div', { class: 'me-card' }, h('div', { class: 'me-stage' }, pv.canvas), h('div', {}, h('div', { class: `plate static ${me.role}` }, h('span', { class: 'plate-role' }, h('i', { html: me.role === 'senior' ? ICON.crown : ICON.sprout }), gradeLabel(me.grade)), h('span', { class: 'plate-name' }, me.nickname)), h('p', { class: 'muted' }, `${roleLabel(me.role)} · ${LOOKS[me.look]?.name ?? ''}`), h('p', { class: 'muted small' }, LOOKS[me.look]?.desc ?? ''))),
      fsSupported
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn-secondary',
              onclick: () => {
                if (document.fullscreenElement) document.exitFullscreen();
                else document.documentElement.requestFullscreen().catch(() => {});
              },
            },
            icon('expand'),
            ' 전체 화면 켜기/끄기',
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'btn-danger',
          onclick: () => {
            if (confirm('지금 캐릭터로 아지트를 나가고 새로 만들까요?')) this.actions.onRecreate();
          },
        },
        '캐릭터 다시 만들기',
      ),
      h(
        'div',
        { class: 'settings' },
        this.toggle('이름표 숨기기 (내 화면만)', this.prefs.hideNames, (v) => {
          this.prefs = { ...this.prefs, hideNames: v };
          Storage.prefs = this.prefs;
          this.applyDisplay();
        }),
        this.toggle('장난 받지 않기 (물풍선·뿅망치·그네 밀기 등)', this.prefs.noPrank, (v) => {
          this.prefs = { ...this.prefs, noPrank: v };
          Storage.prefs = this.prefs;
          this.net.socket.emit('setPref', { noPrank: v });
        }),
      ),
      TEAMS[me.team]
        ? h('p', { class: 'team-line', style: `--tc:${TEAMS[me.team].color}` }, h('i', { html: teamSvg(TEAMS[me.team].symbol, '#fff') }), `${teamName(this.store, me.team)} · 팀은 학회장이 바꿀 수 있어요`)
        : h('p', { class: 'muted small' }, '아직 팀이 없어요. 학회장이 배정해줄 거예요.'),
      h('p', { class: 'muted small' }, '새로고침하거나 잠깐 연결이 끊겨도 같은 캐릭터로 돌아올 수 있어요.'),
      this.store.hostAccount ? null : this.titlesView(),
      this.hostLoginView(),
    );
  }

  destroy() {
    this.actionBar.destroy();
    this.panel?.close();
    this.unsubs.forEach((u) => u());
    this.closeMenu();
    this.el.remove();
  }
}
