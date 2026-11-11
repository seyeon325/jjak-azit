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
import type { ChatMessage, ClientToServerEvents, FxEvent, JoinResult, PlayerPatch, Profile, ServerToClientEvents } from '../shared/protocol';
import { densify, findPath } from './pathfind';

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

// ==================================================================== 정리
section('정리');
const left = waitFor<string>((dn) => observer.s.on('pl', (pid, r) => pid === a.id && dn(r)));
a.s.emit('leave');
check((await left) === 'left', '퇴장하면 모두에게 반영');
for (const b of [observer, d, e, far]) b.s.emit('leave');
await sleep(200);
console.log(failed ? `\n${passed}개 통과 · ${failed}개 실패` : `\n모든 점검 통과! (${passed}개)`);
process.exit(failed ? 1 : 0);
