import { WORLD, randomSpawn } from '../../shared/map';
import { Room, type IO } from './Room';

/** 메인 광장. 공용 맵 데이터로 벽·장애물 충돌을 검사합니다. */
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

  protected override canStand(x: number, y: number): boolean {
    return WORLD.collision.canStand(x, y);
  }
}
