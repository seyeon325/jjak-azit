import { COLOR_COUNT, LOOK_COUNT, NICK_MAX, NICK_MIN } from '../shared/constants';
import type { Dir, MoveInput, Profile } from '../shared/protocol';

/** 닉네임 정리: 제어문자·과도한 공백 제거, 길이 제한 */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFC')
    .replace(new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const color = Number(p.color);
  if (!Number.isInteger(look) || look < 0 || look >= LOOK_COUNT) return { error: '캐릭터를 선택해주세요.' };
  if (!Number.isInteger(color) || color < 0 || color >= COLOR_COUNT) return { error: '색상을 선택해주세요.' };
  return { nickname, role, look, color };
}

export function parseMove(raw: unknown): MoveInput | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [x, y, d, m] = raw;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (d !== 0 && d !== 1 && d !== 2 && d !== 3) return null;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, d as Dir, m ? 1 : 0];
}
