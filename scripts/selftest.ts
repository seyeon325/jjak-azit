/**
 * 서버 동작 자동 점검 (npm run selftest [주소])
 * 입장(학년) → 이동 → 끊김/복귀 → 벽 차단 → 푸드트럭(받기·먹기) → 온천(들어가기·이동·나가기) → 게시판 → 퇴장
 */
import { io, type Socket } from 'socket.io-client';
import { FOOT_H } from '../shared/constants';
import { WORLD } from '../shared/map';
import type { ClientToServerEvents, JoinResult, PlayerPatch, ServerToClientEvents } from '../shared/protocol';
import { densify, findPath } from './pathfind';

const URL = process.argv[2] ?? 'http://localhost:3000';
type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const connect = () =>
  new Promise<S>((res) => {
    const s: S = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => res(s));
  });
const wait = <T>(fn: (done: (v: T) => void) => void, ms = 4000, label = '') =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`시간 초과: ${label}`)), ms);
    fn((v) => {
      clearTimeout(t);
      res(v);
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  if (!ok) failed++;
};

const observer = await connect();
const a = await connect();
const joined = await wait<JoinResult>((d) =>
  a.emit('join', { profile: { nickname: '테스트봇', role: 'senior', grade: 3, look: 6, color: 0 } }, d),
);
check(joined.ok, '학년(3학년)과 캐릭터를 골라 입장');
if (!joined.ok) process.exit(1);
const id = joined.selfId;
const me = joined.room.players.find((p) => p.id === id)!;
check(me.grade === 3 && me.role === 'senior' && me.look === 6, '학년·선후배·캐릭터가 따로 저장됨');

const obsJoin = await wait<JoinResult>((d) =>
  observer.emit('join', { profile: { nickname: '관찰자', role: 'junior', grade: 1, look: 0, color: 0 } }, d),
);
const seen = obsJoin.ok ? obsJoin.room.players.find((p) => p.id === id) : undefined;
check(!!seen && seen.grade === 3 && seen.look === 6, '나중에 들어온 참가자에게도 학년·외형이 보임');

// 이전 버전 클라이언트 호환 (학년 없이 입장)
const old = await connect();
const oldJoin = await wait<JoinResult>((d) =>
  old.emit('join', { profile: { nickname: '옛날폰', role: 'junior', look: 2, color: 5 } as never }, d),
);
check(oldJoin.ok && oldJoin.room.players.find((p) => p.id === oldJoin.selfId)?.grade === 0, '학년 정보가 없는 예전 클라이언트도 입장 가능 (기타로 표시)');
old.emit('leave');
old.close();

// 이동 동기화
let pos = { x: me.x, y: me.y };
const moved = wait<boolean>(
  (d) =>
    observer.on('s', (_t, st) => {
      const mine = st.find((s) => s[0] === id);
      if (mine && Math.abs(mine[1] - (pos.x + 4)) < 0.01) d(true);
    }),
  3000,
  '이동 수신',
);
a.emit('m', [pos.x + 4, pos.y, 3, 1]);
check(await moved, '이동이 다른 참가자에게 전달됨');
pos = { x: pos.x + 4, y: pos.y };

// 벽/순간이동 차단
const corr = wait<[number, number]>((d) => a.once('cx', (x, y) => d([x, y])), 2000, '보정');
a.emit('m', [100, 10, 0, 1]);
const [cx] = await corr;
check(Math.abs(cx - pos.x) < 0.01, '벽 안쪽/순간이동 좌표는 서버가 거부하고 보정');

const patches: PlayerPatch[] = [];
observer.on('pu', (pid, patch) => pid === id && patches.push(patch));

/** 실제 플레이어처럼 경로를 따라 걸어가기 */
async function walkTo(tx: number, ty: number, grid = WORLD.collision) {
  const path = findPath(grid, pos.x, pos.y, tx, ty);
  if (!path) return false;
  let bad = false;
  const off = (x: number, y: number) => (bad = true);
  a.on('cx', off);
  for (const p of densify(pos, path, 5)) {
    a.emit('m', [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 0, 1]);
    pos = p;
    await sleep(35);
  }
  a.emit('m', [Math.round(pos.x * 10) / 10, Math.round(pos.y * 10) / 10, 0, 0]);
  await sleep(150);
  a.off('cx', off);
  return !bad;
}

// 푸드트럭
const far = await wait<{ ok: boolean }>((d) => a.emit('act', { t: 'food', food: 'takoyaki' }, d));
check(!far.ok, '푸드트럭에서 멀리 있으면 주문이 거절됨');
const truck = WORLD.spots.foodtruck;
check(await walkTo(truck.x, truck.y + 6), '푸드트럭까지 걸어감 (벽·장애물 충돌 정상)');
const got = await wait<{ ok: boolean }>((d) => a.emit('act', { t: 'food', food: 'takoyaki' }, d));
await sleep(150);
check(got.ok && patches.some((p) => p.food === 'takoyaki'), '타코야끼를 받고, 다른 참가자에게도 들고 있는 모습이 전달됨');
const second = await wait<{ ok: boolean }>((d) => a.emit('act', { t: 'food', food: 'icecream' }, d));
check(!second.ok, '한 번에 하나만 들 수 있음');
const eatSeen = wait<string>((d) => observer.on('pe', (pid, f) => pid === id && d(f)), 2000, '먹기');
a.emit('act', { t: 'eat' }, () => {});
check((await eatSeen) === 'takoyaki', '먹기 연출이 다른 참가자에게 전달됨');
await sleep(2500);
check(patches.some((p) => p.food === null && p.eating === false), '다 먹으면 손에서 사라짐');

// 온천
const sp = WORLD.spots.spring;
check(await walkTo(sp.x, sp.y - 34), '온천 앞까지 걸어감');
patches.length = 0;
const inRes = await wait<{ ok: boolean; reason?: string }>((d) => a.emit('act', { t: 'bath', on: true }, d));
await sleep(150);
const inPatch = patches.find((p) => p.bath === true);
check(inRes.ok && !!inPatch && WORLD.bathGrid.canStand(inPatch.x!, inPatch.y!), '온천 들어가기 → 물 안으로 이동, 모두에게 전달');
if (inPatch) pos = { x: inPatch.x!, y: inPatch.y! };
const bathTarget = WORLD.bathGrid.nearest(sp.x + 20, sp.y, 40)!;
check(await walkTo(bathTarget.x, bathTarget.y, WORLD.bathGrid), '온천 안에서 조금씩 이동 가능');
const landCorr = wait<boolean>((d) => a.once('cx', () => d(true)), 1500, '온천 밖 차단');
a.emit('m', [pos.x, pos.y - 40 - FOOT_H, 1, 1]);
check(await landCorr, '온천에 있는 동안은 물 밖으로 걸어 나갈 수 없음 (나가기 버튼 필요)');
patches.length = 0;
const outRes = await wait<{ ok: boolean }>((d) => a.emit('act', { t: 'bath', on: false }, d));
await sleep(150);
const outPatch = patches.find((p) => p.bath === false);
check(outRes.ok && !!outPatch && WORLD.collision.canStand(outPatch.x!, outPatch.y!), '나가기 → 물가로 나와 다시 걷기 상태');
if (outPatch) pos = { x: outPatch.x!, y: outPatch.y! };

// 잠깐 끊김 → away → 복귀
const away = wait<string>((d) => observer.on('ps', (pid, st) => pid === id && d(st)), 3000, 'away');
a.disconnect();
check((await away) === 'away', '연결이 끊기면 다른 사람에게 "연결 끊김"으로 표시');
const b = await connect();
const back = wait<string>((d) => observer.on('ps', (pid, st) => pid === id && st === 'online' && d(st)), 3000, 'online');
const resumed = await wait<JoinResult>((d) => b.emit('resume', { token: joined.token }, d));
check(resumed.ok && resumed.selfId === id && resumed.room.players.find((p) => p.id === id)?.grade === 3, '새로고침해도 같은 캐릭터·학년으로 복귀');
check((await back) === 'online', '복귀하면 다시 온라인 표시');

// 게시판
const noteText = `자동 점검 쪽지 ${Date.now() % 10000}`;
const noteSeen = wait<string>((d) => observer.on('bn', (n) => n.text === noteText && d(n.text)), 3000, '쪽지');
const posted = await wait<{ ok: boolean }>((d) => b.emit('boardPost', { text: noteText, color: 2 }, d));
check(posted.ok && (await noteSeen) === noteText, '게시판 쪽지 작성 → 다른 참가자에게 실시간 표시');
const spam = await wait<{ ok: boolean }>((d) => b.emit('boardPost', { text: '도배', color: 0 }, d));
check(!spam.ok, '연속 작성은 잠시 제한 (도배 방지)');
const list = await wait<{ text: string; grade: number }[]>((d) => observer.emit('boardList', d));
check(list.some((n) => n.text === noteText && n.grade === 3), '게시판 목록에서 쪽지(학년 포함)를 다시 읽을 수 있음');

// 퇴장
const left = wait<string>((d) => observer.on('pl', (pid, reason) => pid === id && d(reason)), 3000, '퇴장');
b.emit('leave');
check((await left) === 'left', '퇴장하면 모두에게 반영');

observer.emit('leave');
setTimeout(() => {
  observer.close();
  b.close();
  console.log(failed ? `\n${failed}개 항목 실패` : '\n모든 점검 통과!');
  process.exit(failed ? 1 : 0);
}, 200);
