/**
 * 배포 서버 가벼운 점검 (게시판에 쪽지를 남기지 않음)
 *   npx tsx scripts/prodcheck.ts https://jjak-azit.onrender.com
 */
import { io, type Socket } from 'socket.io-client';
import { WORLD } from '../shared/map';
import type { ClientToServerEvents, JoinResult, ServerToClientEvents } from '../shared/protocol';
import { densify, findPath } from './pathfind';

const URL = process.argv[2] ?? 'https://jjak-azit.onrender.com';
type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  if (!ok) failed++;
};

const s: S = io(URL, { transports: ['websocket'], reconnection: false });
await new Promise<void>((r) => s.on('connect', () => r()));
check(true, 'WebSocket 연결');
const res = await new Promise<JoinResult>((r) =>
  s.emit('join', { profile: { nickname: '점검봇', role: 'junior', grade: 2, look: 9, color: 0 } }, r),
);
check(res.ok, '학년·캐릭터로 입장');
if (!res.ok) process.exit(1);
const me = res.room.players.find((p) => p.id === res.selfId)!;
check(me.grade === 2 && me.look === 9 && me.food === null && me.bath === false, '새 필드(학년·음식·온천)가 서버에 반영됨');

const far = await new Promise<{ ok: boolean }>((r) => s.emit('act', { t: 'food', food: 'icecream' }, r));
check(!far.ok, '푸드트럭 멀리서는 주문 거절 (서버 검증 동작)');

let pos = { x: me.x, y: me.y };
const truck = WORLD.spots.foodtruck;
const path = findPath(WORLD.collision, pos.x, pos.y, truck.x, truck.y + 6)!;
for (const p of densify(pos, path, 5)) {
  s.emit('m', [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 0, 1]);
  pos = p;
  await sleep(40);
}
await sleep(300);
const got = await new Promise<{ ok: boolean; reason?: string }>((r) => s.emit('act', { t: 'food', food: 'icecream' }, r));
check(got.ok, '푸드트럭 앞에서 아이스크림 받기');
const ate = await new Promise<{ ok: boolean }>((r) => s.emit('act', { t: 'eat' }, r));
check(ate.ok, '먹기');

const list = await new Promise<{ notes: unknown[] }>((r) => s.emit('boardList', r));
check(Array.isArray(list.notes), `게시판 목록 읽기 (쪽지 ${list.notes.length}개)`);

s.emit('leave');
await sleep(200);
s.close();
console.log(failed ? `\n${failed}개 실패` : '\n배포 서버 점검 통과!');
process.exit(failed ? 1 : 0);
