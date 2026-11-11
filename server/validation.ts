import { COLOR_COUNT, GRADE_TEXT_MAX, LOOK_COUNT, NICK_MAX, NICK_MIN } from '../shared/constants';
import { WORLD } from '../shared/map';
import { TEAMS } from '../shared/social';
import { FOOD_IDS, type ActRequest, type Dir, type FoodId, type Grade, type MoveInput, type Profile } from '../shared/protocol';

/** 보이지 않는 제어문자·방향 제어문자 (줄바꿈 \n 은 허용) */
const INVISIBLE = new RegExp('[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', 'g');

/** 닉네임 정리: 제어문자·과도한 공백 제거, 길이 제한 */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  if (chars.length < NICK_MIN) return null;
  return chars.slice(0, NICK_MAX).join('');
}

export function sanitizeProfile(raw: unknown): Profile | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '입장 정보가 올바르지 않아요.' };
  const p = raw as Record<string, unknown>;
  const nickname = sanitizeNickname(p.nickname);
  if (!nickname) return { error: '닉네임을 입력해주세요.' };
  const role = p.role === 'senior' || p.role === 'junior' ? p.role : null;
  if (!role) return { error: '선배 / 후배를 선택해주세요.' };
  const look = Number(p.look);
  if (!Number.isInteger(look) || look < 0 || look >= LOOK_COUNT) return { error: '캐릭터를 선택해주세요.' };
  // 이전 버전 클라이언트는 학년/색상을 보내지 않을 수 있음 → 기본값으로 호환
  const g = Number(p.grade);
  const grade = (Number.isInteger(g) && g >= 0 && g <= 4 ? g : 0) as Grade;
  const c = Number(p.color);
  const color = Number.isInteger(c) && c >= 0 && c < COLOR_COUNT ? c : 0;
  const gradeText = grade === 0 ? sanitizeText(p.gradeText, GRADE_TEXT_MAX) ?? '' : '';
  const t = Number(p.team);
  const team = TEAMS.some((x) => x.id === t) ? t : -1;
  return { nickname, role, grade, gradeText, team, look, color };
}

export function parseMove(raw: unknown): MoveInput | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [x, y, d, m] = raw;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (d !== 0 && d !== 1 && d !== 2 && d !== 3) return null;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, d as Dir, m ? 1 : 0];
}

export function parseAct(raw: unknown): ActRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.t === 'eat') return { t: 'eat' };
  if (r.t === 'bath') return { t: 'bath', on: !!r.on };
  if (r.t === 'food' && FOOD_IDS.includes(r.food as FoodId)) return { t: 'food', food: r.food as FoodId };
  if (r.t === 'stand') return { t: 'stand' };
  if (r.t === 'slide') return { t: 'slide' };
  if ((r.t === 'sit' || r.t === 'push') && typeof r.seat === 'string' && WORLD.seats.some((x) => x.id === r.seat))
    return { t: r.t, seat: r.seat };
  return null;
}

/** 게시판 쪽지 정리 */
export function sanitizeNote(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const chars = Array.from(cleaned);
  if (!chars.length) return null;
  return chars.slice(0, max).join('');
}

/** 한 줄 텍스트 (채팅·댓글·이름 등): 줄바꿈·제어문자 제거, 길이 제한 */
export function sanitizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned);
  if (!chars.length) return null;
  return chars.slice(0, max).join('');
}
