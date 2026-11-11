/**
 * 짝선짝후 아지트 — 실시간 서버
 *  - HTTP: 빌드된 클라이언트 정적 파일, /api/info, 학회장 로그인·CSV 내보내기
 *  - WebSocket(Socket.IO): 입장·재접속·이동·음식·온천·좌석·놀이기구·채팅·게시판·학회장 기능
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { CHAT_MAX, COMMENT_MAX, NOTE_MAX } from '../shared/constants';
import type {
  ChatChannel,
  ClientToServerEvents,
  DisplaySettings,
  JoinResult,
  PlayerInfo,
  ServerToClientEvents,
} from '../shared/protocol';
import { EGG_BY_ID, EGG_IDS, EXPLORE_ZONES, type EggId } from '../shared/events';
import { WORLD, zoneAt } from '../shared/map';
import { TEAMS } from '../shared/social';
import { BoardStore, type Author } from './BoardStore';
import { EggStore } from './EggStore';
import { EventStage } from './EventStage';
import { RaidGame } from './Raid';
import { HideSeek } from './HideSeek';
import { PrizeStore } from './PrizeStore';
import { PlazaRoom, type StatKey } from './rooms/PlazaRoom';
import { SessionStore, type Session } from './sessions';
import { SettingsStore } from './SettingsStore';
import { parseAct, parseMove, sanitizeNote, sanitizeProfile, sanitizeText } from './validation';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/$/, '');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 60);
const GRACE_MS = Number(process.env.RECONNECT_GRACE_SEC ?? 45) * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? 'data');
const BOARD_FILE = process.env.BOARD_FILE ?? path.join(DATA_DIR, 'board.json');
const NOTE_COOLDOWN_MS = 8000;
const COMMENT_COOLDOWN_MS = 3000;
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

// 학회장 비밀번호: 환경변수가 없으면 서버가 켜질 때마다 임시 비밀번호를 만들어 로그에 표시
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD ?? '').trim() || randomBytes(4).toString('hex');
const ADMIN_FROM_ENV = !!(process.env.ADMIN_PASSWORD ?? '').trim();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../dist/client');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ 저장소

const board = new BoardStore(BOARD_FILE);
const settings = new SettingsStore(path.join(DATA_DIR, 'settings.json'));
const prizes = new PrizeStore(path.join(DATA_DIR, 'prizes.json'));
const eggs = new EggStore(path.join(DATA_DIR, 'eggs.json'));
const adminTokens = new Map<string, number>(); // token → 만료 시각

function adminTokenValid(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const exp = adminTokens.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

function passwordOk(input: string) {
  const a = Buffer.from(sha(input));
  const b = Buffer.from(sha(ADMIN_PASSWORD));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ HTTP

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));

function lanUrls(port: number) {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/api/info', (_req, res) => {
  res.json({
    publicUrl: PUBLIC_URL || null,
    lanUrls: lanUrls(IS_PROD ? PORT : 5173),
    players: plaza.onlineCount,
    teamNames: settings.data.teamNames,
  });
});

// 학회장 로그인 (IP 당 1분에 8번까지)
const loginTries = new Map<string, number[]>();
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip ?? 'x';
  const now = Date.now();
  const tries = (loginTries.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (tries.length >= 8) return res.status(429).json({ ok: false, reason: '잠시 뒤에 다시 시도해주세요.' });
  tries.push(now);
  loginTries.set(ip, tries);
  const pw = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!pw || !passwordOk(pw)) return res.status(401).json({ ok: false, reason: '비밀번호가 맞지 않아요.' });
  const token = randomBytes(24).toString('hex');
  adminTokens.set(token, now + ADMIN_TTL_MS);
  log('학회장 로그인');
  res.json({ ok: true, token, expiresAt: now + ADMIN_TTL_MS });
});

app.post('/api/admin/logout', (req, res) => {
  const t = String(req.get('authorization') ?? '').replace(/^Bearer /, '');
  adminTokens.delete(t);
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', (req, res) => {
  const t = String(req.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!adminTokenValid(t)) return res.status(401).send('학회장 로그인이 필요해요.');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jjak-azit-board-${stamp}.csv"`);
  res.send(board.toCSV());
});

// 이스터에그 기록 · 상품 당첨 기록 내보내기 (학회장만)
for (const [route, name, csv] of [
  ['/api/admin/eggs.csv', 'eggs', () => eggs.toCSV()],
  ['/api/admin/prizes.csv', 'prizes', () => prizes.toCSV()],
  ['/api/admin/raid.csv', 'raid', () => raid.toCSV()],
] as const) {
  app.get(route, (req, res) => {
    const t = String(req.get('authorization') ?? '').replace(/^Bearer /, '');
    if (!adminTokenValid(t)) return res.status(401).send('학회장 로그인이 필요해요.');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="jjak-azit-${name}-${stamp}.csv"`);
    res.send(csv());
  });
}

if (existsSync(CLIENT_DIR)) {
  app.use(
    '/assets',
    express.static(path.join(CLIENT_DIR, 'assets'), { immutable: true, maxAge: '30d', fallthrough: false }),
  );
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: 0 }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res
      .type('html')
      .send(
        '<meta charset="utf-8"><p>클라이언트가 아직 빌드되지 않았어요.</p>' +
          '<p>개발 중이라면 <a href="http://localhost:5173">http://localhost:5173</a> 으로 접속하고, ' +
          '배포하려면 <code>npm run build</code> 후 <code>npm start</code> 를 실행하세요.</p>',
      ),
  );
}

const httpServer = createServer(app);

// ------------------------------------------------------------------ Socket.IO

interface SocketData {
  token?: string;
  spectator?: boolean;
  admin?: boolean;
  replaced?: boolean;
}
type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 16_000,
  cors: IS_PROD ? undefined : { origin: true },
});

const plaza = new PlazaRoom(io);
const sessions = new SessionStore();
let nextPlayerId = 1;

plaza.hooks = {
  emitTo(playerId, ev, ...args) {
    const s = sessions.byPlayer(playerId);
    if (!s?.socketId) return;
    const sock = io.sockets.sockets.get(s.socketId) as unknown as { emit: (e: string, ...a: unknown[]) => void } | undefined;
    sock?.emit(ev, ...args);
  },
  isMuted(playerId) {
    const s = sessions.byPlayer(playerId);
    return !!s && settings.isMuted(s.ownerKey);
  },
  display: () => effectiveDisplay(),
  teamNames: () => settings.data.teamNames,
  stat: (playerId, key) => eggStat(playerId, key),
  stage: () => stage.state(),
  raid: () => raid.state(),
};

// ------------------------------------------------------------------ 경품 무대 (우수 PAIR 가챠 · 오늘의 행운 추첨)

const stage = new EventStage({
  plaza,
  prizes,
  sessions: () => sessions.all(),
  broadcast: (st) => io.to(plaza.channel).emit('stage', st),
  tell: (id, text) => plaza.hooks.emitTo(id, 'info', text),
  log: (m) => log(m),
});

// ------------------------------------------------------------------ 과제 괴물 레이드

const raid = new RaidGame(
  {
    plaza,
    isHostSession: (id) => !!sessions.byPlayer(id)?.admin,
    broadcast: (st) => io.to(plaza.channel).volatile.emit('raid', st),
    fx: (list) => io.to(plaza.channel).emit('rfx', list),
    log: (m) => log(m),
  },
  path.join(DATA_DIR, 'raid.json'),
);

// ------------------------------------------------------------------ 학회장을 찾아라!

const hs = new HideSeek({
  plaza,
  prizes,
  broadcast: (st) => {
    io.to(plaza.channel).emit('hs', st);
    // 학회장 화면(관전 소켓)에는 학회장 정보가 포함된 상태를 따로 보냄
    for (const s of io.sockets.sockets.values()) if ((s as IOSocket).data.admin && !(s as IOSocket).data.token) s.emit('hs', hs.adminState());
    // 학회장 본인은 자기가 학회장인 걸 알아야 함
    if (hs.hostId !== null) plaza.hooks.emitTo(hs.hostId, 'hs', hs.adminState());
  },
  displayChanged: () => io.to(plaza.channel).emit('display', effectiveDisplay()),
  notice: (text) => io.to(plaza.channel).emit('notice', text),
  ownerKey: (id) => sessions.byPlayer(id)?.ownerKey ?? null,
  isHostSession: (id) => !!sessions.byPlayer(id)?.admin,
  log: (m) => log(m),
});
plaza.rules = hs;

/** 학회장이 정한 화면 설정 + 숨바꼭질 중 강제 설정 (원래 설정은 그대로 보관 → 끝나면 자동 복원) */
function effectiveDisplay(): DisplaySettings {
  return hs.overrideDisplay(settings.data.display);
}

// ------------------------------------------------------------------ 이스터에그

const STAT_EGG: Record<StatKey, EggId> = { swing: 'swing', sumung: 'sumung', dance: 'dance', prank: 'prank', secret: 'secret' };

function eggStat(playerId: number, key: StatKey, n = 1) {
  eggProgress(playerId, STAT_EGG[key], n);
}

function eggProgress(playerId: number, id: EggId, n: number) {
  const s = sessions.byPlayer(playerId);
  const info = plaza.get(playerId);
  if (!s || !info || s.admin) return; // 학회장 계정은 최초 달성 경쟁에서 제외
  if (eggs.add(s.ownerKey, id, n)) awardEgg(playerId, s, id);
}

function awardEgg(playerId: number, s: Session, id: EggId) {
  const info = plaza.get(playerId);
  if (!info) return;
  const r = eggs.tryAward(id, s.ownerKey, info.nickname);
  if (!r) return;
  const def = EGG_BY_ID.get(id)!;
  if (r.equipped) plaza.patch(playerId, { title: id });
  const ev = { id, title: def.title, nickname: info.nickname, winnerId: playerId };
  if (eggs.rec(id).broadcast) io.to(plaza.channel).emit('egg', ev);
  else plaza.hooks.emitTo(playerId, 'egg', ev);
  log(`이스터에그 최초 달성: ${info.nickname} — ${def.title}`);
}

// 1초마다: 온천·모닥불 체류 시간, 구역 방문 (서버 위치 기준)
const campfire = WORLD.spots.campfire;
setInterval(() => {
  if (hs.active) return; // 숨바꼭질 중에는 집계하지 않음
  for (const p of plaza.list()) {
    if (p.status !== 'online') continue;
    if (p.bath) eggProgress(p.id, 'spring', 1);
    if (Math.hypot(p.x - campfire.x, p.y - campfire.y) <= 72) eggProgress(p.id, 'fire', 1);
    const z = zoneAt(p.x, p.y);
    const s = sessions.byPlayer(p.id);
    if (z && s && !s.admin && EXPLORE_ZONES.includes(z.id) && eggs.rec('explorer').enabled && !eggs.rec('explorer').winner) {
      if (eggs.visit(s.ownerKey, z.id) >= Math.min(eggs.rec('explorer').need, EXPLORE_ZONES.length)) awardEgg(p.id, s, 'explorer');
    }
  }
}, 1000).unref();

plaza.start();

function ownerKeyFrom(uid: unknown): string {
  // 기기 키가 없거나 이상하면 이번 세션에서만 쓰는 임시 키
  const u = typeof uid === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(uid) ? uid : randomUUID();
  return sha(`azit:${u}`).slice(0, 32);
}

function attach(socket: IOSocket, session: Session) {
  if (session.socketId && session.socketId !== socket.id) {
    const old = io.sockets.sockets.get(session.socketId) as IOSocket | undefined;
    if (old) {
      old.data.replaced = true;
      old.emit('replaced');
      old.disconnect(true);
    }
  }
  sessions.cancelGrace(session);
  session.socketId = socket.id;
  socket.data.token = session.token;
  if (session.admin) socket.data.admin = true; // 학회장은 재접속해도 권한 유지
  socket.join(plaza.channel);
  plaza.setStatus(session.playerId, 'online');
  hs.onHostBack(session.playerId);
}

function leave(socket: IOSocket) {
  const token = socket.data.token;
  if (!token) return;
  const session = sessions.get(token);
  socket.data.token = undefined;
  socket.leave(plaza.channel);
  if (!session) return;
  sessions.delete(token);
  hs.onHostGone(session.playerId);
  raid.removePlayer(session.playerId);
  plaza.removePlayer(session.playerId, 'left');
  log(`퇴장: ${session.nickname} (#${session.playerId})`);
}

function me(socket: IOSocket): { session: Session; info: PlayerInfo } | null {
  const session = sessions.get(socket.data.token);
  const info = session && plaza.get(session.playerId);
  return session && info ? { session, info } : null;
}

function authorOf(session: Session, info: PlayerInfo): Author {
  return {
    ownerKey: session.ownerKey,
    nickname: info.nickname,
    role: info.role,
    grade: info.grade,
    gradeText: info.gradeText,
    team: info.team,
    look: info.look,
  };
}

const lastNoteAt = new Map<string, number>();
const lastCommentAt = new Map<string, number>();
function cooldownLeft(map: Map<string, number>, key: string, ms: number) {
  const wait = ms - (Date.now() - (map.get(key) ?? 0));
  if (wait > 0) return Math.ceil(wait / 1000);
  map.set(key, Date.now());
  return 0;
}

const NO_AUTH = { ok: false as const, reason: '학회장 로그인이 필요해요.' };
const NOT_IN = { ok: false as const, reason: '아지트에 입장한 뒤 이용할 수 있어요.' };

io.on('connection', (rawSocket) => {
  const socket = rawSocket as IOSocket;
  const isAdmin = () => !!socket.data.admin;

  socket.on('join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const profile = sanitizeProfile(payload?.profile);
    if ('error' in profile) return ack({ ok: false, reason: profile.error });
    if (socket.data.token) leave(socket);
    if (plaza.size >= MAX_PLAYERS) return ack({ ok: false, reason: '아지트가 가득 찼어요. 잠시 후 다시 시도해주세요.' });

    const ownerKey = ownerKeyFrom(payload?.uid);
    const override = settings.data.teamOverrides[ownerKey];
    const hint = payload?.pos;
    const spawn =
      hint && Number.isFinite(hint.x) && Number.isFinite(hint.y) && plaza.isWalkable(hint.x, hint.y)
        ? { x: Math.round(hint.x), y: Math.round(hint.y) }
        : plaza.spawnPoint();
    const info: PlayerInfo = {
      ...profile,
      gradeText: profile.gradeText ?? '',
      team: override ?? profile.team ?? -1,
      id: nextPlayerId++,
      x: spawn.x,
      y: spawn.y,
      dir: 0,
      moving: false,
      status: 'online',
      joinedAt: Date.now(),
      food: null,
      eating: false,
      bath: false,
      seat: null,
      followId: null,
      noPrank: false,
      host: false,
      title: eggs.equipped(ownerKey),
    };
    const session = sessions.create(randomUUID(), info.id, profile.nickname, ownerKey);
    plaza.addPlayer(info);
    attach(socket, session);
    log(
      `입장: ${info.nickname} (#${info.id}, ${info.grade ? info.grade + '학년' : info.gradeText || '기타'} ${info.role === 'senior' ? '선배' : '후배'}) · 접속 ${plaza.onlineCount}명`,
    );
    const res: JoinResult = { ok: true, selfId: info.id, token: session.token, room: plaza.snapshot(info.id), muted: settings.isMuted(ownerKey) };
    ack(res);
  });

  socket.on('resume', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const token = typeof payload?.token === 'string' ? payload.token : '';
    const session = sessions.get(token);
    if (!session || !plaza.has(session.playerId)) return ack({ ok: false, reason: 'expired' });
    attach(socket, session);
    const room = plaza.snapshot(session.playerId);
    if (session.playerId === hs.hostId) room.hs = hs.adminState();
    ack({ ok: true, selfId: session.playerId, token: session.token, room, muted: settings.isMuted(session.ownerKey) });
  });

  socket.on('spectate', (ack) => {
    if (typeof ack !== 'function') return;
    socket.data.spectator = true;
    socket.join(plaza.channel);
    const room = plaza.snapshot(null);
    if (socket.data.admin) room.hs = hs.adminState();
    ack({ ok: true, room });
  });

  socket.on('m', (raw) => {
    const m = me(socket);
    const input = parseMove(raw);
    if (!m || !input) return;
    const fix = plaza.handleMove(m.session.playerId, input);
    if (fix) socket.emit('cx', fix.x, fix.y);
  });

  socket.on('act', (raw, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    const req = parseAct(raw);
    if (!m || !req) return ack({ ok: false, reason: '요청을 처리할 수 없어요.' });
    ack(plaza.act(m.session.playerId, req));
  });

  // ---------------------------------------------------------------- 소셜

  socket.on('chat', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    const ch = payload?.ch as ChatChannel;
    const text = sanitizeText(payload?.text, CHAT_MAX);
    if (!m) return ack(NOT_IN);
    if (!text) return ack({ ok: false, reason: '메시지를 입력해주세요.' });
    if (ch !== 'all' && ch !== 'fire' && ch !== 'bench') return ack({ ok: false, reason: '알 수 없는 채팅방이에요.' });
    ack(plaza.chat(m.session.playerId, ch, text));
  });

  socket.on('emote', (kind) => {
    const m = me(socket);
    if (m) plaza.emote(m.session.playerId, kind);
  });
  socket.on('pose', (kind) => {
    const m = me(socket);
    if (m) plaza.pose(m.session.playerId, kind);
  });
  socket.on('interact', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    ack(plaza.interact(m.session.playerId, payload?.kind, Number(payload?.target)));
  });
  socket.on('respond', (payload) => {
    const m = me(socket);
    if (m) plaza.respond(m.session.playerId, Number(payload?.reqId), !!payload?.accept);
  });
  socket.on('unfollow', () => {
    const m = me(socket);
    if (m) plaza.unfollow(m.session.playerId);
  });
  socket.on('setPref', (payload) => {
    const m = me(socket);
    if (m && typeof payload?.noPrank === 'boolean') plaza.setPref(m.session.playerId, payload.noPrank);
  });
  socket.on('fireQuestion', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    ack({ question: m ? plaza.fireQuestion(m.session.playerId, !!payload?.next) : '' });
  });

  // ---------------------------------------------------------------- 게시판

  socket.on('boardList', (ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    ack({ notes: board.list(), mine: m ? board.mine(m.session.ownerKey) : { notes: [], comments: [], liked: [] } });
  });

  socket.on('boardPost', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack({ ok: false, reason: '아지트에 입장한 뒤 쪽지를 남길 수 있어요.' });
    if (settings.isMuted(m.session.ownerKey)) return ack({ ok: false, reason: '학회장이 글쓰기를 잠시 제한했어요.' });
    const text = sanitizeNote(payload?.text, NOTE_MAX);
    if (!text) return ack({ ok: false, reason: '쪽지 내용을 입력해주세요.' });
    const wait = cooldownLeft(lastNoteAt, m.session.ownerKey, NOTE_COOLDOWN_MS);
    if (wait) return ack({ ok: false, reason: `${wait}초 뒤에 다시 남길 수 있어요.` });
    const c = Number(payload?.color);
    const note = board.add(authorOf(m.session, m.info), text, Number.isInteger(c) && c >= 0 && c <= 4 ? c : 0, !!payload?.anon);
    io.to(plaza.channel).emit('bn', note);
    log(`쪽지: ${m.info.nickname}${note.anon ? '(익명)' : ''} — ${text.replace(/\n/g, ' ')}`);
    ack({ ok: true, note });
  });

  socket.on('boardEdit', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const text = sanitizeNote(payload?.text, NOTE_MAX);
    if (!text) return ack({ ok: false, reason: '쪽지 내용을 입력해주세요.' });
    const r = board.edit(Number(payload?.id), m.session.ownerKey, text);
    if (typeof r === 'string') return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('bu', r);
    ack({ ok: true });
  });

  socket.on('boardDelete', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const id = Number(payload?.id);
    const r = board.remove(id, m.session.ownerKey);
    if (r !== true) return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('bd', id);
    ack({ ok: true });
  });

  socket.on('boardLike', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const r = board.toggleLike(Number(payload?.id), m.session.ownerKey);
    if (typeof r === 'string') return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('bu', r.note);
    ack({ ok: true, liked: r.liked, likes: r.note.likes });
  });

  socket.on('boardComments', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    const id = Number(payload?.id);
    ack({ comments: board.commentsOf(id), mine: m ? board.myCommentIds(id, m.session.ownerKey) : [] });
  });

  socket.on('commentPost', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    if (settings.isMuted(m.session.ownerKey)) return ack({ ok: false, reason: '학회장이 글쓰기를 잠시 제한했어요.' });
    const text = sanitizeText(payload?.text, COMMENT_MAX);
    if (!text) return ack({ ok: false, reason: '댓글 내용을 입력해주세요.' });
    const wait = cooldownLeft(lastCommentAt, m.session.ownerKey, COMMENT_COOLDOWN_MS);
    if (wait) return ack({ ok: false, reason: `${wait}초 뒤에 다시 남길 수 있어요.` });
    const r = board.addComment(Number(payload?.noteId), authorOf(m.session, m.info), text);
    if (typeof r === 'string') return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('cn', r);
    const n = board.note(r.noteId);
    if (n) io.to(plaza.channel).emit('bu', n);
    ack({ ok: true, comment: r });
  });

  socket.on('commentEdit', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const text = sanitizeText(payload?.text, COMMENT_MAX);
    if (!text) return ack({ ok: false, reason: '댓글 내용을 입력해주세요.' });
    const r = board.editComment(Number(payload?.id), m.session.ownerKey, text);
    if (typeof r === 'string') return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('cu', r);
    ack({ ok: true });
  });

  socket.on('commentDelete', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const id = Number(payload?.id);
    const r = board.removeComment(id, m.session.ownerKey);
    if (typeof r === 'string') return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('cdel', r.noteId, id);
    const n = board.note(r.noteId);
    if (n) io.to(plaza.channel).emit('bu', n);
    ack({ ok: true });
  });

  // ---------------------------------------------------------------- 학회장

  socket.on('adminAuth', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!adminTokenValid(payload?.token)) return ack({ ok: false, reason: '학회장 로그인이 만료됐어요. 다시 로그인해주세요.' });
    socket.data.admin = true;
    const m = me(socket);
    if (m) {
      // 참가자 화면에서 로그인 = 학회장 아바타 (아바타 + 관리자 권한)
      if (!m.session.admin) log(`학회장 로그인: ${m.info.nickname} (#${m.info.id})`);
      m.session.admin = true;
      if (!(hs.active && hs.hostId === m.info.id)) plaza.patch(m.info.id, { host: true, title: null });
      if (hs.hostId === m.info.id) socket.emit('hs', hs.adminState());
    } else {
      socket.data.spectator = true;
      socket.join(plaza.channel);
      socket.emit('hs', hs.adminState());
    }
    ack({ ok: true });
  });

  // ---------------------------------------------------------------- 학회장을 찾아라!

  socket.on('hsFind', (ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const r = hs.find(m.session.playerId);
    ack(r ? { ok: false, reason: r } : { ok: true });
  });

  socket.on('adminHs', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const cmd = payload?.cmd;
    let r: string | null = null;
    if (cmd === 'start') {
      // 참가자 화면에서 학회장 로그인한 사람이 시작하면 본인이 학회장, 학회장 페이지에서는 고른 학회장
      const self = me(socket);
      const hostId = self?.session.admin ? self.session.playerId : Number(payload?.hostId);
      const sec = payload?.searchSec === undefined ? undefined : Number(payload.searchSec);
      r = raid.active ? '레이드가 진행 중이에요. 레이드를 닫은 뒤 시작해주세요.' : hs.start(hostId, sec);
    } else if (cmd === 'end') hs.end();
    else if (cmd === 'cancel') hs.cancel();
    else if (cmd === 'reset') r = hs.reset();
    else r = '알 수 없는 명령이에요.';
    ack(r ? { ok: false, reason: r } : { ok: true });
  });

  socket.on('adminHsInfo', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const hosts = sessions
      .all()
      .filter((s) => s.admin && plaza.has(s.playerId))
      .map((s) => ({ id: s.playerId, nickname: plaza.get(s.playerId)!.nickname, online: plaza.get(s.playerId)!.status === 'online' }));
    ack({ ok: true, state: hs.adminState(), hosts, hostId: hs.hostId });
  });

  // ---------------------------------------------------------------- 우수 PAIR 가챠 · 오늘의 행운 추첨 · 무대

  const done = (ack: (r: { ok: true } | { ok: false; reason: string }) => void, r: string | null) => ack(r ? { ok: false, reason: r } : { ok: true });

  socket.on('adminPairInfo', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    ack(stage.pairInfo());
  });

  socket.on('adminPair', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const op = payload?.op;
    const teamId = 'teamId' in (payload ?? {}) ? String((payload as { teamId: unknown }).teamId) : '';
    if (op === 'save') return done(ack, stage.saveTeams((payload as { teams: unknown }).teams));
    if (op === 'select') return done(ack, stage.selectTeam(teamId));
    if (op === 'draw') return done(ack, stage.drawTeam(teamId));
    if (op === 'redraw') return done(ack, stage.redrawTeam(teamId));
    if (op === 'reset') return done(ack, stage.resetPair());
    if (op === 'summary') return done(ack, stage.pairSummary());
    done(ack, '알 수 없는 요청이에요.');
  });

  socket.on('adminLuckyInfo', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    ack(stage.luckyInfo());
  });

  socket.on('adminLucky', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const op = payload?.op;
    if (op === 'exclude') {
      stage.setExcludeHs(!!(payload as { value: unknown }).value);
      return done(ack, null);
    }
    if (op === 'ready') return done(ack, stage.luckyReady());
    if (op === 'draw') return done(ack, stage.luckyDraw());
    if (op === 'reveal') return done(ack, stage.luckyReveal());
    if (op === 'summary') return done(ack, stage.luckySummary());
    done(ack, '알 수 없는 요청이에요.');
  });

  socket.on('adminStage', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    if (payload?.op === 'clear') stage.clear();
    done(ack, null);
  });

  // ---------------------------------------------------------------- 과제 괴물 레이드

  socket.on('raidJoin', (ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    if (hs.active) return ack({ ok: false, reason: '숨바꼭질이 끝난 뒤에 참여할 수 있어요.' });
    done(ack, raid.join(m.session.playerId));
  });

  socket.on('raidLeave', () => {
    const m = me(socket);
    if (m) raid.leave(m.session.playerId);
  });

  socket.on('ri', (inp) => {
    const m = me(socket);
    if (!m || !inp || typeof inp !== 'object') return;
    const a = inp.a;
    raid.input(m.session.playerId, {
      x: typeof inp.x === 'number' ? inp.x : undefined,
      y: typeof inp.y === 'number' ? inp.y : undefined,
      d: typeof inp.d === 'number' ? inp.d : undefined,
      a: a === 'atk' || a === 'dodge' || a === 'revive' || a === 'final' ? a : undefined,
    });
  });

  socket.on('adminRaid', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const op = payload?.op;
    if (op !== 'open' && op !== 'close' && hs.active) return done(ack, '숨바꼭질이 진행 중이에요.');
    if (op === 'open') {
      if (hs.active) return done(ack, '숨바꼭질이 끝난 뒤에 열 수 있어요.');
      return done(ack, raid.open());
    }
    if (op === 'start') return done(ack, raid.start());
    if (op === 'pause') return done(ack, raid.pause());
    if (op === 'resume') return done(ack, raid.resume());
    if (op === 'stop') return done(ack, raid.stop());
    if (op === 'reset') return done(ack, raid.restart());
    if (op === 'awards') return done(ack, raid.beginAwards());
    if (op === 'next') return done(ack, raid.next());
    if (op === 'prev') return done(ack, raid.prev());
    if (op === 'allAwards') return done(ack, raid.all());
    if (op === 'close') {
      raid.close();
      return done(ack, null);
    }
    if (op === 'debugCalm' && !IS_PROD) {
      raid.debugCalm();
      return done(ack, null);
    }
    if (op === 'debugDown' && !IS_PROD) {
      raid.debugDown(Number(payload.id));
      return done(ack, null);
    }
    if (op === 'debugHp' && !IS_PROD) {
      raid.debugSetHp(Number(payload.ratio));
      return done(ack, null);
    }
    done(ack, '알 수 없는 요청이에요.');
  });

  socket.on('adminRaidInfo', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    ack(raid.adminInfo());
  });

  // ---------------------------------------------------------------- 상품

  socket.on('adminPrizes', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    ack(prizes.summary());
  });

  socket.on('adminPrizeSet', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    let r: string | null = '알 수 없는 요청이에요.';
    if (payload?.op === 'paid') r = prizes.setPaid(Number(payload.awardId), !!payload.paid);
    if (payload?.op === 'revoke') r = prizes.revoke(Number(payload.awardId));
    if (payload?.op === 'alloc') {
      const a = payload.alloc ?? {};
      r = prizes.setAlloc(String(payload.itemId), Number(payload.total), {
        hideseek: a.hideseek === undefined ? undefined : Number(a.hideseek),
        draw: a.draw === undefined ? undefined : Number(a.draw),
      });
    }
    if (!r) log(`상품 기록 변경: ${payload.op}`);
    ack(r ? { ok: false, reason: r } : { ok: true });
  });

  // ---------------------------------------------------------------- 이스터에그 · 칭호

  socket.on('myTitles', (ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    ack(m ? eggs.titlesOf(m.session.ownerKey) : { owned: [], equipped: null });
  });

  socket.on('setTitle', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const m = me(socket);
    if (!m) return ack(NOT_IN);
    const id = payload?.id ?? null;
    if (id !== null && !EGG_IDS.includes(id)) return ack({ ok: false, reason: '알 수 없는 칭호예요.' });
    const r = eggs.equip(m.session.ownerKey, id);
    if (r) return ack({ ok: false, reason: r });
    plaza.patch(m.info.id, { title: id });
    ack({ ok: true });
  });

  socket.on('adminEggs', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    ack(eggs.adminRows());
  });

  socket.on('adminEggSet', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const id = payload?.id;
    if (!id || !EGG_IDS.includes(id)) return ack({ ok: false, reason: '이스터에그를 찾을 수 없어요.' });
    if (payload.reset) {
      const owner = eggs.reset(id);
      // 칭호를 회수당한 참가자가 접속 중이면 이름표 갱신
      if (owner)
        for (const s of sessions.all()) if (s.ownerKey === owner && plaza.has(s.playerId)) plaza.patch(s.playerId, { title: eggs.equipped(owner) });
      log(`이스터에그 기록 초기화: ${EGG_BY_ID.get(id)?.title}`);
      return ack({ ok: true });
    }
    const r = eggs.set(id, {
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : undefined,
      need: payload.need === undefined ? undefined : Number(payload.need),
      broadcast: typeof payload.broadcast === 'boolean' ? payload.broadcast : undefined,
    });
    ack(r ? { ok: false, reason: r } : { ok: true });
  });

  socket.on('adminPlayers', (ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack([]);
    ack(
      plaza.snapshot().players.map((p) => {
        const s = sessions.byPlayer(p.id);
        return { ...p, muted: !!s && settings.isMuted(s.ownerKey), ownerKey: s?.ownerKey.slice(0, 8) ?? '' };
      }),
    );
  });

  socket.on('adminSetTeam', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const id = Number(payload?.id);
    const team = Number(payload?.team);
    const s = sessions.byPlayer(id);
    if (!s || !plaza.has(id) || !(team === -1 || TEAMS.some((t) => t.id === team))) return ack({ ok: false, reason: '참가자를 찾을 수 없어요.' });
    settings.data.teamOverrides[s.ownerKey] = team;
    settings.save();
    plaza.patch(id, { team });
    ack({ ok: true });
  });

  socket.on('adminMute', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const id = Number(payload?.id);
    const s = sessions.byPlayer(id);
    if (!s) return ack({ ok: false, reason: '참가자를 찾을 수 없어요.' });
    settings.setMuted(s.ownerKey, !!payload?.muted);
    plaza.hooks.emitTo(id, 'muted', !!payload?.muted);
    ack({ ok: true });
  });

  socket.on('adminNotice', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const text = sanitizeText(payload?.text, 80);
    if (!text) return ack({ ok: false, reason: '공지 내용을 입력해주세요.' });
    io.to(plaza.channel).emit('notice', text);
    log(`공지: ${text}`);
    ack({ ok: true });
  });

  socket.on('adminDisplay', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const d = settings.data.display;
    for (const k of ['hideNames', 'hideTeams', 'hideBubbles', 'photo'] as (keyof DisplaySettings)[])
      if (typeof payload?.[k] === 'boolean') d[k] = payload[k]!;
    settings.save();
    io.to(plaza.channel).emit('display', effectiveDisplay());
    ack({ ok: true });
  });

  socket.on('adminTeamNames', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const names = Array.isArray(payload?.names) ? payload.names : [];
    settings.data.teamNames = TEAMS.map((t, i) => sanitizeText(names[i], 8) ?? t.defaultName);
    settings.save();
    io.to(plaza.channel).emit('teamNames', settings.data.teamNames);
    ack({ ok: true });
  });

  socket.on('adminBoard', (ack) => {
    if (typeof ack !== 'function') return;
    ack(isAdmin() ? board.adminList() : []);
  });

  socket.on('adminDeleteNote', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const id = Number(payload?.id);
    const r = board.remove(id, null);
    if (r !== true) return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('bd', id);
    log(`학회장이 쪽지 #${id} 삭제`);
    ack({ ok: true });
  });

  socket.on('adminDeleteComment', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!isAdmin()) return ack(NO_AUTH);
    const id = Number(payload?.id);
    const r = board.removeComment(id, null);
    if (typeof r === 'string') return ack({ ok: false, reason: r });
    io.to(plaza.channel).emit('cdel', r.noteId, id);
    const n = board.note(r.noteId);
    if (n) io.to(plaza.channel).emit('bu', n);
    ack({ ok: true });
  });

  socket.on('leave', () => leave(socket));

  socket.on('disconnect', () => {
    const token = socket.data.token;
    if (!token || socket.data.replaced) return;
    const session = sessions.get(token);
    if (!session || session.socketId !== socket.id) return;
    session.socketId = null;
    plaza.releaseAll(session.playerId); // 좌석·놀이기구·따라가기 즉시 정리
    plaza.setStatus(session.playerId, 'away');
    hs.onHostAway(session.playerId);
    sessions.startGrace(session, GRACE_MS, () => {
      hs.onHostGone(session.playerId);
      raid.removePlayer(session.playerId);
      plaza.removePlayer(session.playerId, 'timeout');
      log(`연결 종료: ${session.nickname} (#${session.playerId})`);
    });
  });
});

function log(msg: string) {
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false, timeZone: 'Asia/Seoul' });
  console.log(`[${t}] ${msg}`);
}

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  짝선짝후 아지트 서버가 시작됐어요!');
  console.log(`  - 이 컴퓨터: http://localhost:${PORT}${IS_PROD ? '' : '  (개발 모드 화면은 http://localhost:5173)'}`);
  if (IS_PROD) for (const u of lanUrls(PORT)) console.log(`  - 같은 Wi-Fi: ${u}`);
  if (PUBLIC_URL) console.log(`  - 공개 주소: ${PUBLIC_URL}`);
  if (ADMIN_FROM_ENV) console.log('  - 학회장 페이지: /admin (ADMIN_PASSWORD 환경변수의 비밀번호)');
  else console.log(`  - 학회장 페이지: /admin  임시 비밀번호: ${ADMIN_PASSWORD}  (재시작하면 바뀜 — ADMIN_PASSWORD 를 설정하세요)`);
  console.log('');
});

function shutdown() {
  plaza.stop();
  board.flush();
  settings.flush();
  prizes.flush();
  eggs.flush();
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
