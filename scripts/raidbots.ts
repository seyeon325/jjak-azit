/**
 * 레이드 리허설용 가상 참가자: npx tsx scripts/raidbots.ts [인원=12] [주소=http://localhost:3000]
 *  - 아지트에 입장 → 레이드 대기실이 열리면 참여 → 돌아다니며 공격·회피·부활·협동·최후의 제출
 *  - 운영자 화면에서 대기실 열기 → 전투 시작만 누르면 30명 규모 흐름을 미리 볼 수 있어요.
 * Ctrl+C 로 종료.
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, JoinResult, ServerToClientEvents } from '../shared/protocol';
import { RAID, type RaidState } from '../shared/raid';

const COUNT = Number(process.argv[2] ?? 12);
const URL = process.argv[3] ?? 'http://localhost:3000';
type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const NAMES = ['도토리', '말랑', '모카', '구름', '보리', '콩떡', '자두', '호두', '라떼', '쿠키', '감자', '우유', '푸딩', '단비', '하늘', '새싹', '별님', '솜솜', '꿀떡', '나무', '바다', '토리', '민트', '체리', '초코', '두부', '찹쌀', '귤귤', '복숭', '사과'];

async function bot(i: number) {
  const s: S = io(URL, { transports: ['websocket'], forceNew: true });
  await new Promise<void>((r) => s.on('connect', () => r()));
  const profile = { nickname: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`, role: i % 3 === 0 ? ('senior' as const) : ('junior' as const), grade: ((i % 4) + 1) as 1, look: i % 12, color: 0 };
  const res = await new Promise<JoinResult>((r) => s.emit('join', { profile, uid: randomUUID() }, r));
  if (!res.ok) return console.log('입장 실패', res.reason);
  const me = res.selfId;
  let st: RaidState | null = null;
  let joined = false;
  let x = 0;
  let y = 0;
  let tx = 0;
  let ty = 0;
  s.on('raid', (r) => {
    st = r;
    const p = r.players.find((q) => q[0] === me);
    if (p && (Math.hypot(p[1] - x, p[2] - y) > 30 || (x === 0 && y === 0))) {
      x = p[1];
      y = p[2];
    }
    if (r.phase === 'lobby' && !joined) {
      joined = true;
      setTimeout(() => s.emit('raidJoin', () => {}), 200 + Math.random() * 2000);
    }
    if (r.phase === 'off') joined = false;
  });
  setInterval(() => {
    const r = st;
    if (!r || r.phase !== 'battle' || r.paused) return;
    const p = r.players.find((q) => q[0] === me);
    if (!p) return;
    if (p[4] === 1) {
      if (Math.random() < 0.08) s.emit('ri', { a: 'help' }); // 쓰러지면 '살려줘!'
      return;
    }
    // 목표: 협동 구역 > 경고 구역 피하기 > 보스 근처 배회
    const zone = r.zones.find((z) => !z.on);
    const danger = r.hazards.find((h) => (h.shape === 'circle' ? Math.hypot(x - h.x, y - h.y) < h.r + 4 : x > h.x - 4 && x < h.x + h.w + 4 && y > h.y - 4 && y < h.y + h.h + 4));
    if (danger && Math.random() < 0.7) {
      tx = danger.shape === 'circle' ? x + (x - danger.x) * 2 : danger.x < RAID.W / 2 ? RAID.W * 0.75 : RAID.W * 0.25;
      ty = danger.shape === 'circle' ? y + (y - danger.y) * 2 : y;
      if (danger.hitAt - Date.now() < 300 && Math.random() < 0.5) s.emit('ri', { a: 'dodge' });
    } else if (zone && i % 2 === 0) {
      tx = zone.x + (Math.random() - 0.5) * 20;
      ty = zone.y + (Math.random() - 0.5) * 20;
    } else if (Math.hypot(tx - x, ty - y) < 6 || Math.random() < 0.02) {
      tx = RAID.bossX + (Math.random() - 0.5) * 300;
      ty = RAID.bossY + 60 + Math.random() * 120;
    }
    tx = Math.max(12, Math.min(RAID.W - 12, tx));
    ty = Math.max(44, Math.min(RAID.H - 10, ty));
    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const step = Math.min(7.5, d);
      const nx = x + (dx / d) * step;
      const ny = y + (dy / d) * step;
      if (Math.hypot(nx - RAID.bossX, (ny - RAID.bossY) * 1.3) >= RAID.bossR + 2) {
        x = nx;
        y = ny;
      } else tx = x + (Math.random() - 0.5) * 80;
      s.emit('ri', { x, y, d: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0 });
    }
    if (Math.random() < 0.3) s.emit('ri', { a: 'atk' });
    if (r.final && Math.random() < 0.2) s.emit('ri', { a: 'final' });
    if (r.players.some((q) => q[4] === 1 && Math.hypot(q[1] - x, q[2] - y) < RAID.reviveR)) s.emit('ri', { a: 'revive' });
  }, 100);
}

for (let i = 0; i < COUNT; i++) await bot(i);
console.log(`레이드 연습 참가자 ${COUNT}명 입장 (대기실이 열리면 자동 참여)`);
