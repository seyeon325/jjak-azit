/**
 * 앱 진입점
 *  - /        : 참가자 화면 (접속 → 캐릭터 만들기 → 광장)
 *  - /screen  : 관전 화면 (빔프로젝터용)
 *  - /admin   : 운영자 페이지 (로그인 후 관전 화면 + 관리 패널)
 */
import './styles/fonts.css';
import './styles/main.css';
import './styles/features.css';
import './styles/social.css';
import type Phaser from 'phaser';
import type { JoinResult, Profile } from '../../shared/protocol';
import { gradeLabel } from '../../shared/foods';
import { WORLD } from '../../shared/map';
import { InputController } from './game/InputController';
import type { WorldScene } from './game/scenes/WorldScene';
import { Network, Storage } from './net/Network';
import { WorldStore } from './state/WorldStore';
import { AdminPanel, adminLogin, adminToken, clearAdminToken } from './ui/AdminPanel';
import { h } from './ui/dom';
import { Hud } from './ui/Hud';
import { Joystick } from './ui/Joystick';
import { LoginScreen } from './ui/LoginScreen';
import { ScreenHud } from './ui/ScreenHud';
import { WorldOverlay } from './ui/WorldOverlay';

const app = document.getElementById('app')!;
const path = location.pathname.replace(/\/+$/, '');
const isAdmin = path === '/admin';
const isScreen = path === '/screen' || new URLSearchParams(location.search).has('screen');

async function loadFonts() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('12px Galmuri11'), document.fonts.load('12px "Galmuri11 Bold"')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* 폰트가 없어도 동작은 함 */
  }
}

function splash(text: string) {
  const el = h('div', { class: 'splash' }, h('div', { class: 'splash-dots' }, h('i'), h('i'), h('i')), h('p', {}, text));
  app.append(el);
  return el;
}

interface Hooks {
  onZone?: Parameters<typeof import('./game/createGame').createGame>[1]['onZoneChange'];
  hud?: Hud | null;
  screen?: ScreenHud | null;
}

async function startGame(mode: 'player' | 'screen', store: WorldStore, net: Network, hooks: Hooks, input?: InputController) {
  const stage = h('div', { class: `stage-root ${mode}` });
  const canvasHost = h('div', { class: 'canvas-host' });
  stage.append(canvasHost);
  app.append(stage);
  const overlay = new WorldOverlay(canvasHost);
  const { createGame } = await import('./game/createGame');
  let ref: { game: Phaser.Game; scene: () => WorldScene | null } | null = null;
  await new Promise<void>((resolve) => {
    ref = createGame(canvasHost, {
      mode,
      store,
      net,
      input,
      overlay,
      onZoneChange: (z) => hooks.hud?.setZone(z),
      onInteract: (st) => hooks.hud?.setInteract(st),
      onBoardTap: () => hooks.hud?.openBoardPanel(),
      onPlayerTap: (id) => hooks.hud?.openPlayer(id),
      onTrackLost: () => hooks.screen?.trackLost(),
      onReady: () => resolve(),
    });
  });
  // 새 쪽지가 올라오면 광장 게시판 위에 잠깐 떠오름
  store.on('note', (n) => {
    const b = WORLD.spots.board;
    const t = Array.from(n.text).slice(0, 22).join('') + (Array.from(n.text).length > 22 ? '…' : '');
    overlay.pop(b.x, b.y - 64, `${n.anon ? '익명' : n.nickname}: ${t}`);
  });
  return { stage, overlay, canvasHost, scene: () => ref?.scene() ?? null };
}

async function fetchTeamNames(): Promise<string[] | undefined> {
  try {
    const r = (await fetch('/api/info').then((x) => x.json())) as { teamNames?: string[] };
    return r.teamNames;
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------ 참가자

async function runPlayer() {
  const net = new Network();
  const store = new WorldStore();
  store.bind(net.socket);
  const hooks: Hooks = {};

  const loading = splash('아지트에 연결하는 중…');
  // 캐릭터를 고르는 동안 게임 엔진을 미리 받아둠
  void import('./game/createGame');
  const teamNamesP = fetchTeamNames();
  await loadFonts();
  const connected = await net.waitConnected(8000);

  let inGame = false;
  let hud: Hud | null = null;
  let replacedOverlay: HTMLElement | null = null;

  const enter = async (res: Extract<JoinResult, { ok: true }>) => {
    Storage.token = res.token;
    store.muted = res.muted;
    store.reset(res.room, res.selfId);
    if (inGame) return;
    inGame = true;
    const input = new InputController();
    const g = await startGame('player', store, net, hooks, input);
    hud = new Hud(store, net, g.overlay, {
      onRecreate: () => {
        net.leave();
        Storage.token = null;
        setTimeout(() => location.reload(), 250);
      },
    });
    hooks.hud = hud;
    hud.applyDisplay();
    if (Storage.prefs.noPrank) net.socket.emit('setPref', { noPrank: true });
    g.stage.append(hud.el, new Joystick(input).el);
    const me = store.self;
    if (me) hud.toast(`어서 와요, ${gradeLabel(me.grade, me.gradeText)} ${me.nickname} ${me.role === 'senior' ? '선배' : '후배'}님!`, 'info');
  };

  // 저장된 세션이 있으면 바로 복귀 (새로고침 대응)
  let resumed = false;
  const token = Storage.token;
  if (connected && token) {
    const res = await net.resume(token);
    if (res.ok) {
      await enter(res);
      resumed = true;
    } else Storage.token = null;
  }
  loading.remove();

  let login: LoginScreen | null = null;
  if (!resumed) {
    login = new LoginScreen(
      async (profile: Profile) => {
        if (!net.connected) {
          const ok = await net.waitConnected(5000);
          if (!ok) return '서버에 연결할 수 없어요. 와이파이/데이터 연결을 확인해주세요.';
        }
        const res = await net.join(profile);
        if (!res.ok) return res.reason;
        Storage.profile = profile;
        await enter(res);
        login?.el.classList.add('leaving');
        setTimeout(() => {
          login?.destroy();
          login = null;
        }, 450);
        return null;
      },
      Storage.profile,
      await teamNamesP,
    );
    app.append(login.el);
    if (!connected) login.setMessage('서버 연결이 늦어지고 있어요. 잠시 후 입장 버튼을 눌러주세요.', 'info');
  }

  // 운영자가 팀을 바꾸면 저장된 프로필에도 반영 (다음 입장 때 유지)
  store.on('patch', (info, patch) => {
    if (info.id !== store.selfId || patch.team === undefined) return;
    const p = Storage.profile;
    if (p) Storage.profile = { ...p, team: patch.team };
  });

  // 재연결 처리
  net.socket.on('disconnect', (reason) => {
    if (!inGame) return;
    if (reason === 'io server disconnect') return;
    hud?.setConn('lost');
  });
  net.socket.io.on('reconnect_attempt', () => {
    if (inGame) hud?.setConn('lost');
  });
  net.socket.on('connect', async () => {
    if (!inGame) return;
    replacedOverlay?.remove();
    replacedOverlay = null;
    hud?.setConn('restoring');
    let res: JoinResult = { ok: false, reason: 'no-token' };
    const t = Storage.token;
    if (t) res = await net.resume(t);
    if (!res.ok && Storage.profile) {
      const me = store.self;
      res = await net.join(Storage.profile, me ? { x: me.x, y: me.y } : undefined);
    }
    if (res.ok) {
      Storage.token = res.token;
      store.muted = res.muted;
      store.reset(res.room, res.selfId);
      hud?.setConn('restored');
    } else hud?.setConn('error', res.reason);
  });
  net.socket.on('replaced', () => {
    replacedOverlay = h(
      'div',
      { class: 'blocker' },
      h(
        'div',
        { class: 'blocker-card' },
        h('h2', {}, '다른 화면에서 접속했어요'),
        h('p', {}, '같은 캐릭터가 다른 탭이나 기기에서 아지트에 들어갔어요.'),
        h('button', { class: 'btn-primary', type: 'button', onclick: () => net.socket.connect() }, '이 화면에서 계속하기'),
      ),
    );
    app.append(replacedOverlay);
  });
}

// ------------------------------------------------------------------ 관전 화면 / 운영자

async function runScreen(admin: boolean) {
  document.title = admin ? '짝선짝후 아지트 · 운영자' : '짝선짝후 아지트 · 관전 화면';
  let token: string | null = null;
  if (admin) {
    await loadFonts();
    token = adminToken() ?? (await adminLogin(app));
  }
  const net = new Network();
  const store = new WorldStore();
  store.bind(net.socket);
  const hooks: Hooks = {};
  const loading = splash(admin ? '운영자 화면을 준비하는 중…' : '관전 화면을 준비하는 중…');
  await loadFonts();
  await net.waitConnected(15000);

  const auth = async () => {
    if (!admin || !token) return true;
    const r = await net.req('adminAuth', { token });
    if (!r.ok) {
      clearAdminToken();
      alert(r.reason);
      location.reload();
      return false;
    }
    return true;
  };
  if (!(await auth())) return;
  const first = await net.spectate();
  if (first.ok) store.reset(first.room, null);
  loading.remove();

  const g = await startGame('screen', store, net, hooks);
  g.overlay.addZoneLabels(WORLD.zones);
  const hud = new ScreenHud(store, g.scene, g.canvasHost);
  hooks.screen = hud;
  g.stage.append(hud.el);
  const applyDisplay = () => {
    const d = store.display;
    g.overlay.setHidden({ names: d.hideNames || d.photo, teams: d.hideTeams, bubbles: d.hideBubbles || d.photo });
  };
  store.on('display', applyDisplay);
  applyDisplay();
  // 관전 화면에서도 일반 채팅은 말풍선으로 (벤치·모닥불 대화는 서버가 보내지 않음)
  store.on('chat', (m) => g.overlay.bubble(m.from, m.text, 4200, `ch-${m.ch}`));

  if (admin && token) {
    const panel = new AdminPanel(store, net, token, (id) => hud.track(id), () => {
      clearAdminToken();
      location.reload();
    });
    g.stage.append(panel.el);
    g.stage.classList.add('admin');
    hud.el.querySelector('.qr-card')?.classList.add('hidden'); // 운영자 화면은 QR 기본 숨김 (Q 로 표시)
  }

  net.socket.on('disconnect', () => hud.setConn(false));
  net.socket.on('connect', async () => {
    if (!(await auth())) return;
    const res = await net.spectate();
    if (res.ok) store.reset(res.room, null);
    hud.setConn(true);
  });
}

(isAdmin ? runScreen(true) : isScreen ? runScreen(false) : runPlayer()).catch((err) => {
  console.error(err);
  app.append(h('div', { class: 'blocker' }, h('div', { class: 'blocker-card' }, h('h2', {}, '문제가 생겼어요'), h('p', {}, '페이지를 새로고침해주세요.'))));
});
