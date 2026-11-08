import Phaser from 'phaser';
import type { Dir, PlayerInfo } from '../../../../shared/protocol';
import { ORIGIN_Y } from '../art/characters';
import { ensureCharacter } from '../textures';

const DIR_KEY = ['d', 'u', 's', 's'] as const;

/** 화면에 그려지는 캐릭터 하나 (내 캐릭터 / 다른 참가자 공용) */
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  /** 논리 좌표 (발 위치) */
  x: number;
  y: number;
  /** 겹침 방지용 시각적 오프셋 */
  sepX = 0;
  sepY = 0;
  sepTX = 0;
  sepTY = 0;
  dir: Dir;
  moving = false;
  away = false;
  private texKey: string;
  private animKey = '';

  constructor(
    private scene: Phaser.Scene,
    public info: PlayerInfo,
    readonly isSelf: boolean,
  ) {
    this.x = info.x;
    this.y = info.y;
    this.dir = info.dir;
    this.texKey = ensureCharacter(scene, info.look, info.color);
    this.shadow = scene.add.image(this.x, this.y, 'shadow').setOrigin(0.5, 0.6).setDepth(-4000);
    this.sprite = scene.add.sprite(this.x, this.y, this.texKey, 'd0').setOrigin(0.5, ORIGIN_Y);
    this.playAnim(true);
    this.setAway(info.status === 'away');
    this.sync();
  }

  get displayX() {
    return this.x + this.sepX;
  }
  get displayY() {
    return this.y + this.sepY;
  }

  setPose(x: number, y: number, dir: Dir, moving: boolean) {
    this.x = x;
    this.y = y;
    const changed = dir !== this.dir || moving !== this.moving;
    this.dir = dir;
    this.moving = moving;
    if (changed) this.playAnim();
  }

  setAway(away: boolean) {
    this.away = away;
    this.sprite.setAlpha(away ? 0.45 : 1);
    this.shadow.setAlpha(away ? 0.4 : 1);
    if (away && this.moving) {
      this.moving = false;
      this.playAnim();
    }
  }

  /** 입장 연출 */
  popIn() {
    this.sprite.setScale(0.2, 1.6).setAlpha(0);
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: 1,
      scaleY: 1,
      alpha: this.away ? 0.45 : 1,
      duration: 380,
      ease: 'Back.Out',
    });
  }

  private playAnim(randomStart = false) {
    const key = `${this.texKey}-${this.moving ? 'walk' : 'idle'}-${DIR_KEY[this.dir]}`;
    this.sprite.setFlipX(this.dir === 3);
    if (key === this.animKey) return;
    this.animKey = key;
    this.sprite.play(key);
    if (randomStart && !this.moving) {
      // 모두가 동시에 눈을 깜빡이지 않도록
      this.sprite.anims.setProgress(Math.random());
    }
  }

  /** 스프라이트 위치/깊이 반영 */
  sync() {
    const dx = Math.round(this.displayX);
    const dy = Math.round(this.displayY);
    this.sprite.setPosition(dx, dy);
    this.sprite.setDepth(dy + (this.isSelf ? 0.5 : 0));
    this.shadow.setPosition(dx, dy);
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
