import Phaser from 'phaser';
import { foodDef } from '../../../../shared/foods';
import type { Dir, FoodId, PlayerInfo } from '../../../../shared/protocol';
import { FRAME_H, FRAME_W, ORIGIN_Y } from '../art/characters';
import { ensureCharacter } from '../textures';

const DIR_KEY = ['d', 'u', 's', 's'] as const;
/** 온천에서 보이는 부분 (머리+어깨) */
const BATH_CROP_H = 17;
/** 온천에 앉았을 때 아래로 내려가는 정도 */
export const BATH_SINK = Math.round(FRAME_H * ORIGIN_Y) - BATH_CROP_H;

/** 손에 든 음식의 위치 (발 기준) — 방향별 */
const HAND: Record<Dir, [number, number, number]> = {
  0: [5, -3, 0.6],
  1: [-5, -5, -0.6],
  2: [-3, -3, 0.6],
  3: [3, -3, 0.6],
};

/** 화면에 그려지는 캐릭터 하나 (내 캐릭터 / 다른 참가자 공용) */
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  private foodImg: Phaser.GameObjects.Image | null = null;
  private ripple: Phaser.GameObjects.Sprite | null = null;
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
  food: FoodId | null = null;
  bath = false;
  eating = false;
  private eatingFood: FoodId | null = null;
  private texKey: string;
  private animKey = '';
  /** 표정 고정 (먹은 뒤 반응 등) */
  private exprUntil = 0;
  private exprFrame: string | null = null;
  private eatTimers: Phaser.Time.TimerEvent[] = [];
  private eatTween: Phaser.Tweens.Tween | null = null;

  constructor(
    private scene: Phaser.Scene,
    public info: PlayerInfo,
    readonly isSelf: boolean,
    private fx: (kind: 'bubble', text: string) => void,
  ) {
    this.x = info.x;
    this.y = info.y;
    this.dir = info.dir;
    this.texKey = ensureCharacter(scene, info.look);
    this.shadow = scene.add.image(this.x, this.y, 'shadow').setOrigin(0.5, 0.6).setDepth(-4000);
    this.sprite = scene.add.sprite(this.x, this.y, this.texKey, 'd0').setOrigin(0.5, ORIGIN_Y);
    this.setFood(info.food ?? null);
    this.setBath(!!info.bath);
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
  /** 이름표 높이 보정 (온천에 들어가면 낮아짐) */
  get headLift() {
    return this.bath ? BATH_SINK : 0;
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
    this.foodImg?.setAlpha(away ? 0.45 : 1);
    if (away && this.moving) {
      this.moving = false;
      this.playAnim();
    }
  }

  // -------------------------------------------------------------- 음식

  setFood(food: FoodId | null) {
    if (food === this.food && (food === null || this.foodImg)) return;
    this.food = food;
    if (!food) {
      // 서버가 먼저 '다 먹음'을 알려도 반응 연출을 보여주고 원래 상태로 돌아오도록
      const eaten = this.eating ? this.eatingFood : null;
      this.cancelEat();
      this.foodImg?.destroy();
      this.foodImg = null;
      if (eaten) this.finishEat(eaten);
      return;
    }
    if (!this.foodImg) this.foodImg = this.scene.add.image(this.x, this.y, `food-${food}`).setOrigin(0.5, 1);
    else this.foodImg.setTexture(`food-${food}`);
    this.foodImg.setCrop().setScale(1).setVisible(!this.bath);
  }

  /** 먹는 연출 (모든 참가자 화면에서 동일하게 재생) */
  playEat(food: FoodId) {
    this.setFood(food);
    this.cancelEat();
    this.eating = true;
    this.eatingFood = food;
    const def = foodDef(food);
    this.playAnim();
    const img = this.foodImg;
    if (img) {
      img.setCrop(0, 0, 12, 12);
      this.eatTween = this.scene.tweens.add({
        targets: img,
        scaleY: 0.86,
        duration: 140,
        yoyo: true,
        repeat: 5,
      });
    }
    // 세 번 베어 물기
    const bites = [520, 1040, 1560];
    bites.forEach((t, i) => {
      this.eatTimers.push(
        this.scene.time.delayedCall(t, () => {
          img?.setCrop(0, 0, 12, 12 - (i + 1) * 4 + (i === 2 ? -1 : 0));
          this.emit(def?.reaction === 'hot' ? 'steam' : 'crumb', 2);
          if (def?.reaction === 'hot') this.emit('sweat', 1);
        }),
      );
    });
    this.eatTimers.push(
      this.scene.time.delayedCall(1700, () => {
        this.foodImg?.setVisible(false);
        this.eatTimers = [];
        this.finishEat(food);
      }),
    );
  }

  /** 다 먹은 뒤 음식별 반응 (표정 + 이펙트 + 말풍선) */
  private finishEat(food: FoodId) {
    const def = foodDef(food);
    const r = def?.reaction ?? 'yum';
    this.eating = false;
    this.eatingFood = null;
    this.eatTween?.stop();
    this.eatTween = null;
    this.exprFrame = r === 'hot' ? 'e1' : 'e0';
    this.exprUntil = this.scene.time.now + 1100;
    if (r === 'heart') this.emit('heart', 5);
    else if (r === 'star') this.emit('star', 6);
    else if (r === 'happy') this.emit('sparkle', 6);
    else if (r === 'hot') this.emit('steam', 4);
    else this.emit('crumb', 4);
    if (def) this.fx('bubble', def.line);
    this.playAnim(false, true);
  }

  private cancelEat() {
    this.eatTimers.forEach((t) => t.remove(false));
    this.eatTimers = [];
    this.eatTween?.stop();
    this.eatTween = null;
    this.foodImg?.setScale(1);
    this.eating = false;
    this.eatingFood = null;
  }

  /** 작은 이펙트 입자 */
  private emit(kind: 'heart' | 'star' | 'sparkle' | 'steam' | 'crumb' | 'sweat', n: number) {
    const x0 = this.displayX;
    const y0 = this.displayY - (this.bath ? 8 : 14);
    for (let i = 0; i < n; i++) {
      const key = kind;
      const img = this.scene.add
        .image(x0 + (Math.random() - 0.5) * 10, y0 + (Math.random() - 0.5) * 4, key)
        .setDepth(this.displayY + 50);
      if (kind === 'steam') img.setAlpha(0.8).setScale(0.6);
      if (kind === 'sweat') img.setPosition(x0 + 7, y0 - 6);
      const dx = (Math.random() - 0.5) * (kind === 'crumb' ? 16 : 22);
      const dy = kind === 'crumb' ? 8 + Math.random() * 4 : -14 - Math.random() * 12;
      this.scene.tweens.add({
        targets: img,
        x: img.x + dx,
        y: img.y + dy,
        alpha: 0,
        scale: kind === 'steam' ? 1.3 : kind === 'crumb' || kind === 'sweat' ? 1 : 0.6,
        duration: 700 + Math.random() * 500,
        delay: i * 70,
        ease: kind === 'crumb' ? 'Quad.In' : 'Sine.Out',
        onComplete: () => img.destroy(),
      });
    }
  }

  // -------------------------------------------------------------- 온천

  setBath(bath: boolean) {
    if (bath === this.bath && (bath ? this.ripple : !this.ripple)) return;
    this.bath = bath;
    if (bath) {
      this.sprite.setCrop(0, 0, FRAME_W, BATH_CROP_H);
      this.ripple = this.scene.add.sprite(this.x, this.y, 'ripple', 0).setOrigin(0.5, 0.5).play('ripple');
      this.shadow.setVisible(false);
      this.foodImg?.setVisible(false);
      this.emit('steam', 3);
    } else {
      this.sprite.setCrop();
      this.ripple?.destroy();
      this.ripple = null;
      this.shadow.setVisible(true);
      this.foodImg?.setVisible(!!this.food && !this.eating);
    }
    this.animKey = '';
    this.playAnim();
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

  private playAnim(randomStart = false, force = false) {
    let key: string;
    let flip = this.dir === 3;
    if (this.eating) {
      key = `${this.texKey}-chew`;
      flip = false;
    } else if (this.bath && !this.moving) {
      key = `${this.texKey}-relax`;
      flip = false;
    } else key = `${this.texKey}-${this.moving ? 'walk' : 'idle'}-${DIR_KEY[this.dir]}`;
    this.sprite.setFlipX(flip);
    if (key === this.animKey && !force) return;
    this.animKey = key;
    this.sprite.play(key);
    if (randomStart && !this.moving && !this.bath) this.sprite.anims.setProgress(Math.random());
  }

  /** 스프라이트 위치/깊이 반영 (매 프레임) */
  sync() {
    const dx = Math.round(this.displayX);
    const dy = Math.round(this.displayY);
    const sink = this.bath ? BATH_SINK : 0;
    // 반응 표정 유지
    if (this.exprFrame) {
      if (this.scene.time.now < this.exprUntil && !this.moving && !this.bath) {
        this.sprite.anims.pause();
        this.sprite.setFrame(this.exprFrame);
        this.sprite.setFlipX(false);
      } else {
        this.exprFrame = null;
        this.sprite.anims.resume();
        this.playAnim(false, true);
      }
    }
    this.sprite.setPosition(dx, dy + sink);
    this.sprite.setDepth(dy + (this.isSelf ? 0.5 : 0));
    this.shadow.setPosition(dx, dy);
    if (this.ripple) this.ripple.setPosition(dx, dy - 1).setDepth(dy + 0.7);
    if (this.foodImg && this.foodImg.visible) {
      if (this.eating) {
        this.foodImg.setPosition(dx, dy - 6).setDepth(dy + 0.8);
      } else {
        const [ox, oy, od] = HAND[this.dir];
        const bobY = this.moving ? (Math.floor(this.scene.time.now / 110) % 2) : 0;
        this.foodImg.setPosition(dx + ox, dy + oy + bobY).setDepth(dy + od);
        this.foodImg.setFlipX(this.dir === 2);
      }
    }
  }

  destroy() {
    this.cancelEat();
    this.sprite.destroy();
    this.shadow.destroy();
    this.foodImg?.destroy();
    this.ripple?.destroy();
  }
}
