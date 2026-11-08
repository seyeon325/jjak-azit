/**
 * 부하/동작 테스트용 봇.
 *   npm run bots              → 25명
 *   npm run bots -- 30        → 30명
 *   npm run bots -- 30 http://192.168.0.10:3000
 * 각 봇은 실제 참가자와 똑같이 접속해 광장을 돌아다닙니다. Ctrl+C 로 종료.
 */
import { io, type Socket } from 'socket.io-client';
import { COLOR_COUNT, LOOK_COUNT, MOVE_SPEED, SEND_HZ } from '../shared/constants';
import { WORLD } from '../shared/map';
import type { ClientToServerEvents, Dir, ServerToClientEvents } from '../shared/protocol';

const COUNT = Number(process.argv[2] ?? 25);
const URL = process.argv[3] ?? 'http://localhost:3000';
const NAMES = ['도토리', '말랑', '코코', '모카', '보리', '하루', '두부', '찹쌀', '나비', '별사탕', '구름', '감자', '호두', '라떼', '푸딩', '쿠키', '젤리', '모찌', '자두', '레몬', '토리', '밤톨', '솜솜', '초코', '단비', '봄봄', '새벽', '여름', '가을', '겨울'];

type BotSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function startBot(i: number) {
  const s: BotSocket = io(URL, { transports: ['websocket'] });
  let x = 0;
  let y = 0;
  let tx = 0;
  let ty = 0;
  let dir: Dir = 0;
  let pause = 0;
  let joined = false;
  const pickTarget = () => {
    for (let k = 0; k < 40; k++) {
      const cx = 40 + Math.random() * (WORLD.cols * 16 - 80);
      const cy = 60 + Math.random() * (WORLD.rows * 16 - 120);
      if (WORLD.collision.canStand(cx, cy)) {
        tx = cx;
        ty = cy;
        return;
      }
    }
  };
  s.on('connect', () => {
    s.emit(
      'join',
      {
        profile: {
          nickname: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`,
          role: Math.random() < 0.45 ? 'senior' : 'junior',
          look: Math.floor(Math.random() * LOOK_COUNT),
          color: Math.floor(Math.random() * COLOR_COUNT),
        },
      },
      (res) => {
        if (!res.ok) return console.log(`봇 ${i} 입장 실패: ${res.reason}`);
        const me = res.room.players.find((p) => p.id === res.selfId)!;
        x = me.x;
        y = me.y;
        joined = true;
        pickTarget();
      },
    );
  });
  s.on('cx', (cx, cy) => {
    x = cx;
    y = cy;
    pickTarget();
  });
  const dt = 1 / SEND_HZ;
  setInterval(() => {
    if (!joined) return;
    if (pause > 0) {
      pause -= dt;
      return;
    }
    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy);
    if (d < 3) {
      s.emit('m', [x, y, dir, 0]);
      pause = 1 + Math.random() * 4;
      pickTarget();
      return;
    }
    const step = Math.min(d, MOVE_SPEED * 0.8 * dt);
    const next = WORLD.collision.move(x, y, (dx / d) * step, (dy / d) * step);
    if (Math.abs(next.x - x) + Math.abs(next.y - y) < 0.2) pickTarget(); // 막힘
    x = next.x;
    y = next.y;
    dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
    s.emit('m', [Math.round(x * 10) / 10, Math.round(y * 10) / 10, dir, 1]);
  }, 1000 * dt);
}

console.log(`봇 ${COUNT}명을 ${URL} 에 접속시킵니다… (종료: Ctrl+C)`);
for (let i = 0; i < COUNT; i++) setTimeout(() => startBot(i), i * 120);
