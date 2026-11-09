/**
 * 메인 광장 씬: 맵 렌더링, 내 캐릭터 이동/전송, 다른 참가자 보간, 카메라,
 * 푸드트럭·온천·게시판 상호작용 감지.
 * mode 'player' = 참가자 화면 / 'screen' = 운영자 관전 화면
 */
import Phaser from 'phaser';
import { BATH_SPEED, MOVE_SPEED, SEND_HZ, WORLD_H, WORLD_W } from '../../../../shared/constants';
import { foodDef } from '../../../../shared/foods';
import { nearSpot, nearSpringEdge, T, WORLD, zoneAt, type TileType, type Zone } from '../../../../shared/map';
import type { Dir, FoodId, PlayerInfo } from '../../../../shared/protocol';
import type { Network } from '../../net/Network';
import type { WorldStore } from '../../state/WorldStore';
import type { WorldOverlay } from '../../ui/WorldOverlay';
import { propTextureKey } from '../art/props';
import { Avatar } from '../entities/Avatar';
import type { InputController } from '../InputController';
import { registerStaticTextures } from '../textures';

/** 지금 할 수 있는 상호작용 (HUD 버튼 표시용) */
export interface InteractState {
  nearFood: boolean;
  nearSpring: boolean;
  nearBoard: boolean;
  bath: boolean;
  food: FoodId | null;
  eating: boolean;
}

export interface GameContext {
  mode: 'player' | 'screen';
  store: WorldStore;
  net: Network;
  overlay: WorldOverlay;
  input?: InputController;
  onZoneChange?: (zone: Zone | null) => void;
  onInteract?: (s: InteractState) => void;
  onBoardTap?: () => void;
  onReady?: () => void;
}

export type ScreenCamMode = 'all' | 'follow';

const SEP_RADIUS = 9;

export class WorldScene extends Phaser.Scene {
  private ctx!: GameContext;
  private avatars = new Map<number, Avatar>();
  private self: Avatar | null = null;
  private sendAcc = 0;
  private lastSent = { x: NaN, y: NaN, dir: 0 as Dir, moving: false };
  private zone: Zone | null = null;
  private interactKey = '';
  private unsubs: (() => void)[] = [];
  screenCamMode: ScreenCamMode = 'all';

  constructor() {
    super('world');
  }

  init(data: { ctx: GameContext }) {
    this.ctx = data.ctx;
  }

  create() {
    registerStaticTextures(this);
    this.buildWorld();

    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#86c36a');
    if (this.ctx.mode === 'player') cam.setBounds(0, 0, WORLD_W, WORLD_H);
    this.applyZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyZoom, this);

    const { store } = this.ctx;
    this.unsubs.push(
      store.on('reset', () => this.rebuildAvatars()),
      store.on('join', (info) => this.addAvatar(info, true)),
      store.on('leave', (info) => this.removeAvatar(info.id)),
      store.on('status', (info, status) => {
        const a = this.avatars.get(info.id);
        a?.setAway(status === 'away');
        this.ctx.overlay.upsert(info, info.id === store.selfId);
      }),
      store.on('correct', (x, y) => {
        if (!this.self) return;
        this.self.setPose(x, y, this.self.dir, false);
        this.lastSent.x = NaN;
      }),
      store.on('patch', (info, patch) => {
        const a = this.avatars.get(info.id);
        if (!a) return;
        if (patch.bath !== undefined) a.setBath(patch.bath);
        if (patch.food !== undefined) a.setFood(patch.food);
        if (patch.x !== undefined && patch.y !== undefined) {
          a.setPose(patch.x, patch.y, a.dir, false);
          if (a === this.self) this.lastSent.x = NaN;
        }
        this.ctx.overlay.upsert(info, info.id === store.selfId);
      }),
      store.on('eat', (info, food) => {
        this.avatars.get(info.id)?.playEat(food);
      }),
    );
    this.rebuildAvatars();

    this.game.events.on(Phaser.Core.Events.POST_RENDER, this.renderOverlay, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.game.events.off(Phaser.Core.Events.POST_RENDER, this.renderOverlay, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyZoom, this);
    });
    this.ctx.onReady?.();
  }

  // -------------------------------------------------------------- 월드 구성

  private buildWorld() {
    this.add.image(0, 0, 'ground').setOrigin(0).setDepth(-10000);
    for (const p of WORLD.props) {
      const key = propTextureKey(p.kind, p.label);
      const animated = p.kind === 'capyBath' || p.kind === 'capyRest';
      const obj = animated
        ? this.add.sprite(Math.round(p.x), Math.round(p.y), key, 0).play({ key: p.kind, startFrame: Math.floor(Math.random() * 2) })
        : this.add.image(Math.round(p.x), Math.round(p.y), key);
      obj.setOrigin(0.5, 1).setFlipX(!!p.flip).setDepth(p.flat ? -5000 + p.y : p.y);
      if (p.kind === 'campfire') this.addCampfire(p.x, p.y);
      if (p.kind === 'portal') this.addPortal(p.x, p.y, obj.depth);
      if (p.kind === 'lamp' || p.kind === 'lantern') this.addGlow(p.x, p.y - (p.kind === 'lamp' ? 36 : 17), 'glow', 0.3, 0.55);
      if (p.kind === 'crystal') this.addGlow(p.x, p.y - 10, 'glowViolet', 0.35, 0.5);
      if (p.kind === 'capyBath') {
        // 카피바라가 물속에서 살랑살랑
        this.tweens.add({ targets: obj, y: obj.y + 1, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      }
      if (p.kind === 'board' && this.ctx.mode === 'player') {
        obj.setInteractive({ useHandCursor: true, pixelPerfect: false });
        obj.on('pointerup', () => this.ctx.onBoardTap?.());
      }
      if (p.kind === 'foodtruck') this.addTruckLights(p.x, p.y);
    }
    this.addSpringFx();
    this.addPetals();
  }

  private addGlow(x: number, y: number, key: string, alpha: number, scale: number) {
    const g = this.add.image(x, y, key).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setScale(scale);
    g.setDepth(y + 200);
    this.tweens.add({
      targets: g,
      alpha: alpha * 0.6,
      scale: scale * 0.92,
      duration: 1400 + Math.random() * 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    return g;
  }

  private addCampfire(x: number, y: number) {
    this.add.sprite(x, y - 5, 'flame').setOrigin(0.5, 1).setDepth(y + 0.2).play('flame');
    const glow = this.add
      .image(x, y - 8, 'glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.5)
      .setAlpha(0.55)
      .setDepth(y + 300);
    this.tweens.add({ targets: glow, alpha: 0.35, scale: 1.35, duration: 220, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.add
      .particles(x, y - 12, 'ember', {
        lifespan: { min: 700, max: 1400 },
        speedY: { min: -26, max: -12 },
        speedX: { min: -6, max: 6 },
        scale: { start: 1, end: 0.3 },
        alpha: { start: 1, end: 0 },
        frequency: 220,
        quantity: 1,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(y + 301);
  }

  private addPortal(x: number, y: number, depth: number) {
    this.add.sprite(x, y - 5, 'swirl').setOrigin(0.5, 1).setDepth(depth - 0.5).setAlpha(0.95).play('swirl');
    this.addGlow(x, y - 28, 'glowViolet', 0.45, 1.3);
    this.add
      .particles(x, y - 24, 'sparkle', {
        lifespan: 1600,
        speedY: { min: -14, max: -5 },
        speedX: { min: -10, max: 10 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.9, end: 0 },
        x: { min: -16, max: 16 },
        y: { min: -10, max: 14 },
        frequency: 260,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(y + 301);
  }

  private addTruckLights(x: number, y: number) {
    this.addGlow(x - 6, y - 42, 'glowWarm', 0.22, 1.1);
  }

  /** 온천 김 + 반짝임 */
  private addSpringFx() {
    const spots: { x: number; y: number }[] = [];
    for (let ty = 0; ty < WORLD.rows; ty++)
      for (let tx = 0; tx < WORLD.cols; tx++)
        if ((WORLD.tiles[ty * WORLD.cols + tx] as TileType) === T.SPRING) spots.push({ x: tx * 16 + 8, y: ty * 16 + 8 });
    if (!spots.length) return;
    const minX = Math.min(...spots.map((s) => s.x)) - 4;
    const maxX = Math.max(...spots.map((s) => s.x)) + 4;
    const minY = Math.min(...spots.map((s) => s.y)) - 4;
    const maxY = Math.max(...spots.map((s) => s.y)) + 4;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = (maxX - minX) / 2;
    const ry = (maxY - minY) / 2;
    this.add
      .particles(0, 0, 'steam', {
        emitZone: { type: 'random', source: new Phaser.Geom.Ellipse(cx, cy, rx * 1.8, ry * 1.7), quantity: 1 },
        lifespan: { min: 2200, max: 3600 },
        speedY: { min: -10, max: -5 },
        speedX: { min: -3, max: 3 },
        scale: { start: 0.6, end: 1.8 },
        alpha: { start: 0.38, end: 0 },
        frequency: 140,
      })
      .setDepth(maxY + 40);
    this.addGlow(cx, cy, 'glowWarm', 0.18, 2.4);
    for (let i = 0; i < 6; i++) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      const sp = this.add.image(s.x + (Math.random() - 0.5) * 10, s.y, 'sparkle').setDepth(-4500).setAlpha(0);
      this.tweens.add({
        targets: sp,
        alpha: { from: 0, to: 0.9 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 3000,
        repeatDelay: 1500 + Math.random() * 2500,
      });
    }
  }

  /** 바람에 날리는 꽃잎 — 분위기용, 가볍게 */
  private addPetals() {
    this.add
      .particles(0, 0, 'mote', {
        x: { min: 0, max: WORLD_W },
        y: { min: 40, max: WORLD_H },
        lifespan: 5000,
        speedX: { min: 6, max: 16 },
        speedY: { min: 2, max: 8 },
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.sin(t * Math.PI) * 0.85 },
        tint: [0xffd3e0, 0xfff6c8, 0xffffff],
        scale: { min: 1, max: 2 },
        frequency: 400,
        quantity: 1,
      })
      .setDepth(9000);
  }

  // -------------------------------------------------------------- 참가자

  private rebuildAvatars() {
    for (const a of this.avatars.values()) a.destroy();
    this.avatars.clear();
    this.ctx.overlay.clear();
    this.self = null;
    for (const e of this.ctx.store.players.values()) this.addAvatar(e.info, false);
    this.lastSent.x = NaN;
    this.zone = null;
    this.interactKey = '';
  }

  private addAvatar(info: PlayerInfo, animate: boolean) {
    if (this.avatars.has(info.id)) this.removeAvatar(info.id);
    const isSelf = info.id === this.ctx.store.selfId;
    const a = new Avatar(this, info, isSelf, (_kind, text) => this.ctx.overlay.bubble(info.id, text));
    this.avatars.set(info.id, a);
    this.ctx.overlay.upsert(info, isSelf);
    if (isSelf) {
      this.self = a;
      const cam = this.cameras.main;
      cam.startFollow(a.sprite, true, 0.14, 0.14);
      cam.centerOn(a.x, a.y);
    }
    if (animate) a.popIn();
  }

  private removeAvatar(id: number) {
    const a = this.avatars.get(id);
    if (!a) return;
    if (a === this.self) {
      this.cameras.main.stopFollow();
      this.self = null;
    }
    a.destroy();
    this.avatars.delete(id);
    this.ctx.overlay.remove(id);
  }

  // -------------------------------------------------------------- 카메라

  private applyZoom() {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    if (this.ctx.mode === 'player') {
      const base = Math.min(w, h);
      cam.setZoom(base < 520 ? 2 : base < 1100 ? 3 : 4);
      // 개발 모드 전용: ?zoom=6 처럼 확대해서 픽셀 확인
      const forced = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('zoom')) : 0;
      if (forced > 0) cam.setZoom(forced);
    } else {
      // 관전 화면: 위쪽 제목/인원 카드 아래에 맵이 오도록 뷰포트를 내림
      const top = h > 600 ? 108 : 86;
      cam.setViewport(0, top, w, Math.max(100, h - top - 8));
      cam.setZoom(this.fitZoom());
      cam.centerOn(WORLD_W / 2, WORLD_H / 2);
    }
  }

  private fitZoom() {
    const cam = this.cameras.main;
    return Math.min(cam.width / WORLD_W, cam.height / WORLD_H) * 0.99;
  }

  private updateScreenCamera(dt: number) {
    const cam = this.cameras.main;
    const fit = this.fitZoom();
    let tz = fit;
    let tx = WORLD_W / 2;
    let ty = WORLD_H / 2;
    if (this.screenCamMode === 'follow') {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const a of this.avatars.values()) {
        if (a.away) continue;
        minX = Math.min(minX, a.x);
        maxX = Math.max(maxX, a.x);
        minY = Math.min(minY, a.y - 16);
        maxY = Math.max(maxY, a.y);
      }
      if (minX !== Infinity) {
        const pad = 90;
        const bw = maxX - minX + pad * 2;
        const bh = maxY - minY + pad * 2;
        tz = Phaser.Math.Clamp(Math.min(cam.width / bw, cam.height / bh), fit, 3.2);
        const hw = cam.width / tz / 2;
        const hh = cam.height / tz / 2;
        tx = Phaser.Math.Clamp((minX + maxX) / 2, Math.min(hw, WORLD_W / 2), Math.max(WORLD_W - hw, WORLD_W / 2));
        ty = Phaser.Math.Clamp((minY + maxY) / 2, Math.min(hh, WORLD_H / 2), Math.max(WORLD_H - hh, WORLD_H / 2));
      }
    }
    const k = 1 - Math.pow(0.04, dt);
    cam.setZoom(cam.zoom + (tz - cam.zoom) * k);
    const cx = cam.midPoint.x + (tx - cam.midPoint.x) * k;
    const cy = cam.midPoint.y + (ty - cam.midPoint.y) * k;
    cam.centerOn(cx, cy);
  }

  // -------------------------------------------------------------- 프레임 업데이트

  update(_time: number, deltaMs: number) {
    const dt = Math.min(0.05, deltaMs / 1000);
    const { store } = this.ctx;

    // 1) 다른 참가자: 서버 샘플 보간
    const renderT = store.renderTime();
    for (const [id, a] of this.avatars) {
      if (a === this.self) continue;
      const e = store.players.get(id);
      if (!e) continue;
      const s = store.sample(e, renderT);
      a.setPose(s.x, s.y, s.dir, s.moving && !a.away);
    }

    // 2) 내 캐릭터: 입력 → 충돌 → 전송
    if (this.self) this.updateSelf(dt);

    // 3) 겹침 완화 (시각적)
    this.separate(dt);
    for (const [id, a] of this.avatars) {
      a.sync();
      this.ctx.overlay.setWorldPos(id, a.displayX, a.displayY + a.headLift);
    }

    if (this.ctx.mode === 'screen') this.updateScreenCamera(dt);
  }

  private updateSelf(dt: number) {
    const self = this.self!;
    const grid = self.bath ? WORLD.bathGrid : WORLD.collision;
    const raw = this.ctx.input?.vector() ?? { x: 0, y: 0 };
    // 먹는 동안에는 잠깐 멈춤
    const v = self.eating ? { x: 0, y: 0 } : raw;
    const moving = v.x !== 0 || v.y !== 0;
    const speed = MOVE_SPEED * (self.bath ? BATH_SPEED : 1);
    let dx = v.x * speed * dt;
    let dy = v.y * speed * dt;

    // 다른 캐릭터와 너무 붙으면 살짝 밀려남
    for (const a of this.avatars.values()) {
      if (a === self || a.away || a.bath !== self.bath) continue;
      const ox = self.x - a.x;
      const oy = self.y - a.y;
      const d = Math.hypot(ox, oy);
      if (d < SEP_RADIUS) {
        const push = ((SEP_RADIUS - d) / SEP_RADIUS) * 26 * dt;
        const nx = d > 0.01 ? ox / d : Math.cos(self.info.id);
        const ny = d > 0.01 ? oy / d : Math.sin(self.info.id);
        dx += nx * push;
        dy += ny * push * 0.6;
      }
    }

    let dir = self.dir;
    if (moving) {
      if (Math.abs(v.x) > Math.abs(v.y) + 0.05) dir = v.x < 0 ? 2 : 3;
      else dir = v.y < 0 ? 1 : 0;
    }
    const next = dx || dy ? grid.move(self.x, self.y, dx, dy) : { x: self.x, y: self.y };
    self.setPose(next.x, next.y, dir, moving);

    // 서버 전송 (변화가 있을 때만, 초당 SEND_HZ회)
    this.sendAcc += dt;
    const ls = this.lastSent;
    const changedState = ls.moving !== moving || ls.dir !== dir;
    const moved = Math.abs(ls.x - self.x) > 0.05 || Math.abs(ls.y - self.y) > 0.05 || Number.isNaN(ls.x);
    if ((changedState && !moving) || ((moved || changedState) && this.sendAcc >= 1 / SEND_HZ)) {
      this.sendAcc = 0;
      const x = Math.round(self.x * 10) / 10;
      const y = Math.round(self.y * 10) / 10;
      this.ctx.net.sendMove([x, y, dir, moving ? 1 : 0]);
      ls.x = self.x;
      ls.y = self.y;
      ls.dir = dir;
      ls.moving = moving;
    }

    const z = zoneAt(self.x, self.y);
    if (z !== this.zone) {
      this.zone = z;
      this.ctx.onZoneChange?.(z);
    }

    // 상호작용 가능 여부 (바뀔 때만 HUD 에 알림)
    const st: InteractState = {
      nearFood: !self.bath && nearSpot(WORLD.spots.foodtruck, self.x, self.y),
      nearSpring: !self.bath && nearSpringEdge(self.x, self.y),
      nearBoard: !self.bath && nearSpot(WORLD.spots.board, self.x, self.y),
      bath: self.bath,
      food: self.food,
      eating: self.eating,
    };
    const key = JSON.stringify(st);
    if (key !== this.interactKey) {
      this.interactKey = key;
      this.ctx.onInteract?.(st);
    }
  }

  private separate(dt: number) {
    const list = [...this.avatars.values()];
    for (const a of list) {
      a.sepTX = 0;
      a.sepTY = 0;
    }
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const ox = b.x - a.x;
        const oy = b.y - a.y;
        if (Math.abs(ox) > SEP_RADIUS || Math.abs(oy) > SEP_RADIUS) continue;
        const d = Math.hypot(ox, oy);
        if (d >= SEP_RADIUS) continue;
        const f = (SEP_RADIUS - d) * 0.5;
        const nx = d > 0.01 ? ox / d : 1;
        const ny = d > 0.01 ? oy / d : 0;
        a.sepTX -= nx * f;
        a.sepTY -= ny * f * 0.5;
        b.sepTX += nx * f;
        b.sepTY += ny * f * 0.5;
      }
    const k = 1 - Math.pow(0.002, dt);
    for (const a of list) {
      if (a.isSelf) {
        a.sepX = a.sepY = 0;
        continue;
      }
      const tx = Phaser.Math.Clamp(a.sepTX, -6, 6);
      const ty = Phaser.Math.Clamp(a.sepTY, -3, 3);
      a.sepX += (tx - a.sepX) * k;
      a.sepY += (ty - a.sepY) * k;
    }
  }

  /** 내 캐릭터의 음식 정보 (메뉴 표시용) */
  selfFood() {
    return foodDef(this.self?.food);
  }

  private renderOverlay() {
    const cam = this.cameras.main;
    this.ctx.overlay.render(cam, this.scale.width, this.scale.height);
  }
}
