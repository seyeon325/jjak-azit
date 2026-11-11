import Phaser from 'phaser';
import { foodDef } from '../../../../shared/foods';
import { WORLD, type Seat } from '../../../../shared/map';
import type { Dir, FoodId, PlayerInfo } from '../../../../shared/protocol';
import type { EmoteId, PoseId } from '../../../../shared/social';
import { FRAME_H, FRAME_W, ORIGIN_Y, POSE_FRAMES } from '../art/characters';
import { ensureCharacter } from '../textures';

const DIR_KEY = ['d', 'u', 's', 's'] as const;
/** 온천에서 보이는 부분 (머리+어깨) */
const BATH_CROP_H = 17;
/** 온천에 앉았을 때 아래로 내려가는 정도 */
export const BATH_SINK = Math.round(FRAME_H * ORIGIN_Y) - BATH_CROP_H;
const SEATS = new Map(WORLD.seats.map((s) => [s.id, s]));

/** 손에 든 음식의 위치 (발 기준) — 방향별 */
const HAND: Record<Dir, [number, number, number]> = {
  0: [5, -3, 0.6],
  1: [-5, -5, -0.6],
  2: [-3, -3, 0.6],
  3: [3, -3, 0.6],
};

/** 앉았을 때 엉덩이를 좌석 높이에 맞추는 위쪽 이동량 */
const SIT_LIFT: Record<Seat['kind'], number> = { bench: 7, log: 8, swing: -1, seesaw: 6, spring: 10 };
/** 뒤돌아 앉는 통나무(남쪽)는 몸이 통나무 뒤로 살짝 숨도록 덜 올림 */
const SIT_LIFT_BACK = 6;

type Script = {
  start: number;
  dur: number;
  fn: (t: number) => { x: number; y: number; frame?: string; flip?: boolean; rot?: number; depth?: number };
};

/** 화면에 그려지는 캐릭터 하나 (내 캐릭터 / 다른 참가자 공용) */
export class Avatar {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  private ring: Phaser.GameObjects.Image | null = null;
  private foodImg: Phaser.GameObjects.Image | null = null;
  private ripple: Phaser.GameObjects.Sprite | null = null;
  private emoteImg: Phaser.GameObjects.Image | null = null;
  /** 논리 좌표 (발 위치) */
  x: number;
  y: number;
  sepX = 0;
  sepY = 0;
  sepTX = 0;
  sepTY = 0;
  /** 놀이기구가 만드는 추가 오프셋 (그네·시소) */
  rideX = 0;
  rideY = 0;
  rideRot = 0;
  rideScale = 1;
  /** 놀이기구가 정하는 그리기 순서 (null = 기본) */
  rideDepth: number | null = null;
  jumpY = 0;
  dir: Dir;
  moving = false;
  away = false;
  food: FoodId | null = null;
  bath = false;
  eating = false;
  seat: Seat | null = null;
  private eatingFood: FoodId | null = null;
  private texKey: string;
  private animKey = '';
  private exprUntil = 0;
  private exprFrame: string | null = null;
  private eatTimers: Phaser.Time.TimerEvent[] = [];
  private eatTween: Phaser.Tweens.Tween | null = null;
  /** 포즈: 정지 프레임 or 애니메이션 */
  private poseKind: PoseId | null = null;
  private poseUntil = 0;
  private spinTimer: Phaser.Time.TimerEvent | null = null;
  private script: Script | null = null;
  showTeam = true;

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
    this.setTeam(info.team);
    this.setFood(info.food ?? null);
    this.setBath(!!info.bath);
    this.setSeat(info.seat ?? null);
    this.playAnim(true);
    this.setAway(info.status === 'away');
    this.sync();
  }

  get displayX() {
    return this.x + this.sepX + this.rideX;
  }
  get displayY() {
    return this.y + this.sepY;
  }
  /** 이름표 높이 보정 */
  get headLift() {
    if (this.bath) return BATH_SINK;
    if (this.seat) return -SIT_LIFT[this.seat.kind] + 2 + this.rideY;
    return this.jumpY;
  }

  setPose(x: number, y: number, dir: Dir, moving: boolean) {
    this.x = x;
    this.y = y;
    if (this.seat) {
      dir = this.seat.dir;
      moving = false;
    }
    const changed = dir !== this.dir || moving !== this.moving;
    this.dir = dir;
    this.moving = moving;
    if (moving && this.poseKind && this.poseKind !== 'jump') this.clearPose();
    if (changed) this.playAnim();
  }

  setAway(away: boolean) {
    this.away = away;
    const a = away ? 0.45 : 1;
    this.sprite.setAlpha(a);
    this.shadow.setAlpha(away ? 0.4 : 1);
    this.foodImg?.setAlpha(a);
    this.ring?.setAlpha(away ? 0.3 : 0.75);
    if (away && this.moving) {
      this.moving = false;
      this.playAnim();
    }
  }

  setTeam(team: number) {
    this.ring?.destroy();
    this.ring = null;
    if (team >= 0 && this.scene.textures.exists(`ring-${team}`))
      this.ring = this.scene.add.image(this.x, this.y, `ring-${team}`).setOrigin(0.5, 0.5).setDepth(-3990).setAlpha(0.75);
    this.ring?.setVisible(this.showTeam && !this.bath);
  }

  setShowTeam(v: boolean) {
    this.showTeam = v;
    this.ring?.setVisible(v && !this.bath);
  }

  // -------------------------------------------------------------- 좌석·놀이기구

  setSeat(seatId: string | null) {
    const seat = seatId ? SEATS.get(seatId) ?? null : null;
    if (seat === this.seat) return;
    this.seat = seat;
    this.rideX = this.rideY = this.rideRot = 0;
    this.rideScale = 1;
    this.rideDepth = null;
    this.sprite.setRotation(0).setScale(1);
    this.clearPose();
    if (seat) {
      this.dir = seat.dir;
      this.moving = false;
      this.foodImg?.setVisible(false);
    } else this.foodImg?.setVisible(!!this.food && !this.bath && !this.eating);
    this.animKey = '';
    this.playAnim();
  }

  // -------------------------------------------------------------- 포즈·이모티콘

  playPoseAnim(kind: PoseId) {
    if (this.seat || this.bath) return;
    this.clearPose();
    const now = this.scene.time.now;
    this.poseKind = kind;
    const dur: Record<PoseId, number> = { wave: 1800, v: 1600, jump: 700, spin: 1100, sit: 60_000, dance: 6000, surprised: 1200, bump: 1700, push: 650 };
    this.poseUntil = now + dur[kind];
    if (kind === 'jump') {
      this.scene.tweens.add({ targets: this, jumpY: -9, duration: 170, yoyo: true, repeat: 1, ease: 'Quad.Out', onComplete: () => (this.jumpY = 0) });
    }
    if (kind === 'spin') {
      const order: Dir[] = [0, 2, 1, 3];
      let i = 0;
      this.spinTimer = this.scene.time.addEvent({
        delay: 90,
        repeat: 11,
        callback: () => {
          this.dir = order[i++ % 4];
          this.animKey = '';
          this.playAnim();
        },
      });
    }
    if (kind === 'surprised' || kind === 'bump') this.squash(0.8, 160);
    if (kind === 'push') {
      // 앞으로 쭉 미는 동작
      this.scene.tweens.add({ targets: this, jumpY: 2, duration: 110, yoyo: true, ease: 'Quad.Out' });
      this.squash(0.88, 120);
    }
    this.animKey = '';
    this.playAnim();
  }

  private clearPose() {
    this.poseKind = null;
    this.spinTimer?.remove(false);
    this.spinTimer = null;
    this.jumpY = 0;
  }

  showEmote(kind: EmoteId) {
    this.emoteImg?.destroy();
    const img = this.scene.add.image(this.displayX, this.displayY - 30, `emote-${kind}`).setOrigin(0.5, 1).setDepth(9500);
    this.emoteImg = img;
    img.setScale(0.3);
    this.scene.tweens.add({ targets: img, scale: 1, duration: 220, ease: 'Back.Out' });
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      delay: 1500,
      duration: 300,
      onComplete: () => {
        img.destroy();
        if (this.emoteImg === img) this.emoteImg = null;
      },
    });
  }

  /** 납작해졌다 복원 (뿅망치·놀람) */
  squash(amount = 0.55, dur = 220) {
    this.scene.tweens.killTweensOf(this.sprite);
    this.sprite.setScale(1.25, amount);
    this.scene.tweens.add({ targets: this.sprite, scaleX: 1, scaleY: 1, duration: dur * 2, ease: 'Elastic.Out' });
  }

  /** 정해진 경로로 움직이는 연출 (미끄럼틀·퐁!) */
  runScript(dur: number, fn: Script['fn']) {
    this.script = { start: this.scene.time.now, dur, fn };
  }
  get scripted() {
    return !!this.script;
  }

  // -------------------------------------------------------------- 음식

  setFood(food: FoodId | null) {
    if (food === this.food && (food === null || this.foodImg)) return;
    this.food = food;
    if (!food) {
      const eaten = this.eating ? this.eatingFood : null;
      this.cancelEat();
      this.foodImg?.destroy();
      this.foodImg = null;
      if (eaten) this.finishEat(eaten);
      return;
    }
    if (!this.foodImg) this.foodImg = this.scene.add.image(this.x, this.y, `food-${food}`).setOrigin(0.5, 1);
    else this.foodImg.setTexture(`food-${food}`);
    this.foodImg.setCrop().setScale(1).setVisible(!this.bath && !this.seat);
  }

  playEat(food: FoodId) {
    this.setFood(food);
    this.cancelEat();
    this.clearPose();
    this.eating = true;
    this.eatingFood = food;
    const def = foodDef(food);
    this.playAnim();
    const img = this.foodImg;
    if (img) {
      img.setVisible(true).setCrop(0, 0, 12, 12);
      this.eatTween = this.scene.tweens.add({ targets: img, scaleY: 0.86, duration: 140, yoyo: true, repeat: 5 });
    }
    [520, 1040, 1560].forEach((t, i) => {
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
  emit(kind: 'heart' | 'star' | 'sparkle' | 'steam' | 'crumb' | 'sweat' | 'drop', n: number) {
    const x0 = this.displayX;
    const y0 = this.displayY - (this.bath ? 8 : 14) + this.headLift;
    for (let i = 0; i < n; i++) {
      const img = this.scene.add
        .image(x0 + (Math.random() - 0.5) * 10, y0 + (Math.random() - 0.5) * 4, kind)
        .setDepth(this.displayY + 50);
      if (kind === 'steam') img.setAlpha(0.8).setScale(0.6);
      if (kind === 'sweat') img.setPosition(x0 + 7, y0 - 6);
      const falls = kind === 'crumb' || kind === 'drop';
      const dx = (Math.random() - 0.5) * (falls ? 22 : 22);
      const dy = falls ? 8 + Math.random() * 6 : -14 - Math.random() * 12;
      this.scene.tweens.add({
        targets: img,
        x: img.x + dx,
        y: img.y + dy,
        alpha: 0,
        scale: kind === 'steam' ? 1.3 : falls || kind === 'sweat' ? 1 : 0.6,
        duration: 700 + Math.random() * 500,
        delay: i * 60,
        ease: falls ? 'Quad.In' : 'Sine.Out',
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
      this.ring?.setVisible(false);
      this.foodImg?.setVisible(false);
      this.clearPose();
      this.emit('steam', 3);
    } else {
      this.sprite.setCrop();
      this.ripple?.destroy();
      this.ripple = null;
      this.shadow.setVisible(true);
      this.ring?.setVisible(this.showTeam);
      this.foodImg?.setVisible(!!this.food && !this.eating && !this.seat);
    }
    this.animKey = '';
    this.playAnim();
  }

  popIn() {
    this.sprite.setScale(0.2, 1.6).setAlpha(0);
    this.scene.tweens.add({ targets: this.sprite, scaleX: 1, scaleY: 1, alpha: this.away ? 0.45 : 1, duration: 380, ease: 'Back.Out' });
  }

  private setStatic(frame: string, flip = false) {
    this.animKey = `static:${frame}:${flip}`;
    this.sprite.anims.stop();
    this.sprite.setFrame(frame).setFlipX(flip);
  }

  private playAnim(randomStart = false, force = false) {
    if (this.script) return;
    // 1) 앉아 있음
    if (this.seat && !this.eating) {
      const d = this.seat.dir;
      const frame = d === 0 ? POSE_FRAMES.sit : d === 1 ? POSE_FRAMES.sitBack : POSE_FRAMES.sitSide;
      if (force || this.animKey !== `static:${frame}:${d === 3}`) this.setStatic(frame, d === 3);
      return;
    }
    // 2) 포즈
    const now = this.scene.time.now;
    if (this.poseKind && now < this.poseUntil && !this.eating) {
      const k = this.poseKind;
      if (k === 'wave' || k === 'dance') {
        const key = `${this.texKey}-${k}`;
        this.sprite.setFlipX(false);
        if (this.animKey !== key || force) {
          this.animKey = key;
          this.sprite.play(key);
        }
        return;
      }
      const st: Partial<Record<PoseId, string>> = { v: POSE_FRAMES.v, surprised: POSE_FRAMES.surprised, sit: POSE_FRAMES.sit, bump: POSE_FRAMES.bump, push: POSE_FRAMES.push };
      if (st[k]) {
        this.setStatic(st[k]!);
        return;
      }
    } else if (this.poseKind && now >= this.poseUntil) this.clearPose();

    // 3) 기본
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
    const now = this.scene.time.now;
    let dx = Math.round(this.displayX);
    let dy = Math.round(this.displayY);
    let lift = 0;
    let scriptDepth: number | null = null;

    // 경로 연출
    if (this.script) {
      const t = Math.min(1, (now - this.script.start) / this.script.dur);
      const p = this.script.fn(t);
      dx = Math.round(p.x);
      dy = Math.round(p.y);
      if (p.frame) this.sprite.anims.stop(), this.sprite.setFrame(p.frame).setFlipX(!!p.flip);
      this.sprite.setRotation(p.rot ?? 0);
      scriptDepth = p.depth ?? null;
      if (t >= 1) {
        this.script = null;
        // 연출이 끝난 자리에서 이어서 걷도록 (서버 위치 갱신 전 계단 쪽으로 되돌아가는 깜빡임 방지)
        this.x = p.x - this.sepX - this.rideX;
        this.y = p.y - this.sepY;
        this.sprite.setRotation(0);
        this.animKey = '';
        this.playAnim(false, true);
      }
    } else {
      if (this.poseKind && now >= this.poseUntil) {
        this.clearPose();
        this.playAnim(false, true);
      }
      if (this.exprFrame) {
        if (now < this.exprUntil && !this.moving && !this.bath && !this.seat) {
          this.sprite.anims.pause();
          this.sprite.setFrame(this.exprFrame).setFlipX(false);
        } else {
          this.exprFrame = null;
          this.sprite.anims.resume();
          this.playAnim(false, true);
        }
      }
      if (this.poseKind === 'dance') {
        // 둠칫둠칫: 박자에 맞춰 위아래 + 좌우 반전
        const beat = Math.floor(now / 200);
        lift = beat % 2 ? -1 : 0;
        this.sprite.setFlipX(Math.floor(now / 400) % 2 === 1);
      }
    }

    const back = this.seat?.kind === 'log' && this.seat.dir === 1;
    const sitLift = this.seat ? (back ? SIT_LIFT_BACK : SIT_LIFT[this.seat.kind]) : 0;
    const sink = this.bath ? BATH_SINK : 0;
    this.sprite.setPosition(dx, dy + sink - sitLift + this.rideY + this.jumpY + lift);
    if (!this.script) {
      this.sprite.setRotation(this.rideRot);
      if (this.seat && this.rideScale !== 1) this.sprite.setScale(this.rideScale);
    }
    // 앉은 사람은 좌석보다 앞에 그려지도록
    // 그네·시소·스프링은 놀이기구 받침보다 앞에 그려야 올라탄 것처럼 보임
    // 통나무: 앞을 보고 앉으면 통나무 앞에, 뒤돌아 앉으면 통나무 뒤에 (다리가 가려짐)
    const seatDepth = this.seat ? (back ? -3 : 2) : 0;
    const base = scriptDepth ?? this.rideDepth ?? dy + seatDepth;
    this.sprite.setDepth(base + (this.isSelf ? 0.5 : 0));
    this.shadow.setPosition(dx, dy).setScale(this.jumpY < -3 ? 0.7 : 1);
    this.ring?.setPosition(dx, dy);
    if (this.ripple) this.ripple.setPosition(dx, dy - 1).setDepth(dy + 0.7);
    if (this.emoteImg) this.emoteImg.setPosition(dx, dy - 24 + this.headLift - (this.seat ? sitLift : 0));
    if (this.foodImg && this.foodImg.visible) {
      if (this.eating) {
        this.foodImg.setPosition(dx, dy - 6 - sitLift).setDepth(dy + 2.8);
      } else {
        const [ox, oy, od] = HAND[this.dir];
        const bobY = this.moving ? Math.floor(now / 110) % 2 : 0;
        this.foodImg.setPosition(dx + ox, dy + oy + bobY + this.jumpY).setDepth(dy + od);
        this.foodImg.setFlipX(this.dir === 2);
      }
    }
  }

  destroy() {
    this.cancelEat();
    this.clearPose();
    this.sprite.destroy();
    this.shadow.destroy();
    this.ring?.destroy();
    this.foodImg?.destroy();
    this.ripple?.destroy();
    this.emoteImg?.destroy();
  }
}
