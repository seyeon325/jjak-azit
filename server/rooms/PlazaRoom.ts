import { EAT_MS } from '../../shared/constants';
import { nearSpot, nearSpringEdge, randomSpawn, WORLD } from '../../shared/map';
import type { ActRequest, ActResult } from '../../shared/protocol';
import { Room, type IO } from './Room';

/**
 * 메인 광장. 공용 맵 데이터로 벽·장애물 충돌을 검사하고
 * 푸드트럭(음식 받기·먹기)과 카피바라 온천(들어가기·나가기)을 처리합니다.
 */
export class PlazaRoom extends Room {
  constructor(io: IO) {
    super('plaza', io);
  }

  isWalkable(x: number, y: number) {
    return WORLD.collision.canStand(x, y);
  }

  spawnPoint() {
    return randomSpawn();
  }

  protected override canStand(x: number, y: number, bath: boolean): boolean {
    return (bath ? WORLD.bathGrid : WORLD.collision).canStand(x, y);
  }

  act(id: number, req: ActRequest): ActResult {
    const rec = this.players.get(id);
    if (!rec) return { ok: false, reason: '아지트에 입장한 뒤 이용할 수 있어요.' };
    const p = rec.info;

    if (req.t === 'food') {
      if (p.bath) return { ok: false, reason: '온천에서 나온 뒤 주문해주세요.' };
      if (p.eating) return { ok: false, reason: '지금 먹는 중이에요.' };
      if (p.food) return { ok: false, reason: '한 번에 하나만 들 수 있어요. 먼저 먹어주세요!' };
      if (!nearSpot(WORLD.spots.foodtruck, p.x, p.y)) return { ok: false, reason: '푸드트럭 가까이에서 주문할 수 있어요.' };
      this.patch(id, { food: req.food });
      return { ok: true };
    }

    if (req.t === 'eat') {
      if (!p.food) return { ok: false, reason: '들고 있는 음식이 없어요.' };
      if (p.eating) return { ok: true };
      if (p.bath) return { ok: false, reason: '온천에서는 먹을 수 없어요.' };
      const food = p.food;
      this.patch(id, { eating: true });
      this.io.to(this.channel).emit('pe', id, food);
      const t = setTimeout(() => {
        rec.timers = rec.timers.filter((x) => x !== t);
        if (this.players.get(id) === rec) this.patch(id, { food: null, eating: false });
      }, EAT_MS);
      rec.timers.push(t);
      return { ok: true };
    }

    // 온천
    if (req.on) {
      if (p.bath) return { ok: true };
      if (p.eating) return { ok: false, reason: '다 먹고 들어가요!' };
      if (!nearSpringEdge(p.x, p.y)) return { ok: false, reason: '온천 가까이에서 들어갈 수 있어요.' };
      // 가장자리 바로 앞이 아니라 물속으로 조금 들어간 자리에 앉기
      const spot = WORLD.bathGrid.nearest(p.x, p.y + 26, 64) ?? WORLD.bathGrid.nearest(p.x, p.y + 6, 64);
      if (!spot) return { ok: false, reason: '온천이 꽉 찼어요. 다른 쪽으로 가볼까요?' };
      this.patch(id, { bath: true, x: spot.x, y: spot.y });
      return { ok: true };
    }
    if (!p.bath) return { ok: true };
    const land = WORLD.collision.nearest(p.x, p.y, 96) ?? randomSpawn();
    this.patch(id, { bath: false, x: land.x, y: land.y });
    return { ok: true };
  }
}
