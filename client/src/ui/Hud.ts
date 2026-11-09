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
import type { Sheet } from './Sheet';

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

  constructor(
    private store: WorldStore,
    private net: Network,
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
    });

    const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

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
      this.conn,
      this.zoneCard,
      this.toasts,
      this.actionBar.el,
      !isTouch ? h('div', { class: 'key-hint' }, h('kbd', {}, 'W A S D'), ' 또는 ', h('kbd', {}, '방향키'), '로 이동') : null,
    );

    this.unsubs.push(
      store.on('count', (n) => {
        this.count.textContent = String(n);
        this.refreshMenu();
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
      store.on('status', () => this.refreshMenu()),
      store.on('patch', (p) => {
        if (p.id === store.selfId) this.refreshMenu();
      }),
      store.on('note', (n) => {
        if (n.nickname !== store.self?.nickname) this.toast(`${n.nickname} 님이 게시판에 쪽지를 남겼어요`, 'info');
      }),
    );
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
    this.actionBar.update(s);
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
    this.actionBar.suspend(true);
    this.panel = openBoard(this.el, this.net, this.store, () => this.actionBar.suspend(false));
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
      h('h3', {}, '이렇게 움직여요'),
      h(
        'p',
        { class: 'muted' },
        isTouch ? '화면 왼쪽 아래를 엄지로 누른 채 원하는 방향으로 밀어보세요.' : 'W A S D 또는 방향키로 이동해요. 휴대폰에서는 화면 왼쪽 아래 조이스틱을 쓰면 돼요.',
      ),
      h('p', { class: 'muted' }, '푸드트럭·온천·게시판 가까이 가면 오른쪽 아래에 버튼이 나타나요.' + (isTouch ? '' : ' (E 키로도 누를 수 있어요)')),
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
        h('li', {}, h('b', {}, '2차'), ' 대화 · 놀이터 장난 기믹 · 포즈와 춤'),
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
      h('p', { class: 'muted small' }, '새로고침하거나 잠깐 연결이 끊겨도 같은 캐릭터로 돌아올 수 있어요.'),
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
