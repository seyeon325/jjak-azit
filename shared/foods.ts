/** 푸드트럭 메뉴 (클라이언트·서버 공용) */
import type { FoodId, Grade } from './protocol';
import { gradeText } from './social';

export type FoodReaction = 'happy' | 'hot' | 'heart' | 'star' | 'yum';

export interface FoodDef {
  id: FoodId;
  name: string;
  desc: string;
  reaction: FoodReaction;
  /** 먹을 때 말풍선 */
  line: string;
}

export const FOODS: FoodDef[] = [
  { id: 'sumung', name: '수뭉이빵', desc: '아지트 명물! 한 입 먹으면 마음이 몽글몽글', reaction: 'heart', line: '수뭉이 최고♥' },
  { id: 'takoyaki', name: '타코야끼', desc: '갓 구워서 겉바속촉… 그리고 아주 뜨거움', reaction: 'hot', line: '앗 뜨거!' },
  { id: 'icecream', name: '아이스크림', desc: '딸기·민트 두 스쿱 콘', reaction: 'happy', line: '행복해~' },
  { id: 'hotdog', name: '핫도그', desc: '케첩 듬뿍 축제 핫도그', reaction: 'yum', line: '냠냠!' },
  { id: 'bungeo', name: '붕어빵', desc: '팥이 꼬리까지 가득', reaction: 'yum', line: '따끈따끈~' },
  { id: 'cotton', name: '솜사탕', desc: '구름처럼 폭신한 분홍 솜사탕', reaction: 'star', line: '반짝반짝!' },
];

export function foodDef(id: FoodId | null | undefined): FoodDef | null {
  return FOODS.find((f) => f.id === id) ?? null;
}

/** 학년 표시 ('기타' 는 직접 입력한 소속이 있으면 그 글자) */
export function gradeLabel(g: Grade | number | undefined, text?: string | null): string {
  return gradeText(g, text);
}
