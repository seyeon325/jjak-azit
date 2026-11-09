/** 푸드트럭 메뉴판 */
import { FOODS, type FoodDef } from '../../../shared/foods';
import type { FoodId } from '../../../shared/protocol';
import { buildFood } from '../game/art/foods';
import { h } from './dom';
import { Sheet } from './Sheet';

const REACTION_TEXT: Record<FoodDef['reaction'], string> = {
  heart: '하트 뿅뿅',
  hot: '뜨거워 주의',
  happy: '행복한 표정',
  star: '반짝반짝 별',
  yum: '냠냠',
};

export function foodIcon(id: FoodId, scale = 4): HTMLCanvasElement {
  const src = buildFood(id);
  const c = h('canvas', { class: 'food-icon', width: src.width * scale, height: src.height * scale });
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function openFoodMenu(parent: HTMLElement, onPick: (id: FoodId) => Promise<string | null>, onClose?: () => void) {
  const sheet = new Sheet(parent, h('h2', { class: 'sheet-title' }, '축제 간식 메뉴'), onClose, 'food-sheet');
  const msg = h('p', { class: 'sheet-msg', role: 'status' });
  const grid = h('div', { class: 'food-grid' });
  for (const f of FOODS) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'food-card',
        onclick: async () => {
          b.disabled = true;
          const err = await onPick(f.id);
          b.disabled = false;
          if (err) msg.textContent = err;
          else sheet.close();
        },
      },
      foodIcon(f.id),
      h('strong', {}, f.name),
      h('span', { class: 'food-desc' }, f.desc),
      h('em', { class: `food-react ${f.reaction}` }, REACTION_TEXT[f.reaction]),
    );
    grid.append(b);
  }
  sheet.body.append(h('p', { class: 'muted small' }, '하나를 골라 손에 들고 다니다가, ‘먹기’를 누르면 먹어요. 한 번에 하나만 들 수 있어요.'), grid, msg);
  return sheet;
}
