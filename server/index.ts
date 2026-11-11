/**
 * 짝선짝후 아지트 — 실시간 서버
 *  - HTTP: 빌드된 클라이언트 정적 파일, /api/info, 운영자 로그인·CSV 내보내기
 *  - WebSocket(Socket.IO): 입장·재접속·이동·음식·온천·좌석·놀이기구·채팅·게시판·운영자 기능
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
import { TEAMS } from '../shared/social';
import { BoardStore, type Author } from './BoardStore';
import { PlazaRoom } from './rooms/PlazaRoom';
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

// 운영자 비밀번호: 환경변수가 없으면 서버가 켜질 때마다 임시 비밀번호를 만들어 로그에 표시
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD ?? '').trim() || randomBytes(4).toString('hex');
const ADMIN_FROM_ENV = !!(process.env.ADMIN_PASSWORD ?? '').trim();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../dist/client');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ 저장소

const board = new BoardStore(BOARD_FILE);
const settings = new SettingsStore(path.join(DATA_DIR, 'settings.json'));
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

// 운영자 로그인 (IP 당 1분에 8번까지)
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
  log('운영자 로그인');
  res.json({ ok: true, token, expiresAt: now + ADMIN_TTL_MS });
});

app.post('/api/admin/logout', (req, res) => {
  const t = String(req.get('authorization') ?? '').replace(/^Bearer /, '');
  adminTokens.delete(t);
  res.json({ ok: true });
});

app.get('/api/admin/export.csv', (req, res) => {
  const t = String(req.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!adminTokenValid(t)) return res.status(401).send('운영자 로그인이 필요해요.');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jjak-azit-board-${stamp}.csv"`);
  res.send(board.toCSV());
});

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
  display: () => settings.data.display,
  teamNames: () => settings.data.teamNames,
};
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
  socket.join(plaza.channel);
  plaza.setStatus(session.playerId, 'online');
}

function leave(socket: IOSocket) {
  const token = socket.data.token;
  if (!token) return;
  const session = sessions.get(token);
  socket.data.token = undefined;
  socket.leave(plaza.channel);
  if (!session) return;
  sessions.delete(token);
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

const NO_AUTH = { ok: false as const, reason: '운영자 로그인이 필요해요.' };
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
    };
    const session = sessions.create(randomUUID(), info.id, profile.nickname, ownerKey);
    plaza.addPlayer(info);
    attach(socket, session);
    log(
      `입장: ${info.nickname} (#${info.id}, ${info.grade ? info.grade + '학년' : info.gradeText || '기타'} ${info.role === 'senior' ? '선배' : '후배'}) · 접속 ${plaza.onlineCount}명`,
    );
    const res: JoinResult = { ok: true, selfId: info.id, token: session.token, room: plaza.snapshot(), muted: settings.isMuted(ownerKey) };
    ack(res);
  });

  socket.on('resume', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const token = typeof payload?.token === 'string' ? payload.token : '';
    const session = sessions.get(token);
    if (!session || !plaza.has(session.playerId)) return ack({ ok: false, reason: 'expired' });
    attach(socket, session);
    ack({ ok: true, selfId: session.playerId, token: session.token, room: plaza.snapshot(), muted: settings.isMuted(session.ownerKey) });
  });

  socket.on('spectate', (ack) => {
    if (typeof ack !== 'function') return;
    socket.data.spectator = true;
    socket.join(plaza.channel);
    ack({ ok: true, room: plaza.snapshot() });
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
    if (settings.isMuted(m.session.ownerKey)) return ack({ ok: false, reason: '운영자가 글쓰기를 잠시 제한했어요.' });
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
    if (settings.isMuted(m.session.ownerKey)) return ack({ ok: false, reason: '운영자가 글쓰기를 잠시 제한했어요.' });
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

  // ---------------------------------------------------------------- 운영자

  socket.on('adminAuth', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!adminTokenValid(payload?.token)) return ack({ ok: false, reason: '운영자 로그인이 만료됐어요. 다시 로그인해주세요.' });
    socket.data.admin = true;
    socket.data.spectator = true;
    socket.join(plaza.channel);
    ack({ ok: true });
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
    io.to(plaza.channel).emit('display', d);
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
    log(`운영자가 쪽지 #${id} 삭제`);
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
    sessions.startGrace(session, GRACE_MS, () => {
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
  if (ADMIN_FROM_ENV) console.log('  - 운영자 페이지: /admin (ADMIN_PASSWORD 환경변수의 비밀번호)');
  else console.log(`  - 운영자 페이지: /admin  임시 비밀번호: ${ADMIN_PASSWORD}  (재시작하면 바뀜 — ADMIN_PASSWORD 를 설정하세요)`);
  console.log('');
});

function shutdown() {
  plaza.stop();
  board.flush();
  settings.flush();
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
