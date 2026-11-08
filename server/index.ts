/**
 * 짝선짝후 아지트 — 실시간 서버
 *  - HTTP: 빌드된 클라이언트 정적 파일 + /api/info
 *  - WebSocket(Socket.IO): 입장·재접속·이동 동기화
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { ClientToServerEvents, JoinResult, PlayerInfo, ServerToClientEvents } from '../shared/protocol';
import { PlazaRoom } from './rooms/PlazaRoom';
import { SessionStore, type Session } from './sessions';
import { parseMove, sanitizeProfile } from './validation';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL ?? '').trim().replace(/\/$/, '');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 60);
const GRACE_MS = Number(process.env.RECONNECT_GRACE_SEC ?? 45) * 1000;
const IS_PROD = process.env.NODE_ENV === 'production';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../dist/client');

// ------------------------------------------------------------------ HTTP

const app = express();
app.disable('x-powered-by');

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
app.get('/api/info', (req, res) => {
  // 개발 모드에서는 Vite(5173) 주소를 안내해야 휴대폰에서 바로 열립니다.
  const devPort = Number(req.get('x-forwarded-port') ?? '') || (IS_PROD ? PORT : 5173);
  res.json({
    publicUrl: PUBLIC_URL || null,
    lanUrls: lanUrls(IS_PROD ? PORT : devPort),
    players: plaza.onlineCount,
  });
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

type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
interface SocketData {
  token?: string;
  spectator?: boolean;
  replaced?: boolean;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 16_000,
  cors: IS_PROD ? undefined : { origin: true },
});

const plaza = new PlazaRoom(io);
plaza.start();
const sessions = new SessionStore();
let nextPlayerId = 1;

function attach(socket: IOSocket, session: Session) {
  // 같은 세션으로 다른 탭/기기가 이미 붙어 있다면 그 연결을 정리
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

io.on('connection', (rawSocket) => {
  const socket = rawSocket as IOSocket;

  socket.on('join', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const profile = sanitizeProfile(payload?.profile);
    if ('error' in profile) return ack({ ok: false, reason: profile.error });
    if (socket.data.token) leave(socket);
    if (plaza.size >= MAX_PLAYERS) return ack({ ok: false, reason: '아지트가 가득 찼어요. 잠시 후 다시 시도해주세요.' });

    const hint = payload?.pos;
    const spawn =
      hint && Number.isFinite(hint.x) && Number.isFinite(hint.y) && plaza.isWalkable(hint.x, hint.y)
        ? { x: Math.round(hint.x), y: Math.round(hint.y) }
        : plaza.spawnPoint();
    const info: PlayerInfo = {
      ...profile,
      id: nextPlayerId++,
      x: spawn.x,
      y: spawn.y,
      dir: 0,
      moving: false,
      status: 'online',
      joinedAt: Date.now(),
    };
    const session = sessions.create(randomUUID(), info.id, profile.nickname);
    plaza.addPlayer(info);
    attach(socket, session);
    log(`입장: ${info.nickname} (#${info.id}, ${info.role === 'senior' ? '선배' : '후배'}) · 접속 ${plaza.onlineCount}명`);
    const res: JoinResult = { ok: true, selfId: info.id, token: session.token, room: plaza.snapshot() };
    ack(res);
  });

  socket.on('resume', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const token = typeof payload?.token === 'string' ? payload.token : '';
    const session = sessions.get(token);
    if (!session || !plaza.has(session.playerId)) return ack({ ok: false, reason: 'expired' });
    attach(socket, session);
    log(`복귀: ${session.nickname} (#${session.playerId})`);
    ack({ ok: true, selfId: session.playerId, token: session.token, room: plaza.snapshot() });
  });

  socket.on('spectate', (ack) => {
    if (typeof ack !== 'function') return;
    socket.data.spectator = true;
    socket.join(plaza.channel);
    ack({ ok: true, room: plaza.snapshot() });
  });

  socket.on('m', (raw) => {
    const token = socket.data.token;
    if (!token) return;
    const session = sessions.get(token);
    const input = parseMove(raw);
    if (!session || !input) return;
    const fix = plaza.handleMove(session.playerId, input);
    if (fix) socket.emit('cx', fix.x, fix.y);
  });

  socket.on('leave', () => leave(socket));

  socket.on('disconnect', () => {
    const token = socket.data.token;
    if (!token || socket.data.replaced) return;
    const session = sessions.get(token);
    if (!session || session.socketId !== socket.id) return;
    session.socketId = null;
    plaza.setStatus(session.playerId, 'away');
    sessions.startGrace(session, GRACE_MS, () => {
      plaza.removePlayer(session.playerId, 'timeout');
      log(`연결 종료: ${session.nickname} (#${session.playerId})`);
    });
  });
});

function log(msg: string) {
  const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  console.log(`[${t}] ${msg}`);
}

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  짝선짝후 아지트 서버가 시작됐어요!');
  console.log(`  - 이 컴퓨터: http://localhost:${PORT}${IS_PROD ? '' : '  (개발 모드 화면은 http://localhost:5173)'}`);
  if (IS_PROD) for (const u of lanUrls(PORT)) console.log(`  - 같은 Wi-Fi: ${u}`);
  if (PUBLIC_URL) console.log(`  - 공개 주소: ${PUBLIC_URL}`);
  console.log('');
});

function shutdown() {
  plaza.stop();
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
