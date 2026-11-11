/**
 * 학회장 기능을 명령줄에서 실행 (리허설·점검용)
 *   npx tsx scripts/adminctl.ts <이벤트> '<JSON>' [주소]
 *   예) npx tsx scripts/adminctl.ts adminRaid '{"op":"open"}'
 * 비밀번호는 ADMIN_PASSWORD (개발 기본값 azit-dev)
 */
import { io } from 'socket.io-client';

const [ev, json, url = 'http://localhost:3000'] = process.argv.slice(2);
const pw = process.env.ADMIN_PASSWORD ?? 'azit-dev';
const login = (await (await fetch(`${url}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })).json()) as { ok: boolean; token: string };
if (!login.ok) throw new Error('로그인 실패');
const s = io(url, { transports: ['websocket'] });
await new Promise<void>((r) => s.on('connect', () => r()));
await new Promise((r) => s.emit('adminAuth', { token: login.token }, r));
const args = json ? [JSON.parse(json)] : [];
const res = await new Promise((r) => (s.emit as (...a: unknown[]) => void)(ev, ...args, r));
console.log(JSON.stringify(res, null, 1).slice(0, 2000));
s.close();
process.exit(0);
