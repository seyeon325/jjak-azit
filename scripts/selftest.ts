/**
 * 서버 동작 자동 점검 (npm run selftest [주소])
 * 여러 개의 실제 소켓 클라이언트가 동시에 접속해 기능과 동기화를 확인합니다.
 *  1차: 입장·학년·이동·벽·끊김/복귀·퇴장
 *  1차 수정: 푸드트럭·온천
 *  2차: 게시판(익명·수정·삭제·댓글·하트·소유권) · 채팅(일반/모닥불/벤치) · 좌석 · 그네·미끄럼틀·시소
 *       · 이모티콘·포즈·장난 · 요청 · 운영자 권한
 * 운영자 점검은 ADMIN_PASSWORD (개발 기본값 azit-dev) 로 로그인합니다.
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { WORLD } from '../shared/map';
import type { EggAdminRow, HsState, LuckyInfo, MyTitles, PairInfo, PrizeSummary, StageState } from '../shared/events';
import type { AdminHsInfo, ChatMessage, ClientToServerEvents, FxEvent, JoinResult, PlayerPatch, Profile, RoomSnapshot, ServerToClientEvents } from '../shared/protocol';
import { densify, findPath } from './pathfind';
import { RAID, type RaidAdminInfo, type RaidFx, type RaidState } from '../shared/raid';

const URL = process.argv[2] ?? 'http://localhost:3000';
const ADMIN_PW = process.env.ADMIN_PASSWORD ?? 'azit-dev';
type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let passed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  if (ok) passed++;
  else failed++;
};
const section = (t: string) => console.log(`\n— ${t}`);

function connect(): Promise<S> {
  return new Promise((res) => {
    const s: S = io(URL, { transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => res(s));
  });
}
// ack 요청 헬퍼
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function call<T = any>(s: S, ev: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`응답 없음: ${String(ev)}`)), 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s.emit as any)(ev, ...args, (r: T) => {
      clearTimeout(t);
      res(r);
    });
  });
}
function waitFor<T>(fn: (done: (v: T) => void) => void, ms = 4000, label = ''): Promise<T | null> {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    fn((v) => {
      clearTimeout(t);
      res(v);
    });
    void label;
  });
}

interface Bot {
  s: S;
  id: number;
  token: string;
  uid: string;
  pos: { x: number; y: number };
  patches: PlayerPatch[];
  chats: ChatMessage[];
  fx: FxEvent[];
}

async function joinBot(nickname: string, extra: Partial<Profile> = {}, uid: string = randomUUID()): Promise<Bot> {
  const s = await connect();
  const r = await call<JoinResult>(s, 'join', { profile: { nickname, role: 'junior', grade: 1, look: 0, color: 0, ...extra }, uid });
  if (!r.ok) throw new Error(`입장 실패: ${r.reason}`);
  const me = r.room.players.find((p) => p.id === r.selfId)!;
  const b: Bot = { s, id: r.selfId, token: r.token, uid, pos: { x: me.x, y: me.y }, patches: [], chats: [], fx: [] };
  s.on('pu', (id, p) => {
    if (id === b.id) {
      b.patches.push(p);
      if (p.x !== undefined && p.y !== undefined) b.pos = { x: p.x, y: p.y };
    }
  });
  s.on('chat', (m) => b.chats.push(m));
  s.on('fx', (e) => b.fx.push(e));
  s.on('cx', (x, y) => (b.pos = { x, y }));
  return b;
}

async function walk(b: Bot, tx: number, ty: number, grid = WORLD.collision) {
  const path = findPath(grid, b.pos.x, b.pos.y, tx, ty);
  if (!path) return false;
  let bad = false;
  const off = () => (bad = true);
  b.s.on('cx', off);
  for (const p of densify(b.pos, path, 5)) {
    b.s.emit('m', [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 0, 1]);
    b.pos = p;
    await sleep(34);
  }
  b.s.emit('m', [Math.round(b.pos.x * 10) / 10, Math.round(b.pos.y * 10) / 10, 0, 0]);
  await sleep(150);
  b.s.off('cx', off);
  return !bad;
}
const seat = (id: string) => WORLD.seats.find((s) => s.id === id)!;
const standNear = (id: string) => {
  const st = seat(id);
  return WORLD.collision.nearest(st.x, st.y + 12, 40)!;
};

// ==================================================================== 1차
section('1차: 입장 · 이동 · 끊김/복귀');
const observer = await joinBot('관찰자', { role: 'senior', grade: 4 });
const a = await joinBot('테스트봇', { role: 'senior', grade: 3, look: 6 });
const seenA = await call<{ notes: unknown[] }>(observer.s, 'boardList');
check(Array.isArray(seenA.notes), '게시판 목록 읽기');
const moved = waitFor<boolean>((d) => observer.s.on('s', (_t, st) => st.some((x) => x[0] === a.id && Math.abs(x[1] - (a.pos.x + 4)) < 0.01) && d(true)));
a.s.emit('m', [a.pos.x + 4, a.pos.y, 3, 1]);
check(!!(await moved), '이동이 다른 참가자에게 전달됨');
a.pos.x += 4;
const corr = waitFor<boolean>((d) => a.s.once('cx', () => d(true)));
a.s.emit('m', [100, 10, 0, 1]);
check(!!(await corr), '벽 안쪽/순간이동 좌표는 서버가 거부');

const old = await connect();
const oldJoin = await call<JoinResult>(old, 'join', { profile: { nickname: '옛날폰', role: 'junior', look: 2, color: 5 } });
check(oldJoin.ok && oldJoin.room.players.find((p) => p.id === oldJoin.selfId)?.grade === 0, '학년 없는 예전 클라이언트도 입장 (기타)');
old.emit('leave');
old.close();

const etc = await joinBot('교수님', { role: 'senior', grade: 0, gradeText: '교수', team: 2 });
const etcInfo = (await call<JoinResult>(await connect(), 'resume', { token: etc.token })) as JoinResult;
const etcMe = etcInfo.ok ? etcInfo.room.players.find((p) => p.id === etc.id) : undefined;
check(etcMe?.gradeText === '교수' && etcMe.team === 2, "학년 '기타' 직접 입력(교수)과 팀이 저장·복원됨");
etc.s.close();

const away = waitFor<string>((d) => observer.s.on('ps', (pid, st) => pid === a.id && d(st)));
a.s.disconnect();
check((await away) === 'away', '연결이 끊기면 "연결 끊김" 표시');
const a2 = await connect();
const back = await call<JoinResult>(a2, 'resume', { token: a.token, uid: a.uid });
check(back.ok && back.selfId === a.id, '토큰으로 같은 캐릭터에 복귀');
a.s = a2;
a2.on('pu', (id, p) => {
  if (id === a.id && p.x !== undefined && p.y !== undefined) a.pos = { x: p.x, y: p.y };
});

// ==================================================================== 푸드트럭·온천
section('1차 수정: 푸드트럭 · 온천 (회귀)');
const truck = WORLD.spots.foodtruck;
check(await walk(a, truck.x, truck.y + 6), '푸드트럭까지 걸어감');
check((await call(a.s, 'act', { t: 'food', food: 'takoyaki' })).ok, '타코야끼 받기');
check(!(await call(a.s, 'act', { t: 'food', food: 'icecream' })).ok, '한 번에 하나만');
const eatSeen = waitFor<string>((d) => observer.s.on('pe', (pid, f) => pid === a.id && d(f)));
await call(a.s, 'act', { t: 'eat' });
check((await eatSeen) === 'takoyaki', '먹기 연출 전달');
const sp = WORLD.spots.spring;
await sleep(2300);
check(await walk(a, sp.x, sp.y - 34), '온천 앞까지 걸어감');
const inRes = await call(a.s, 'act', { t: 'bath', on: true });
check(inRes.ok, '온천 들어가기');
const outRes = await call(a.s, 'act', { t: 'bath', on: false });
await sleep(150);
check(outRes.ok && WORLD.collision.canStand(a.pos.x, a.pos.y), '온천 나가기');

// ==================================================================== 게시판 v2
section('2차: 게시판 (익명 · 수정 · 삭제 · 댓글 · 하트 · 소유권)');
const c = await joinBot('씨봇', { grade: 2 });
const d = await joinBot('디봇', { grade: 1 });
const posted = await call(c.s, 'boardPost', { text: '익명으로 쓰는 고마운 마음 '.repeat(5), color: 1, anon: true });
check(posted.ok && posted.note.nickname === '익명' && Array.from(posted.note.text as string).length <= 100, '익명 쪽지 작성 (100자 제한, 이름 대신 익명)');
const noteId: number = posted.note.id;
const listD = await call(d.s, 'boardList');
const seenNote = listD.notes.find((n: { id: number }) => n.id === noteId);
check(seenNote?.nickname === '익명' && seenNote.role === null && !listD.mine.notes.includes(noteId), '다른 사람에게는 익명으로 보이고 내 글로 인식되지 않음');
const listC = await call(c.s, 'boardList');
check(listC.mine.notes.includes(noteId), '작성자 본인에게는 내 글로 인식');
check(!(await call(d.s, 'boardEdit', { id: noteId, text: '해킹' })).ok, '다른 사람은 수정 불가');
check(!(await call(d.s, 'boardDelete', { id: noteId })).ok, '다른 사람은 삭제 불가');
const upd = waitFor<string>((dn) => observer.s.on('bu', (n) => n.id === noteId && n.editedAt && dn(n.text)));
check((await call(c.s, 'boardEdit', { id: noteId, text: '수정한 쪽지' })).ok && (await upd) === '수정한 쪽지', '본인 수정 → 실시간 반영');
const l1 = await call(d.s, 'boardLike', { id: noteId });
const l2 = await call(d.s, 'boardLike', { id: noteId });
const l3 = await call(d.s, 'boardLike', { id: noteId });
check(l1.likes === 1 && l2.likes === 0 && l3.likes === 1, '하트: 1인 1회, 다시 누르면 취소');
// 같은 기기 키로 두 번 접속해도 하트는 하나
const d2 = await joinBot('디봇2', {}, d.uid);
const l4 = await call(d2.s, 'boardLike', { id: noteId });
check(l4.likes === 0, '같은 사용자가 여러 창에서 눌러도 공감 수가 늘지 않음');
d2.s.emit('leave');
const cm = await call(d.s, 'commentPost', { noteId, text: '<b>멋져요</b>' });
check(cm.ok && cm.comment.text === '<b>멋져요</b>', '댓글 작성 (HTML은 글자로만 저장·표시)');
const comments = await call(c.s, 'boardComments', { id: noteId });
check(comments.comments.length === 1 && comments.mine.length === 0, '상세 화면에서 댓글 확인');
check(!(await call(c.s, 'commentDelete', { id: cm.comment.id })).ok, '남의 댓글은 삭제 불가');
// 재접속(새 세션) 후에도 소유권 유지
c.s.emit('leave');
c.s.close();
const c2 = await joinBot('씨봇', { grade: 2 }, c.uid);
const listC2 = await call(c2.s, 'boardList');
check(listC2.mine.notes.includes(noteId), '다시 입장해도(같은 기기) 익명 글 소유권 유지');
const del = waitFor<number>((dn) => observer.s.on('bd', (id) => id === noteId && dn(id)));
check((await call(c2.s, 'boardDelete', { id: noteId })).ok && (await del) === noteId, '본인 삭제 → 실시간 반영');
const after = await call(d.s, 'boardComments', { id: noteId });
check(after.comments.length === 0, '삭제한 쪽지의 댓글도 함께 정리');

// ==================================================================== 채팅
section('2차: 채팅 (일반 · 모닥불 · 벤치)');
observer.chats.length = 0;
check((await call(c2.s, 'chat', { ch: 'all', text: '안녕하세요' })).ok, '일반 채팅 보내기');
await sleep(200);
check(observer.chats.some((m) => m.text === '안녕하세요' && m.ch === 'all'), '일반 채팅은 모두에게 전달');
check(!(await call(c2.s, 'chat', { ch: 'fire', text: '불멍' })).ok, '모닥불 밖에서는 모닥불 채팅 불가');
const fire = WORLD.spots.campfire;
check(await walk(c2, fire.x - 20, fire.y + 26), '모닥불로 이동');
check(await walk(d, fire.x + 20, fire.y + 26), '두 번째 참가자도 모닥불로');
observer.chats.length = 0;
d.chats.length = 0;
check((await call(c2.s, 'chat', { ch: 'fire', text: '불멍 좋다' })).ok, '모닥불 채팅 보내기');
await sleep(250);
check(d.chats.some((m) => m.ch === 'fire'), '모닥불 안 참가자는 받음');
check(!observer.chats.some((m) => m.ch === 'fire'), '모닥불 밖 참가자는 받지 못함');
const q1 = await call(c2.s, 'fireQuestion', { next: false });
const qSeen = waitFor<string>((dn) => d.s.on('fireQ', (q) => dn(q)));
const q2 = await call(c2.s, 'fireQuestion', { next: true });
check(!!q1.question && q2.question !== q1.question && (await qSeen) === q2.question, '랜덤 질문 새로고침이 모닥불 참가자에게 공유');

// 벤치
const bench = standNear('bench2-0');
check(await walk(c2, bench.x, bench.y), '벤치로 이동');
check(await walk(d, bench.x + 10, bench.y), '두 번째 참가자도 벤치로');
check((await call(c2.s, 'act', { t: 'sit', seat: 'bench2-0' })).ok, '벤치 왼쪽 자리 앉기');
check(!(await call(d.s, 'act', { t: 'sit', seat: 'bench2-0' })).ok, '이미 앉은 자리는 앉을 수 없음');
check((await call(d.s, 'act', { t: 'sit', seat: 'bench2-1' })).ok, '옆자리 앉기');
observer.chats.length = 0;
d.chats.length = 0;
check((await call(c2.s, 'chat', { ch: 'bench', text: '우리끼리 얘기' })).ok, '벤치 2인 채팅 보내기');
await sleep(250);
check(d.chats.some((m) => m.ch === 'bench' && m.text === '우리끼리 얘기'), '옆자리 사람은 받음');
check(!observer.chats.some((m) => m.ch === 'bench'), '다른 사람(관전 포함)은 받지 못함');
const stand = await call(d.s, 'act', { t: 'stand' });
check(stand.ok && !(await call(c2.s, 'chat', { ch: 'bench', text: '혼자' })).ok, '한 명이 일어나면 벤치 대화 종료');
// 연결 끊김 → 좌석 정리
const freed = waitFor<boolean>((dn) => observer.s.on('pu', (id, p) => id === c2.id && p.seat === null && dn(true)));
c2.s.disconnect();
check(!!(await freed), '연결이 끊기면 좌석 자동 정리');

// ==================================================================== 놀이터
section('2차: 놀이터 (그네 · 밀기 · 미끄럼틀 · 시소)');
const e = await joinBot('이봇');
const swingStand = standNear('swing-0');
check(await walk(e, swingStand.x, swingStand.y), '그네 앞으로 이동');
check((await call(e.s, 'act', { t: 'sit', seat: 'swing-0' })).ok, '그네 타기');
check(await walk(d, swingStand.x + 8, swingStand.y + 4), '밀어줄 사람도 그네 앞으로');
e.s.emit('setPref', { noPrank: true });
await sleep(150);
check(!(await call(d.s, 'act', { t: 'push', seat: 'swing-0' })).ok, '탑승자가 장난을 거부하면 밀기 불가');
e.s.emit('setPref', { noPrank: false });
await sleep(150);
const launched = waitFor<FxEvent>((dn) => observer.s.on('fx', (f) => f.kind === 'launch' && f.to === e.id && dn(f)), 8000);
const amps: number[] = [];
observer.s.on('swing', (sid, st) => sid === 'swing-0' && amps.push(st.amp));
for (let i = 0; i < 5; i++) {
  await call(d.s, 'act', { t: 'push', seat: 'swing-0' });
  await sleep(700);
}
check(amps.length >= 3 && amps[2] > amps[1] && amps[1] > amps[0], '밀 때마다 그네 진폭이 커짐 (진자 상태 동기화)');
const pushedBehind = d.pos.y < seat('swing-0').y;
check(pushedBehind, '밀어주는 사람은 그네 뒤쪽 자리로 이동해 밂');
const lf = await launched;
await sleep(150);
check(!!lf && WORLD.collision.canStand(e.pos.x, e.pos.y), "5번 밀면 '퐁!' 튀어나와 땅에 착지 (피해 없음)");
check(!(await call(d.s, 'act', { t: 'push', seat: 'swing-0' })).ok, '빈 그네는 밀 수 없음');

const sl = WORLD.slide;
check(await walk(d, sl.enter.x, sl.enter.y), '미끄럼틀 계단 앞으로');
const slideFx = waitFor<boolean>((dn) => observer.s.on('fx', (f) => f.kind === 'slide' && f.from === d.id && dn(true)));
check((await call(d.s, 'act', { t: 'slide' })).ok && !!(await slideFx), '미끄럼틀 타기 → 모두에게 연출');
await sleep(2900);
check(Math.hypot(d.pos.x - sl.exit.x, d.pos.y - sl.exit.y) < 2, '다 내려오면 출구에 착지');

const ss0 = standNear('seesaw-0');
const ss1 = standNear('seesaw-1');
check(await walk(e, ss0.x, ss0.y) && (await call(e.s, 'act', { t: 'sit', seat: 'seesaw-0' })).ok, '시소 한쪽 앉기 (대기)');
check(await walk(d, ss1.x, ss1.y) && (await call(d.s, 'act', { t: 'sit', seat: 'seesaw-1' })).ok, '반대쪽 앉기 → 둘이 움직임');
check((await call(e.s, 'act', { t: 'stand' })).ok && (await call(d.s, 'act', { t: 'stand' })).ok, '각자 내리기');

// ==================================================================== 이모티콘·장난·요청
section('2차: 이모티콘 · 포즈 · 플레이어 상호작용');
const emoSeen = waitFor<string>((dn) => observer.s.on('emote', (id, k) => id === d.id && dn(k)));
d.s.emit('emote', 'heart');
check((await emoSeen) === 'heart', '이모티콘 실시간 표시');
const poseSeen = waitFor<string>((dn) => observer.s.on('pose', (id, k) => id === d.id && dn(k)));
d.s.emit('pose', 'dance');
check((await poseSeen) === 'dance', '포즈(춤추기) 실시간 표시');
check(await walk(e, d.pos.x + 14, d.pos.y), '가까이 다가가기');
const ham = await call(e.s, 'interact', { kind: 'hammer', target: d.id });
check(ham.ok, '뿅망치 (가까운 상대)');
check(!(await call(e.s, 'interact', { kind: 'hammer', target: d.id })).ok, '연속 사용은 쿨타임으로 제한');
d.s.emit('setPref', { noPrank: true });
await sleep(150);
check(!(await call(e.s, 'interact', { kind: 'balloon', target: d.id })).ok, '장난 거부 설정이면 물풍선 불가');
check((await call(e.s, 'interact', { kind: 'heart', target: d.id })).ok, '하트 보내기는 장난 거부와 무관하게 가능');
const reqSeen = waitFor<number>((dn) => d.s.on('req', (r) => r.from === e.id && r.kind === 'follow' && dn(r.reqId)));
check((await call(e.s, 'interact', { kind: 'follow', target: d.id })).ok, '따라가기 요청 보내기');
const reqId = await reqSeen;
const followSet = waitFor<boolean>((dn) => observer.s.on('pu', (id, p) => id === e.id && p.followId === d.id && dn(true)));
d.s.emit('respond', { reqId: reqId!, accept: true });
check(!!(await followSet), '상대가 수락하면 따라가기 시작 (동기화)');
const followEnd = waitFor<boolean>((dn) => observer.s.on('pu', (id, p) => id === e.id && p.followId === null && dn(true)));
d.s.emit('unfollow');
check(!!(await followEnd), '따라가지는 쪽도 언제든 취소 가능');
const far = await joinBot('멀리봇');
check(!(await call(far.s, 'interact', { kind: 'hammer', target: d.id })).ok, '멀리 있으면 상호작용 불가 (거리 검증)');

// ==================================================================== 운영자
section('2차: 운영자 권한');
check(!(await call(far.s, 'adminSetTeam', { id: d.id, team: 1 })).ok, '일반 참가자는 운영자 기능 불가');
const bad = await fetch(`${URL}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
check(bad.status === 401, '틀린 비밀번호는 로그인 실패');
const login = (await (
  await fetch(`${URL}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PW }) })
).json()) as { ok: boolean; token: string };
check(login.ok && !!login.token, '운영자 로그인');
const adm = await connect();
check((await call(adm, 'adminAuth', { token: login.token })).ok, '토큰으로 소켓 권한 확인');
check(!(await call(await connect(), 'adminAuth', { token: 'x' })).ok, '잘못된 토큰은 거부');
const players = await call<unknown[]>(adm, 'adminPlayers');
check(players.length >= 3, '접속자 목록 확인');
const teamSeen = waitFor<number>((dn) => observer.s.on('pu', (id, p) => id === d.id && p.team !== undefined && dn(p.team)));
check((await call(adm, 'adminSetTeam', { id: d.id, team: 4 })).ok && (await teamSeen) === 4, '팀 배정 → 모두에게 반영');
check((await call(adm, 'adminMute', { id: d.id, muted: true })).ok && !(await call(d.s, 'chat', { ch: 'all', text: '도배' })).ok, '채팅 제한');
await call(adm, 'adminMute', { id: d.id, muted: false });
const noticeSeen = waitFor<string>((dn) => observer.s.on('notice', (t) => dn(t)));
await call(adm, 'adminNotice', { text: '곧 단체 사진!' });
check((await noticeSeen) === '곧 단체 사진!', '전체 공지');
const dispSeen = waitFor<boolean>((dn) => observer.s.on('display', (dd) => dn(dd.photo)));
await call(adm, 'adminDisplay', { photo: true });
check((await dispSeen) === true, '단체 사진 모드 → 모든 화면에 전달');
await call(adm, 'adminDisplay', { photo: false });
const p2 = await call(far.s, 'boardPost', { text: '부적절한 글 테스트', color: 0, anon: true });
const adminNotes = await call<{ id: number; author: string }[]>(adm, 'adminBoard');
check(adminNotes.find((n) => n.id === p2.note.id)?.author === '멀리봇', '운영자는 익명 글의 작성자 확인 가능');
check((await call(adm, 'adminDeleteNote', { id: p2.note.id })).ok, '운영자 게시물 삭제');
const csvNo = await fetch(`${URL}/api/admin/export.csv`);
const csv = await fetch(`${URL}/api/admin/export.csv`, { headers: { Authorization: `Bearer ${login.token}` } });
check(csvNo.status === 401 && csv.ok && (await csv.text()).includes('종류'), 'CSV 내보내기 (운영자만)');

// ==================================================================== 학회장을 찾아라!
section('2차 추가: 학회장을 찾아라! (숨바꼭질)');
await call(adm, 'adminRaid', { op: 'close' }); // 이전 점검에서 남은 레이드 정리
// 이전 점검에서 남은 숨바꼭질 당첨 기록 정리 (개발 서버 데이터)
{
  const sum = await call<PrizeSummary>(adm, 'adminPrizes');
  for (const aw of sum.awards.filter((x) => x.pool === 'hideseek')) {
    if (aw.paid) await call(adm, 'adminPrizeSet', { op: 'paid', awardId: aw.id, paid: false });
    await call(adm, 'adminPrizeSet', { op: 'revoke', awardId: aw.id });
  }
}
const host = await joinBot('학회장봇', { role: 'senior', grade: 4 });
const hostBadge = waitFor<boolean>((dn) => observer.s.on('pu', (id, p) => id === host.id && p.host === true && dn(true)));
check((await call(host.s, 'adminAuth', { token: login.token })).ok && !!(await hostBadge), '참가자 화면에서 학회장 로그인 → 학회장 배지');
const info0 = await call<AdminHsInfo>(adm, 'adminHsInfo');
check(info0.hosts.some((x) => x.id === host.id), '운영자 페이지에서 학회장 아바타 목록 확인');
check(!(await call(far.s, 'adminHs', { cmd: 'start' })).ok, '일반 참가자는 숨바꼭질을 시작할 수 없음');

// 관찰자에게 오는 학회장 위치 기록
const leaks: string[] = [];
let hiding = false;
observer.s.on('s', (_t, st) => hiding && st.some((x) => x[0] === host.id) && leaks.push('s'));
observer.s.on('pu', (id, p) => hiding && id === host.id && (p.x !== undefined || p.y !== undefined) && leaks.push('pu'));
const hsSeen: HsState[] = [];
observer.s.on('hs', (st) => hsSeen.push(st));
const hidingSeen = waitFor<HsState>((dn) => observer.s.on('hs', (st) => st.phase === 'hiding' && dn(st)));
const dispHidden = waitFor<boolean>((dn) => observer.s.on('display', (dd) => dn(dd.hideNames && dd.hideTeams)));
hiding = true;
check((await call(host.s, 'adminHs', { cmd: 'start', searchSec: 60 })).ok, '학회장이 숨바꼭질 시작');
const hst = await hidingSeen;
check(!!hst && hst.hostId === null, '숨는 단계: 참가자에게는 학회장이 누구인지도 보내지 않음');
check(!!(await dispHidden), '숨바꼭질 중 닉네임·팀 표시 자동 숨김');
check(!(await call(host.s, 'adminHs', { cmd: 'start' })).ok, '진행 중 중복 시작 방지');
// 참가자는 움직일 수 없음
const frozenCx = waitFor<boolean>((dn) => e.s.once('cx', () => dn(true)));
e.s.emit('m', [e.pos.x + 3, e.pos.y, 3, 1]);
check(!!(await frozenCx), '블라인드 중 참가자 이동은 서버가 막음');
check(((await call(e.s, 'act', { t: 'slide' })) as { reason?: string }).reason === '학회장이 숨는 중이에요!', '블라인드 중 상호작용 제한');
check(!(await call(e.s, 'chat', { ch: 'all', text: '어디야' })).ok, '블라인드 중 채팅 제한');
// 학회장은 이동 (숨을 곳으로)
const hideTarget = WORLD.collision.nearest(WORLD.spawn.x - 110, WORLD.spawn.y + 20, 40)!; // 광장 밖 (리스폰 위치와 충분히 떨어진 곳)
const hostMoved = await walk(host, hideTarget.x, hideTarget.y);
check(hostMoved, '학회장은 숨는 동안 이동 가능');
await sleep(3300); // 3초마다 오는 전체 위치 보정에도 섞이지 않는지 확인
check(leaks.length === 0, `숨는 동안 학회장 위치가 다른 참가자에게 전송되지 않음 (${leaks.length}건)`);
const peek = (await call<JoinResult>(await connect(), 'spectate')) as unknown as { room: RoomSnapshot };
const peekHost = peek.room.players.find((p) => p.id === host.id)!;
check(Math.hypot(peekHost.x - host.pos.x, peekHost.y - host.pos.y) > 20, '관전·새로고침 스냅숏에도 숨은 위치 대신 출발 위치만 보임');
check(!(await call(e.s, 'hsFind')).ok, '숨는 단계에는 발견 불가');

const searchSeen = waitFor<HsState>((dn) => observer.s.on('hs', (st) => st.phase === 'searching' && dn(st)), 16000);
const ePatched = waitFor<boolean>((dn) => e.s.on('pu', (id, p) => id === e.id && p.x !== undefined && dn(true)), 16000);
const sst = await searchSeen;
hiding = false;
check(!!sst && sst.hostId === host.id, '15초 후 수색 시작 (서버 타이머) · 학회장 공개');
const spawnRect = WORLD.spawn;
check(!!(await ePatched) && e.pos.x >= spawnRect.x - 20 && e.pos.x <= spawnRect.x + spawnRect.w + 20 && e.pos.y >= spawnRect.y - 20 && e.pos.y <= spawnRect.y + spawnRect.h + 20, '참가자는 중앙 광장으로 리스폰');
await sleep(200);
const hostCx = waitFor<boolean>((dn) => host.s.once('cx', () => dn(true)));
host.s.emit('m', [host.pos.x + 3, host.pos.y, 3, 1]);
check(!!(await hostCx), '수색 중 학회장은 움직일 수 없음');
check(!(await call(far.s, 'hsFind')).ok, '멀리서는 발견 불가 (서버 거리 검증)');
check(!(await call(host.s, 'hsFind')).ok, '학회장 본인은 발견 요청 불가');
// 두 참가자가 동시에 학회장 옆으로
const near1 = WORLD.collision.nearest(host.pos.x - 10, host.pos.y + 4, 20)!;
const near2 = WORLD.collision.nearest(host.pos.x + 10, host.pos.y + 4, 20)!;
await Promise.all([walk(e, near1.x, near1.y), walk(d, near2.x, near2.y)]);
const foundSeen = waitFor<HsState>((dn) => observer.s.on('hs', (st) => st.phase === 'found' && dn(st)));
const [r1, r2, r3] = await Promise.all([call(e.s, 'hsFind'), call(d.s, 'hsFind'), call(e.s, 'hsFind')]);
const oks = [r1, r2, r3].filter((r) => r.ok).length;
check(oks === 1, `동시에 '찾았다!!' → 서버가 최초 1명만 인정 (성공 ${oks}건)`);
const fst = await foundSeen;
check(!!fst?.winner && fst.winner.prize && !!fst.reveal && !!fst.winnerPos, '발견 이벤트 + 학회장·발견자 위치 전달 (카메라 연출용)');
const sum1 = await call<PrizeSummary>(adm, 'adminPrizes');
const hsAwards = sum1.awards.filter((x) => x.pool === 'hideseek');
check(hsAwards.length === 1 && hsAwards[0].itemName === '배달의민족 상품권' && hsAwards[0].nickname === fst!.winner!.nickname, '배달의민족 상품권 1장 당첨 기록 (서버 저장)');
const bm = sum1.items.find((i) => i.id === 'baemin')!;
check(bm.total === 4 && bm.alloc.hideseek === 1 && bm.alloc.draw === 3, '상품권 4장 = 숨바꼭질 1 + 랜덤 추첨 3');
check(!(await call(e.s, 'hsFind')).ok, '우승 확정 후 추가 발견 요청 종료');
const dispBack = waitFor<boolean>((dn) => observer.s.on('display', (dd) => dn(!dd.hideNames)));
check((await call(adm, 'adminHs', { cmd: 'end' })).ok, '운영자 페이지에서 결과 연출 종료');
check(!!(await dispBack), '종료 후 닉네임 표시 설정 복구');
const badgeBack = (await call<JoinResult>(await connect(), 'spectate')) as unknown as { room: RoomSnapshot };
check(badgeBack.room.players.find((p) => p.id === host.id)?.host === true && badgeBack.room.hs.phase === 'finished', '종료 후 학회장 배지 복구 · 결과 유지');

// 2회차: 상품권은 다시 배정되지 않음
const found2 = waitFor<HsState>((dn) => observer.s.on('hs', (st) => st.phase === 'found' && st.round === fst!.round + 1 && dn(st)), 30000);
check((await call(adm, 'adminHs', { cmd: 'start', hostId: host.id, searchSec: 60 })).ok, '운영자 페이지에서 학회장을 골라 시작');
await waitFor((dn) => observer.s.on('hs', (st) => st.phase === 'searching' && dn(true)), 17000);
await sleep(300);
const n3 = WORLD.collision.nearest(host.pos.x, host.pos.y + 10, 20)!;
await walk(e, n3.x, n3.y);
await call(e.s, 'hsFind');
const f2 = await found2;
const sum2 = await call<PrizeSummary>(adm, 'adminPrizes');
check(!!f2 && f2.winner?.prize === false && sum2.awards.filter((x) => x.pool === 'hideseek').length === 1, '재시작해도 상품권 중복 배정 없음 (1장 유지)');
await call(adm, 'adminHs', { cmd: 'end' });
const aw = sum2.awards.find((x) => x.pool === 'hideseek')!;
check((await call(adm, 'adminPrizeSet', { op: 'paid', awardId: aw.id, paid: true })).ok, '상품 지급 완료 기록');
check(!(await call(adm, 'adminPrizeSet', { op: 'revoke', awardId: aw.id })).ok, '지급한 상품은 바로 취소 불가');
check(!(await call(adm, 'adminPrizeSet', { op: 'alloc', itemId: 'baemin', total: 4, alloc: { hideseek: 1, draw: 4 } })).ok, '할당 합계가 전체 수량을 넘으면 거부');
check(!(await call(far.s, 'adminPrizes')).ok, '일반 참가자는 상품 기록 조회 불가');
// 3회차: 강제 종료
const cancelSeen = waitFor<HsState>((dn) => observer.s.on('hs', (st) => st.phase === 'cancelled' && dn(st)));
await call(adm, 'adminHs', { cmd: 'start', hostId: host.id, searchSec: 60 });
await sleep(500);
await call(adm, 'adminHs', { cmd: 'cancel' });
check(!!(await cancelSeen), '강제 종료 (CANCELLED)');
const moveAfter = waitFor<boolean>((dn) => {
  const t = setTimeout(() => dn(true), 600);
  e.s.once('cx', () => (clearTimeout(t), dn(false)));
});
e.s.emit('m', [e.pos.x, e.pos.y + 0.5, 0, 0]);
check(!!(await moveAfter), '종료 후 이동 제한 해제');
e.pos.y += 0.5;

// ==================================================================== 이스터에그
section('2차 추가: 이스터에그 · 칭호');
await call(adm, 'adminEggSet', { id: 'secret', reset: true });
await call(adm, 'adminEggSet', { id: 'secret', enabled: true, broadcast: true });
const eggs0 = await call<EggAdminRow[]>(adm, 'adminEggs');
check(eggs0.length === 8 && eggs0.every((x) => x.need > 0), '이스터에그 8종 · 조건값 설정');
const secretSpot = WORLD.collision.nearest(WORLD.spots.secret.x, WORLD.spots.secret.y + 10, 30)!;
check(!(await call(e.s, 'act', { t: 'secret' })).ok, '비밀 오브젝트는 가까이에서만');
await walk(e, secretSpot.x, secretSpot.y);
const eggSeen = waitFor<{ id: string; winnerId: number; title: string }>((dn) => observer.s.on('egg', (ev) => dn(ev)));
check((await call(e.s, 'act', { t: 'secret' })).ok, '비밀 오브젝트 상호작용');
const egg = await eggSeen;
check(egg?.id === 'secret' && egg.winnerId === e.id && egg.title === '비밀 발견자', '최초 달성 → 칭호 지급 + 전체 알림');
const titleSeen = (await call<JoinResult>(await connect(), 'spectate')) as unknown as { room: RoomSnapshot };
check(titleSeen.room.players.find((p) => p.id === e.id)?.title === 'secret', '첫 칭호 자동 장착 → 이름표에 표시');
await walk(d, secretSpot.x + 6, secretSpot.y);
let second = false;
observer.s.on('egg', (ev) => ev.id === 'secret' && (second = true));
await call(d.s, 'act', { t: 'secret' });
await sleep(400);
check(!second, '같은 이스터에그 최초 달성자는 1명만');
const mine = await call<MyTitles>(e.s, 'myTitles');
check(mine.owned.some((o) => o.id === 'secret') && mine.equipped === 'secret', '보유 칭호 목록');
check((await call(e.s, 'setTitle', { id: null })).ok && (await call(e.s, 'setTitle', { id: 'secret' })).ok, '칭호 해제·장착');
check(!(await call(d.s, 'setTitle', { id: 'secret' })).ok, '얻지 못한 칭호는 장착 불가');
await walk(host, secretSpot.x - 6, secretSpot.y);
const eggs1 = await call<EggAdminRow[]>(adm, 'adminEggs');
check(eggs1.find((x) => x.id === 'secret')?.winner?.nickname === '이봇', '운영자: 최초 달성자·시각 확인');
const reEquip = waitFor<boolean>((dn) => observer.s.on('pu', (id, p) => id === e.id && 'title' in p && p.title === null && dn(true)));
check((await call(adm, 'adminEggSet', { id: 'secret', reset: true })).ok && !!(await reEquip), '기록 초기화 → 칭호 회수 (해당 이스터에그만)');
let hostEgg = false;
observer.s.on('egg', (ev) => ev.winnerId === host.id && (hostEgg = true));
await call(host.s, 'act', { t: 'secret' });
await sleep(400);
check(!hostEgg, '학회장 계정은 최초 달성 경쟁에서 제외');
await call(adm, 'adminEggSet', { id: 'secret', need: 0 }).then((r) => check(!r.ok, '잘못된 조건값 거부'));
const eggCsv = await fetch(`${URL}/api/admin/eggs.csv`, { headers: { Authorization: `Bearer ${login.token}` } });
check(eggCsv.ok && (await eggCsv.text()).includes('비밀 발견자'), '획득 기록 CSV 내보내기');
host.s.emit('leave');

// ==================================================================== 3차: 우수 PAIR 경품 가챠
section('3차: 우수 PAIR 경품 가챠');
const pairInfo = () => call<PairInfo>(adm, 'adminPairInfo');
{
  // 이전 점검 기록 정리
  const sum = await call<PrizeSummary>(adm, 'adminPrizes');
  for (const aw of sum.awards.filter((x) => x.pool === 'pair' || x.pool === 'draw')) {
    if (aw.paid) await call(adm, 'adminPrizeSet', { op: 'paid', awardId: aw.id, paid: false });
    await call(adm, 'adminPrizeSet', { op: 'revoke', awardId: aw.id });
  }
}
check(!(await call(far.s, 'adminPair', { op: 'draw', teamId: 'pair1' })).ok, '일반 참가자는 가챠 조작 불가');
const teams = [
  { id: 'pair1', name: '점검팀 가', members: '가1, 가2', badge: 0 },
  { id: 'pair2', name: '점검팀 나', members: '나1, 나2', badge: 1 },
  { id: 'pair3', name: '점검팀 다', members: '다1, 다2', badge: 2 },
];
check((await call(adm, 'adminPair', { op: 'save', teams })).ok && (await pairInfo()).teams.map((t) => t.name).join() === '점검팀 가,점검팀 나,점검팀 다', '우수 PAIR 3팀 등록·저장');
const pi0 = await pairInfo();
check(pi0.remaining.length === 3 && Object.keys(pi0.assigned).length === 0, '상품 3종 재고 확인 (빔프로젝터·말랑이·손난로)');
const readySeen = waitFor<StageState>((dn) => observer.s.on('stage', (st) => st.mode === 'gacha' && st.phase === 'ready' && dn(st)));
await call(adm, 'adminPair', { op: 'select', teamId: 'pair1' });
check((await readySeen)?.mode === 'gacha', '추첨할 팀을 무대 화면에 표시');
const spinSeen = waitFor<StageState>((dn) => observer.s.on('stage', (st) => st.mode === 'gacha' && st.phase === 'spin' && dn(st)));
check((await call(adm, 'adminPair', { op: 'draw', teamId: 'pair1' })).ok, '가챠 시작');
const spin = await spinSeen;
const pi1 = await pairInfo();
check(spin?.mode === 'gacha' && !!spin.result && pi1.assigned.pair1?.itemId === spin.result.id && spin.revealAt > Date.now(), '연출 시작 전에 서버가 상품 확정·저장 (연출 = 확정 결과 공개)');
check(!(await call(adm, 'adminPair', { op: 'draw', teamId: 'pair1' })).ok, '같은 팀 중복 추첨 불가');
await call(adm, 'adminPair', { op: 'draw', teamId: 'pair2' });
await call(adm, 'adminPair', { op: 'draw', teamId: 'pair3' });
const pi2 = await pairInfo();
const items = Object.values(pi2.assigned).map((a) => a.itemId);
check(items.length === 3 && new Set(items).size === 3 && pi2.remaining.length === 0, '3팀에 서로 다른 상품 3종 배정 (중복 없음, 마지막 팀은 남은 상품)');
const sumSeen = waitFor<StageState>((dn) => observer.s.on('stage', (st) => st.mode === 'gachaSummary' && dn(st)));
await call(adm, 'adminPair', { op: 'summary' });
const ss = await sumSeen;
check(ss?.mode === 'gachaSummary' && ss.results.length === 3, '전체 결과 공개 화면');
const old2 = pi2.assigned.pair2.itemId;
check((await call(adm, 'adminPair', { op: 'redraw', teamId: 'pair2' })).ok && (await pairInfo()).remaining.map((r) => r.id).join() === old2, '재추첨: 배정 취소 → 그 상품만 다시 후보로 (재고 일관성)');
await call(adm, 'adminPair', { op: 'draw', teamId: 'pair2' });
const pi3 = await pairInfo();
check(pi3.assigned.pair2.itemId === old2 && pi3.log.some((l) => l.action === 'redraw'), '재추첨 후 남은 상품 배정 · 재추첨 이력 기록');
const sumP = await call<PrizeSummary>(adm, 'adminPrizes');
check(sumP.items.filter((i) => ['projector', 'squishy', 'fishwarmer'].includes(i.id)).every((i) => i.total === 1 && i.used.pair === 1), '상품 재고: 각 1개, 모두 배정됨');
const paidId = pi3.assigned.pair1.awardId;
check((await call(adm, 'adminPrizeSet', { op: 'paid', awardId: paidId, paid: true })).ok && !(await call(adm, 'adminPair', { op: 'reset' })).ok, '지급 완료한 상품이 있으면 전체 초기화 막음');
await call(adm, 'adminPrizeSet', { op: 'paid', awardId: paidId, paid: false });

// ==================================================================== 3차: 오늘의 행운은 누구에게?
section('3차: 배민 상품권 랜덤 3명 추첨');
const host2 = await joinBot('학회장둘', { role: 'senior', grade: 4 });
await call(host2.s, 'adminAuth', { token: login.token });
const dupe = await joinBot('같은사람', {}, observer.uid); // 같은 기기 키로 한 번 더 입장
const li = await call<LuckyInfo>(adm, 'adminLuckyInfo');
const hsWinnerName = sum2.awards.find((x) => x.pool === 'hideseek')?.nickname;
check(li.alloc === 3 && li.need === 3, '랜덤 추첨 할당 3장 (숨바꼭질 1장과 별도)');
check(!li.candidates.some((c) => c.id === host2.id), '학회장 계정은 추첨 대상에서 제외');
check(li.excludeHsWinner && !li.candidates.some((c) => c.nickname === hsWinnerName), '기본값: 숨바꼭질 당첨자 제외');
check(li.candidates.filter((c) => c.id === observer.id || c.id === dupe.id).length === 1, '같은 사람(기기)이 두 번 접속해도 후보는 한 번만');
check(!(await call(far.s, 'adminLucky', { op: 'draw' })).ok, '일반 참가자는 추첨 조작 불가');
const drawnSeen = waitFor<StageState>((dn) => observer.s.on('stage', (st) => st.mode === 'lucky' && st.phase === 'drawn' && dn(st)));
check((await call(adm, 'adminLucky', { op: 'draw' })).ok, '추첨 시작');
const dr = await drawnSeen;
const sumL = await call<PrizeSummary>(adm, 'adminPrizes');
const draws = sumL.awards.filter((x) => x.pool === 'draw');
check(dr?.mode === 'lucky' && dr.winners.length === 3 && draws.length === 3 && new Set(draws.map((x) => x.ownerKey)).size === 3, '서로 다른 3명 당첨 · 서버 저장');
check(dr?.mode === 'lucky' && dr.winners.every((w, i) => w.nickname === draws[i].nickname), '화면 공개 순서 = 서버 당첨 결과');
check(!draws.some((x) => x.nickname === hsWinnerName || x.playerId === host2.id), '당첨자 중 학회장·숨바꼭질 당첨자 없음');
for (let i = 0; i < 3; i++) await call(adm, 'adminLucky', { op: 'reveal' });
check(!(await call(adm, 'adminLucky', { op: 'reveal' })).ok, '3명 공개 후 추가 공개 없음');
check(!(await call(adm, 'adminLucky', { op: 'draw' })).ok, '상품권 3장을 모두 배정하면 추가 추첨 불가 (중복 지급 방지)');
const bm2 = sumL.items.find((i) => i.id === 'baemin')!;
check(bm2.total === 4 && bm2.alloc.hideseek === 1 && bm2.alloc.draw === 3 && bm2.used.draw === 3, '배민 상품권 4장 = 숨바꼭질 1 + 랜덤 3 (재고 연동)');
check((await call(adm, 'adminLucky', { op: 'summary' })).ok, '당첨자 3명 전체 화면');
await call(adm, 'adminStage', { op: 'clear' });
for (const b of [host2, dupe]) b.s.emit('leave');

// ==================================================================== 3차: 과제 괴물 레이드
section('3차: 과제 괴물을 물리쳐라! (레이드)');
let raidSt = null as RaidState | null;
observer.s.on('raid', (st) => (raidSt = st));
const raidFx: RaidFx[] = [];
observer.s.on('rfx', (l) => raidFx.push(...l));
const rp = (id: number) => raidSt?.players.find((p) => p[0] === id);
const until = async (fn: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
};
/** 정상 속도로 레이드 안에서 걷기 */
async function rwalk(b: Bot, tx: number, ty: number) {
  let p = rp(b.id)!;
  let x = p[1];
  let y = p[2];
  for (let i = 0; i < 80; i++) {
    const dx = tx - x;
    const dy = ty - y;
    const dd = Math.hypot(dx, dy);
    if (dd < 2) break;
    const step = Math.min(7, dd);
    x += (dx / dd) * step;
    y += (dy / dd) * step;
    b.s.emit('ri', { x, y, d: 0 });
    await sleep(100);
  }
  await sleep(250);
  p = rp(b.id)!;
  return Math.hypot(p[1] - tx, p[2] - ty) < 6;
}
await call(adm, 'adminRaid', { op: 'close' });
check(!(await call(far.s, 'adminRaid', { op: 'open' })).ok, '일반 참가자는 레이드 조작 불가');
check((await call(adm, 'adminRaid', { op: 'open' })).ok && (await until(() => raidSt?.phase === 'lobby')), '대기실 열기 → 모두에게 초대');
const host3 = await joinBot('학회장셋', { role: 'senior', grade: 4 });
await call(host3.s, 'adminAuth', { token: login.token });
check(!(await call(host3.s, 'raidJoin')).ok, '학회장 계정은 전투 인원에서 제외');
for (const b of [observer, d, e, far]) await call(b.s, 'raidJoin');
check(await until(() => raidSt?.joined.length === 4), '참가자 4명 대기실 입장');
check((await call(adm, 'adminRaid', { op: 'start' })).ok && (await until(() => raidSt?.phase === 'countdown')), '학회장이 시작 → 3초 카운트다운');
check(await until(() => raidSt?.phase === 'battle', 5000), '전투 시작 · 보스 등장');
const max0 = raidSt!.boss.max;
check(max0 > 0 && raidSt!.players.length === 4, `참가 인원에 맞춘 보스 체력 (${max0})`);
// 보스 패턴: 전투가 시작되면 경고 구역이 먼저 표시됨
check(await until(() => !!raidSt?.hazards.length, 6000), '보스 공격 경고 구역 표시 (공격 전에)');
check(raidSt!.players.every((p) => p[3] <= RAID.playerHp) && RAID.playerHp === 1, '하트 1개 (맞으면 바로 쓰러짐)');
// 이후 점검은 보스 자동 공격을 멈추고 진행 (개발 서버 전용 점검 기능 — 모두 회복)
await call(adm, 'adminRaid', { op: 'debugCalm' });
await sleep(300);
// 이동 검증
const ePos = rp(e.id)!;
e.s.emit('ri', { x: ePos[1] + 200, y: ePos[2] - 150, d: 0 });
await sleep(300);
check(Math.hypot(rp(e.id)![1] - ePos[1], rp(e.id)![2] - ePos[2]) < 5, '순간이동 같은 비정상 이동은 서버가 무시');
// 공격
await rwalk(e, RAID.bossX, RAID.bossY + 70);
const hp1 = raidSt!.boss.hp;
for (let i = 0; i < 5; i++) {
  e.s.emit('ri', { a: 'atk' });
  await sleep(RAID.atkCd + 30);
}
await sleep(300);
check(raidSt!.boss.hp === hp1 - 5, `공격하면 보스 체력 감소 · 쿨타임 적용 (${hp1} → ${raidSt!.boss.hp})`);
for (let i = 0; i < 5; i++) e.s.emit('ri', { a: 'atk' });
await sleep(300);
check(raidSt!.boss.hp >= hp1 - 6, '연타해도 쿨타임 이상으로는 공격 안 됨');
await rwalk(far, 12, RAID.H - 8);
const hp2 = raidSt!.boss.hp;
far.s.emit('ri', { a: 'atk' });
await sleep(300);
check(raidSt!.boss.hp === hp2, '사거리 밖 공격은 무효 (서버 거리 판정)');
// '마감 임박' 넓은 구역: 왼쪽에 두 명 세우고, 한 명은 직전에 회피 · 한 명은 그대로
await Promise.all([rwalk(observer, 200, 250), rwalk(d, 214, 250)]);
await call(adm, 'adminRaid', { op: 'debugHazard', ratio: 0 });
check(await until(() => !!raidSt?.hazards.some((x) => x.kind === 'deadline')), '마감 임박 경고 구역 (2초 전에 표시)');
const hz = raidSt!.hazards.find((x) => x.kind === 'deadline')!;
const wait = hz.hitAt - Date.now() - 200;
if (wait > 0) await sleep(wait);
raidFx.length = 0;
observer.s.emit('ri', { a: 'dodge' });
await sleep(700);
check(raidFx.some((f) => f.k === 'hit' && f.id === d.id), '경고 구역 안에 있으면 피격 (서버 판정)');
check(raidFx.some((f) => f.k === 'down' && f.id === d.id) && rp(d.id)?.[4] === 1, '하트 1개라 한 번 맞으면 바로 쓰러짐');
check(raidFx.some((f) => f.k === 'evade' && f.id === observer.id) && rp(observer.id)?.[4] !== 1, '타이밍 맞춰 회피하면 피함');
// 쓰러진 사람의 '살려줘!' → 동료 부활
raidFx.length = 0;
d.s.emit('ri', { a: 'help' });
d.s.emit('ri', { a: 'help' }); // 연타는 무시
await sleep(300);
check(raidFx.filter((f) => f.k === 'help' && f.id === d.id).length === 1, "쓰러지면 '살려줘!' 외치기 (모두에게 전달 · 연타 제한)");
observer.s.emit('ri', { a: 'help' });
await sleep(200);
check(!raidFx.some((f) => f.k === 'help' && f.id === observer.id), "쓰러지지 않은 사람은 '살려줘!' 불가");
const dp = rp(d.id)!;
await rwalk(observer, dp[1] + 10, dp[2]);
raidFx.length = 0;
observer.s.emit('ri', { a: 'revive' });
await sleep(300);
check(rp(d.id)?.[4] !== 1 && raidFx.some((f) => f.k === 'revive' && f.id === d.id && f.v === observer.id), '동료가 다가가 살리면 바로 부활');
// 2페이즈: 방어막 + 선후배 협동
await call(adm, 'adminRaid', { op: 'debugHp', ratio: 0.5 });
check(await until(() => !!raidSt?.boss.shield && raidSt.zones.length > 0), `2페이즈 방어막 + 협동 구역 ${raidSt?.zones.length}곳`);
const hp3 = raidSt!.boss.hp;
e.s.emit('ri', { a: 'atk' });
await sleep(300);
check(raidSt!.boss.hp === hp3, '방어막 중에는 공격이 막힘');
const zs = raidSt!.zones.map((z) => ({ ...z }));
// 후배 두 명만으로는 안 됨 → 선배가 들어오면 채워짐
await Promise.all([rwalk(e, zs[0].x, zs[0].y), rwalk(d, zs[0].x + 4, zs[0].y)]);
await sleep(RAID.coopHoldMs + 400);
check(!raidSt!.zones.find((z) => z.id === zs[0].id)?.on, '후배끼리만 있으면 활성화 안 됨 (선후배 협동 우선)');
await rwalk(observer, zs[0].x - 4, zs[0].y + 3);
check(await until(() => !!raidSt?.zones.find((z) => z.id === zs[0].id)?.on || !raidSt?.boss.shield, RAID.coopHoldMs + 2000), '선배+후배가 함께 들어가면 협동 구역 활성화');
for (const z of zs.slice(1)) {
  await Promise.all([rwalk(observer, z.x, z.y), rwalk(e, z.x + 4, z.y)]);
  await until(() => !!raidSt?.zones.find((x) => x.id === z.id)?.on || !raidSt?.boss.shield, RAID.coopHoldMs + 2000);
}
check(await until(() => !raidSt?.boss.shield, 3000), '모든 협동 구역 활성화 → 방어막 해제 (TEAMWORK ERROR)');
// 3페이즈: 최후의 일격
await call(adm, 'adminRaid', { op: 'debugHp', ratio: 0.1 });
check(await until(() => !!raidSt?.final), `3페이즈 최후의 일격 (필요 ${raidSt?.final?.need}명)`);
await rwalk(e, RAID.bossX + 40, RAID.bossY + 60);
const hp4 = raidSt!.boss.hp;
for (let i = 0; i < 3; i++) {
  e.s.emit('ri', { a: 'atk' });
  await sleep(RAID.atkCd + 30);
}
check(raidSt!.boss.hp >= 1 && raidSt!.phase === 'battle', `최후의 일격 전에는 일반 공격으로 끝나지 않음 (${hp4} → ${raidSt!.boss.hp})`);
const need = raidSt!.final!.need;
for (const b of [observer, d, e, far].slice(0, need)) b.s.emit('ri', { a: 'final' });
check(await until(() => raidSt?.phase === 'victory'), '필요 인원이 제출하면 합동 공격 → 승리');
check(raidSt!.boss.mood === 'broken' || raidSt!.boss.mood === 'off', '보스 화면 깨짐 → 전원 종료 연출 상태');
check(!!raidSt!.result?.victory && raidSt!.result.players === 4, '결과 저장 (승리 · 참가 4명)');
const named = raidSt!.awards.filter((a) => a.playerId !== null);
check(raidSt!.awards.length === 6 && new Set(named.map((a) => a.playerId)).size === named.length, '특별 칭호 6개 · 중복 수상 없음');
const ri = await call<RaidAdminInfo>(adm, 'adminRaidInfo');
const es = ri.stats.find((s) => s.id === e.id)!;
check(es.attacks >= 10 && es.hits >= 5 && es.damage >= 5 && es.distance > 100 && es.coop >= 1 && ri.stats.find((s) => s.id === observer.id)!.revives >= 1, '서버가 직접 센 전투 통계 (공격·데미지·이동·협동·부활)');
check((await call(adm, 'adminRaid', { op: 'awards' })).ok && (await until(() => raidSt?.phase === 'awards')), '특별 시상식 시작');
await call(adm, 'adminRaid', { op: 'next' });
check(await until(() => raidSt?.shown === 1), '수상자 한 명씩 공개');
await call(adm, 'adminRaid', { op: 'allAwards' });
check(await until(() => raidSt?.shown === 6), '전체 수상 결과');
const raidCsv = await fetch(`${URL}/api/admin/raid.csv`, { headers: { Authorization: `Bearer ${login.token}` } });
check(raidCsv.ok && (await raidCsv.text()).includes('과제 파괴왕'), '레이드 결과 CSV 내보내기');
await call(adm, 'adminRaid', { op: 'close' });
check(await until(() => raidSt?.phase === 'off'), '아지트 복귀');
host3.s.emit('leave');

// ==================================================================== 정리
section('정리');
const left = waitFor<string>((dn) => observer.s.on('pl', (pid, r) => pid === a.id && dn(r)));
a.s.emit('leave');
check((await left) === 'left', '퇴장하면 모두에게 반영');
for (const b of [observer, d, e, far]) b.s.emit('leave');
await sleep(200);
console.log(failed ? `\n${passed}개 통과 · ${failed}개 실패` : `\n모든 점검 통과! (${passed}개)`);
process.exit(failed ? 1 : 0);
