/**
 * 메인 광장 씬: 맵 렌더링, 내 캐릭터 이동/전송, 다른 참가자 보간, 카메라,
 * 푸드트럭·온천·게시판 상호작용 감지.
 * mode 'player' = 참가자 화면 / 'screen' = 운영자 관전 화면
 */
import Phaser from 'phaser';
import { BATH_SPEED, CAMPFIRE_R, MOVE_SPEED, SEAT_RANGE, SEND_HZ, SLIDE_MS, WORLD_H, WORLD_W } from '../../../../shared/constants';
import type { FxEvent } from '../../../../shared/protocol';
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
  /** 가장 가까운 빈 좌석/놀이기구 */
  seat: { id: string; kind: string; d: number } | null;
  /** 앉아 있는 좌석 */
  seated: { id: string; kind: string } | null;
  /** 그네 밀어줄 수 있는 대상 */
  push: { seat: string; name: string; d: number } | null;
  nearSlide: number | null;
  inFire: boolean;
  /** 가장 가까운 다른 참가자 */
  player: { id: number; name: string; d: number } | null;
  following: number | null;
  sliding: boolean;
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
  onPlayerTap?: (id: number) => void;
  /** 관전 화면: 추적 대상이 사라졌을 때 */
  onTrackLost?: () => void;
  onReady?: () => void;
}

export type ScreenCamMode = 'all' | 'follow' | 'track' | 'free' | 'photo';

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
  trackId: number | null = null;
  private freeCam = { x: WORLD_W / 2, y: WORLD_H / 2, z: 0 };
  private seesawImg: Phaser.GameObjects.Image | null = null;
  private showTeams = true;

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
        if (patch.seat !== undefined) a.setSeat(patch.seat);
        if (patch.team !== undefined) a.setTeam(patch.team);
        if (patch.x !== undefined && patch.y !== undefined) {
          a.setPose(patch.x, patch.y, a.dir, false);
          if (a === this.self) this.lastSent.x = NaN;
        }
        this.ctx.overlay.upsert(info, info.id === store.selfId);
      }),
      store.on('eat', (info, food) => {
        this.avatars.get(info.id)?.playEat(food);
      }),
      store.on('emote', (info, kind) => this.avatars.get(info.id)?.showEmote(kind)),
      store.on('pose', (info, kind) => {
        const a = this.avatars.get(info.id);
        if (!a) return;
        a.playPoseAnim(kind);
        if (kind === 'dance') this.dancePuff(a);
      }),
      store.on('fx', (ev) => this.playFx(ev)),
      store.on('display', (d) => {
        this.showTeams = !d.hideTeams;
        for (const a of this.avatars.values()) a.setShowTeam(this.showTeams);
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
      if (p.kind === 'seesaw') this.seesawImg = obj as Phaser.GameObjects.Image;
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
    a.setShowTeam(this.showTeams);
    this.ctx.overlay.upsert(info, isSelf);
    if (!isSelf && this.ctx.mode === 'player') {
      a.sprite.setInteractive({ useHandCursor: true });
      a.sprite.on('pointerup', () => this.ctx.onPlayerTap?.(info.id));
    }
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
    if (id === this.trackId) {
      this.trackId = null;
      this.screenCamMode = 'all';
      this.ctx.onTrackLost?.();
    }
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
    const mode = this.screenCamMode;
    if (mode === 'free') {
      if (!this.freeCam.z) this.freeCam = { x: cam.midPoint.x, y: cam.midPoint.y, z: cam.zoom };
      tz = this.freeCam.z;
      tx = this.freeCam.x;
      ty = this.freeCam.y;
    }
    if (mode === 'track') {
      const a = this.trackId !== null ? this.avatars.get(this.trackId) : undefined;
      if (a) {
        tz = Phaser.Math.Clamp(fit * 2.6, fit, 4);
        const hw = cam.width / tz / 2;
        const hh = cam.height / tz / 2;
        tx = Phaser.Math.Clamp(a.displayX, hw, WORLD_W - hw);
        ty = Phaser.Math.Clamp(a.displayY - 8, hh, WORLD_H - hh);
      }
    }
    if (mode === 'follow' || mode === 'photo') {
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
        const pad = mode === 'photo' ? 48 : 90;
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

    this.updateRides();

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
    let raw = this.ctx.input?.vector() ?? { x: 0, y: 0 };
    // 따라가기: 직접 움직이면 끝, 아니면 상대 쪽으로 자동 이동
    const followId = this.ctx.store.self?.followId ?? null;
    if (followId !== null) {
      if (raw.x || raw.y) this.ctx.net.socket.emit('unfollow');
      else {
        const t = this.avatars.get(followId);
        if (!t || t.bath || Math.hypot(t.x - self.x, t.y - self.y) > 260) this.ctx.net.socket.emit('unfollow');
        else {
          const ddx = t.x - self.x;
          const ddy = t.y - self.y;
          const d = Math.hypot(ddx, ddy);
          if (d > 22) raw = { x: ddx / d, y: ddy / d };
        }
      }
    }
    // 먹는 중·앉은 중·미끄럼틀 타는 중에는 멈춤
    const v = self.eating || self.seat || self.scripted ? { x: 0, y: 0 } : raw;
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
    if (!self.seat && !self.scripted && ((changedState && !moving) || ((moved || changedState) && this.sendAcc >= 1 / SEND_HZ))) {
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
      ...this.nearbyInfo(self),
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

  /** 근처 좌석·놀이기구·참가자 판정 */
  private nearbyInfo(self: Avatar) {
    const store = this.ctx.store;
    const occupied = new Map<string, PlayerInfo>();
    for (const e of store.players.values()) if (e.info.seat) occupied.set(e.info.seat, e.info);
    let seat: InteractState['seat'] = null;
    let push: InteractState['push'] = null;
    if (!self.seat && !self.bath) {
      for (const st of WORLD.seats) {
        const d = Math.hypot(self.x - st.x, self.y - st.y);
        if (d > SEAT_RANGE + 6) continue;
        const who = occupied.get(st.id);
        if (!who && (!seat || d < seat.d)) seat = { id: st.id, kind: st.kind, d };
        if (who && st.kind === 'swing' && who.id !== store.selfId && d < 46 && (!push || d < push.d))
          push = { seat: st.id, name: who.nickname, d };
      }
      // 그네는 조금 멀리서도 밀 수 있게
      for (const st of WORLD.seats) {
        if (st.kind !== 'swing') continue;
        const who = occupied.get(st.id);
        const d = Math.hypot(self.x - st.x, self.y - st.y);
        if (who && who.id !== store.selfId && d < 46 && (!push || d < push.d)) push = { seat: st.id, name: who.nickname, d };
      }
    }
    const sl = WORLD.slide.enter;
    const ds = Math.hypot(self.x - sl.x, self.y - sl.y);
    const fire = WORLD.spots.campfire;
    let player: InteractState['player'] = null;
    for (const a of this.avatars.values()) {
      if (a === self || a.away) continue;
      const d = Math.hypot(a.x - self.x, a.y - self.y);
      if (d < 64 && (!player || d < player.d)) player = { id: a.info.id, name: a.info.nickname, d };
    }
    return {
      seat,
      seated: self.seat ? { id: self.seat.id, kind: self.seat.kind } : null,
      push,
      nearSlide: !self.seat && !self.bath && ds < SEAT_RANGE + 6 ? ds : null,
      inFire: Math.hypot(self.x - fire.x, self.y - fire.y) <= CAMPFIRE_R,
      player: self.bath ? null : player,
      following: store.self?.followId ?? null,
      sliding: self.scripted,
    };
  }

  /** 그네·시소·스프링 움직임 (모든 화면에서 같은 시간 기준) */
  private updateRides() {
    const t = Date.now() / 1000;
    const occupants = new Map<string, Avatar>();
    for (const a of this.avatars.values()) if (a.seat) occupants.set(a.seat.id, a);
    const seesawBoth = occupants.has('seesaw-0') && occupants.has('seesaw-1');
    const seesawPhase = seesawBoth ? Math.sin(t * 2.4) : 0;
    if (this.seesawImg) this.seesawImg.setRotation(seesawPhase * 0.14);
    for (const [id, a] of occupants) {
      const st = a.seat!;
      if (st.kind === 'swing') {
        const level = this.ctx.store.swings[id] ?? 0;
        const amp = 0.18 + level * 0.13;
        const ang = Math.sin(t * 2.6 + (id.endsWith('1') ? 1.3 : 0)) * amp;
        const L = 26;
        a.rideX = Math.sin(ang) * L * 0.6;
        a.rideY = -(1 - Math.cos(ang)) * L * 0.5 + Math.sin(ang) * 4;
        a.rideRot = ang * 0.5;
      } else if (st.kind === 'seesaw') {
        a.rideX = 0;
        a.rideY = (id.endsWith('0') ? -1 : 1) * seesawPhase * 5;
        a.rideRot = 0;
      } else if (st.kind === 'spring') {
        a.rideY = Math.sin(t * 6) * 1.5;
        a.rideRot = Math.sin(t * 3) * 0.12;
      } else {
        a.rideX = a.rideY = a.rideRot = 0;
      }
    }
  }

  private dancePuff(a: Avatar) {
    a.emit('sparkle', 3);
  }

  /** 상호작용 연출 */
  private playFx(ev: FxEvent) {
    const from = this.avatars.get(ev.from);
    const to = ev.to !== undefined ? this.avatars.get(ev.to) : undefined;
    const bubble = (id: number, text: string) => this.ctx.overlay.bubble(id, text, 1400);
    if (ev.kind === 'slide' && from) {
      const sl = WORLD.slide;
      const k = this.textures.get(`char-v2-${from.info.look}`) ? 0 : 0;
      void k;
      from.runScript(SLIDE_MS, (t) => {
        if (t < 0.28) {
          // 계단 올라가기
          const u = t / 0.28;
          return { x: sl.enter.x + (sl.top.x - sl.enter.x) * u, y: sl.enter.y + (sl.top.y - sl.enter.y) * u, frame: Math.floor(u * 8) % 2 ? 'u2' : 'u4' };
        }
        if (t < 0.85) {
          const u = (t - 0.28) / 0.57;
          const e = u * u;
          return { x: sl.top.x + (sl.bottom.x - sl.top.x) * e, y: sl.top.y + (sl.bottom.y - sl.top.y) * e - 6, frame: 'q1' };
        }
        const u = (t - 0.85) / 0.15;
        return { x: sl.bottom.x + (sl.exit.x - sl.bottom.x) * u, y: sl.bottom.y + (sl.exit.y - sl.bottom.y) * u - Math.sin(u * Math.PI) * 6, frame: 'p3' };
      });
      this.time.delayedCall(SLIDE_MS * 0.86, () => bubble(ev.from, '슝~!'));
      return;
    }
    if (ev.kind === 'launch' && to) {
      // 퐁! 그네에서 튕겨 나옴
      const sx = ev.x ?? to.x;
      const sy = ev.y ?? to.y;
      const ex = to.x;
      const ey = to.y;
      to.runScript(700, (t) => ({ x: sx + (ex - sx) * t, y: sy + (ey - sy) * t - Math.sin(t * Math.PI) * 34, frame: 'p4' }));
      bubble(ev.to!, '퐁!');
      this.time.delayedCall(720, () => {
        to.playPoseAnim('bump');
        to.emit('star', 4);
        this.cameras.main.shake(this.ctx.mode === 'player' && to.isSelf ? 120 : 0, 0.004);
        bubble(ev.to!, '아야야~');
      });
      return;
    }
    if (!from || !to) return;
    const fx = from.displayX;
    const fy = from.displayY - 12;
    const tx = to.displayX;
    const ty = to.displayY - 12;
    const fly = (key: string, dur: number, arc: number, onHit: () => void, rotate = false) => {
      const img = this.add.image(fx, fy, key).setDepth(9400);
      if (key === 'plane' && tx < fx) img.setFlipX(true);
      const o = { t: 0 };
      this.tweens.add({
        targets: o,
        t: 1,
        duration: dur,
        onUpdate: () => {
          img.setPosition(fx + (tx - fx) * o.t, fy + (ty - fy) * o.t - Math.sin(o.t * Math.PI) * arc);
          if (rotate) img.setRotation(o.t * 6);
        },
        onComplete: () => {
          img.destroy();
          onHit();
        },
      });
    };
    switch (ev.kind) {
      case 'greet':
        bubble(ev.from, '안녕~!');
        this.time.delayedCall(500, () => to.showEmote('heart'));
        break;
      case 'heart':
        for (let i = 0; i < 4; i++) this.time.delayedCall(i * 120, () => fly('heart', 600, 18 + i * 4, () => to.emit('heart', 1)));
        this.time.delayedCall(700, () => to.showEmote('heart'));
        break;
      case 'clap':
        from.showEmote('clap');
        this.time.delayedCall(300, () => {
          to.emit('sparkle', 6);
          to.emit('star', 2);
        });
        break;
      case 'plane':
        fly('plane', 900, 10, () => {
          to.playPoseAnim('surprised');
          to.showEmote('question');
          bubble(ev.to!, '편지다!');
        });
        break;
      case 'balloon':
        fly('balloon', 650, 26, () => {
          to.emit('drop', 10);
          to.playPoseAnim('surprised');
          to.showEmote('panic');
          bubble(ev.to!, '앗 차가워!');
        }, true);
        break;
      case 'hammer': {
        const h = this.add.image(tx, ty - 22, 'hammer').setDepth(9450).setOrigin(0.5, 1).setRotation(-1);
        this.tweens.add({
          targets: h,
          rotation: 0.4,
          duration: 160,
          ease: 'Quad.In',
          onComplete: () => {
            to.squash(0.45, 240);
            const imp = this.add.image(tx, ty - 8, 'impact').setDepth(9460);
            this.tweens.add({ targets: [imp, h], alpha: 0, duration: 400, delay: 200, onComplete: () => (imp.destroy(), h.destroy()) });
            bubble(ev.to!, '뿅!');
          },
        });
        break;
      }
    }
  }

  /** 자유 카메라 조작 (관전 화면) */
  panBy(dx: number, dy: number) {
    const cam = this.cameras.main;
    if (this.screenCamMode !== 'free') {
      this.screenCamMode = 'free';
      this.freeCam = { x: cam.midPoint.x, y: cam.midPoint.y, z: cam.zoom };
    }
    this.freeCam.x = Phaser.Math.Clamp(this.freeCam.x + dx / cam.zoom, 0, WORLD_W);
    this.freeCam.y = Phaser.Math.Clamp(this.freeCam.y + dy / cam.zoom, 0, WORLD_H);
  }
  zoomBy(f: number) {
    const cam = this.cameras.main;
    if (this.screenCamMode !== 'free') {
      this.screenCamMode = 'free';
      this.freeCam = { x: cam.midPoint.x, y: cam.midPoint.y, z: cam.zoom };
    }
    this.freeCam.z = Phaser.Math.Clamp(this.freeCam.z * f, this.fitZoom() * 0.8, 6);
  }
  resetFree() {
    this.freeCam.z = 0;
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
