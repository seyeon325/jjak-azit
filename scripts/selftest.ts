/**
 * 서버 동작 자동 점검 (npm run selftest)
 * 입장 → 이동 동기화 → 잠깐 끊김(away) → 복귀(resume) → 벽 통과 차단 → 퇴장
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, JoinResult, ServerToClientEvents } from '../shared/protocol';

const URL = process.argv[2] ?? 'http://localhost:3000';
type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const connect = () =>
  new Promise<S>((res) => {
    const s: S = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => res(s));
  });
const wait = <T>(fn: (done: (v: T) => void) => void, ms = 3000, label = '') =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`시간 초과: ${label}`)), ms);
    fn((v) => {
      clearTimeout(t);
      res(v);
    });
  });
let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  if (!ok) failed++;
};

const observer = await connect();
const a = await connect();
const joined = await wait<JoinResult>((d) =>
  a.emit('join', { profile: { nickname: '테스트봇', role: 'senior', look: 1, color: 2 } }, d),
);
check(joined.ok, '입장 성공');
if (!joined.ok) process.exit(1);
const id = joined.selfId;
const me = joined.room.players.find((p) => p.id === id)!;

const obsJoin = await wait<JoinResult>((d) =>
  observer.emit('join', { profile: { nickname: '관찰자', role: 'junior', look: 0, color: 0 } }, d),
);
check(obsJoin.ok && obsJoin.room.players.some((p) => p.id === id), '나중에 들어온 참가자도 기존 참가자를 봄');

// 이동 동기화
const moved = wait<boolean>((d) =>
  observer.on('s', (_t, st) => {
    const mine = st.find((s) => s[0] === id);
    if (mine && Math.abs(mine[1] - (me.x + 4)) < 0.01) d(true);
  }),
3000, '이동 수신');
a.emit('m', [me.x + 4, me.y, 3, 1]);
check(await moved, '이동이 다른 참가자에게 전달됨');

// 벽/순간이동 차단
const corr = wait<[number, number]>((d) => a.once('cx', (x, y) => d([x, y])), 2000, '보정');
a.emit('m', [100, 10, 0, 1]); // 건물 벽 안쪽
const [cx] = await corr;
check(Math.abs(cx - (me.x + 4)) < 0.01, '벽 안쪽/순간이동 좌표는 서버가 거부하고 보정');

// 잠깐 끊김 → away
const away = wait<string>((d) => observer.on('ps', (pid, st) => pid === id && d(st)), 3000, 'away');
a.disconnect();
check((await away) === 'away', '연결이 끊기면 다른 사람에게 "연결 끊김"으로 표시');

// 복귀
const b = await connect();
const back = wait<string>((d) => observer.on('ps', (pid, st) => pid === id && st === 'online' && d(st)), 3000, 'online');
const resumed = await wait<JoinResult>((d) => b.emit('resume', { token: joined.token }, d));
check(resumed.ok && resumed.ok && resumed.selfId === id, '토큰으로 같은 캐릭터에 복귀 (새로고침 대응)');
check((await back) === 'online', '복귀하면 다시 온라인 표시');

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
