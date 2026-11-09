/**
 * 부하/동작 테스트용 봇.
 *   npm run bots              → 25명
 *   npm run bots -- 30        → 30명
 *   npm run bots -- 30 https://jjak-azit.onrender.com
 * 봇은 실제 참가자처럼 돌아다니고, 가끔 푸드트럭에서 음식을 사 먹거나 온천에 들어갑니다.
 * Ctrl+C 로 종료.
 */
import { io, type Socket } from 'socket.io-client';
import { LOOK_COUNT, MOVE_SPEED, SEND_HZ, BATH_SPEED } from '../shared/constants';
import { WORLD } from '../shared/map';
import { FOOD_IDS, type ClientToServerEvents, type Dir, type Grade, type ServerToClientEvents } from '../shared/protocol';
import { densify, findPath } from './pathfind';

const COUNT = Number(process.argv[2] ?? 25);
const URL = process.argv[3] ?? 'http://localhost:3000';
const NAMES = ['도토리', '말랑', '코코', '모카', '보리', '하루', '두부', '찹쌀', '나비', '별사탕', '구름', '감자', '호두', '라떼', '푸딩', '쿠키', '젤리', '모찌', '자두', '레몬', '토리', '밤톨', '솜솜', '초코', '단비', '봄봄', '새벽', '여름', '가을', '겨울'];

type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Goal = 'wander' | 'food' | 'spring';

function startBot(i: number) {
  const s: BotSocket = io(URL, { transports: ['websocket'] });
  let pos = { x: 0, y: 0 };
  let route: { x: number; y: number }[] = [];
  let goal: Goal = 'wander';
  let dir: Dir = 0;
  let pause = 0;
  let joined = false;
  let bath = false;
  let holding = false;
  let selfId = -1;
  const act = (req: Parameters<ClientToServerEvents['act']>[0]) =>
    new Promise<boolean>((r) => s.emit('act', req, (res) => r(res.ok)));

  const plan = () => {
    const roll = Math.random();
    const grid = bath ? WORLD.bathGrid : WORLD.collision;
    let tx: number;
    let ty: number;
    if (bath) {
      goal = 'wander';
      const p = WORLD.bathGrid.nearest(WORLD.spots.spring.x + (Math.random() - 0.5) * 100, WORLD.spots.spring.y + (Math.random() - 0.5) * 30, 50);
      if (!p) return;
      tx = p.x;
      ty = p.y;
    } else if (roll < 0.18 && !holding) {
      goal = 'food';
      tx = WORLD.spots.foodtruck.x + (Math.random() - 0.5) * 40;
      ty = WORLD.spots.foodtruck.y + 8 + Math.random() * 10;
    } else if (roll < 0.3) {
      goal = 'spring';
      tx = WORLD.spots.spring.x + (Math.random() - 0.5) * 50;
      ty = WORLD.spots.spring.y - 36;
    } else {
      goal = 'wander';
      tx = 40 + Math.random() * (WORLD.cols * 16 - 80);
      ty = 60 + Math.random() * (WORLD.rows * 16 - 120);
    }
    const path = findPath(grid, pos.x, pos.y, tx, ty);
    route = path ? densify(pos, path, (MOVE_SPEED * (bath ? BATH_SPEED : 1) * 0.8) / SEND_HZ) : [];
  };

  const arrive = async () => {
    s.emit('m', [pos.x, pos.y, dir, 0]);
    pause = 1 + Math.random() * 3;
    if (bath && Math.random() < 0.35) {
      if (await act({ t: 'bath', on: false })) bath = false;
    } else if (goal === 'food' && !holding) {
      holding = await act({ t: 'food', food: FOOD_IDS[Math.floor(Math.random() * FOOD_IDS.length)] });
    } else if (goal === 'spring' && Math.random() < 0.8) {
      if (await act({ t: 'bath', on: true })) {
        bath = true;
        pause = 3 + Math.random() * 4;
      }
    } else if (holding && Math.random() < 0.6) {
      await act({ t: 'eat' });
      holding = false;
      pause = 2.6;
    }
    plan();
  };

  s.on('connect', () => {
    s.emit(
      'join',
      {
        profile: {
          nickname: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`,
          role: Math.random() < 0.45 ? 'senior' : 'junior',
          grade: Math.floor(Math.random() * 5) as Grade,
          look: Math.floor(Math.random() * LOOK_COUNT),
          color: 0,
        },
      },
      (res) => {
        if (!res.ok) return console.log(`봇 ${i} 입장 실패: ${res.reason}`);
        selfId = res.selfId;
        const me = res.room.players.find((p) => p.id === res.selfId)!;
        pos = { x: me.x, y: me.y };
        bath = me.bath;
        holding = !!me.food;
        joined = true;
        plan();
      },
    );
  });
  s.on('cx', (x, y) => {
    pos = { x, y };
    plan();
  });
  // 서버가 내 위치를 옮겼을 때 (온천 들어가기/나오기)
  s.on('pu', (id, patch) => {
    if (id !== selfId || patch.x === undefined || patch.y === undefined) return;
    if (patch.bath !== undefined) bath = patch.bath;
    pos = { x: patch.x, y: patch.y };
    plan();
  });

  const dt = 1 / SEND_HZ;
  setInterval(() => {
    if (!joined) return;
    if (pause > 0) {
      pause -= dt;
      return;
    }
    const next = route.shift();
    if (!next) {
      void arrive();
      pause = 0.5;
      return;
    }
    const dx = next.x - pos.x;
    const dy = next.y - pos.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.01) dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
    pos = next;
    s.emit('m', [Math.round(pos.x * 10) / 10, Math.round(pos.y * 10) / 10, dir, 1]);
  }, 1000 * dt);
}

console.log(`봇 ${COUNT}명을 ${URL} 에 접속시킵니다… (종료: Ctrl+C)`);
for (let i = 0; i < COUNT; i++) setTimeout(() => startBot(i), i * 120);
