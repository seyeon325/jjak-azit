/**
 * 과제 괴물 레이드 장면 (참가자 화면 · 관전/빔프로젝터 화면 공용)
 *  - 서버가 보내는 상태(초당 10번)를 그대로 그림: 보스·경고 구역·협동 구역·참가자
 *  - 내 캐릭터만 화면에서 바로 움직이고(입력 지연 없음) 위치는 서버가 검증
 *  - 공격·피격·회피·부활은 서버 판정 결과(rfx)로 연출
 */
import Phaser from 'phaser';
import { RAID, type RaidFx, type RaidHazard, type RaidState } from '../../../../shared/raid';
import type { Network } from '../../net/Network';
import type { WorldStore } from '../../state/WorldStore';
import type { WorldOverlay } from '../../ui/WorldOverlay';
import { arena, BOSS_H, bossFrame, bossShield, paperFile, pencil, type BossMood } from '../art/raid';
import type { InputController } from '../InputController';
import { ensureCharacter, registerStaticTextures } from '../textures';

export interface RaidCtx {
  mode: 'player' | 'screen';
  store: WorldStore;
  net: Network;
  overlay: WorldOverlay;
  input?: InputController;
}

interface PSprite {
  id: number;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  key: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: number;
  moving: boolean;
  state: number;
  anim: string;
  /** 쓰러졌을 때 머리 위 '살려줘!' 표시 */
  help: Phaser.GameObjects.Text | null;
  ring: Phaser.GameObjects.Graphics | null;
}

const DIRK = ['d', 'u', 's', 's'];

export class RaidScene extends Phaser.Scene {
  private ctx!: RaidCtx;
  private boss!: Phaser.GameObjects.Image;
  private shield!: Phaser.GameObjects.Image;
  private gfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private ps = new Map<number, PSprite>();
  private me = { x: RAID.W / 2, y: RAID.H - 34, d: 0, dashUntil: 0, dashX: 0, dashY: 0, sent: 0, lastX: 0, lastY: 0 };
  private bossKey = '';
  private step = 0;
  private stepAt = 0;
  private unsubs: (() => void)[] = [];
  /** 연출용 보스 흔들림 */
  private shakeUntil = 0;

  constructor() {
    super('raid');
  }

  init(data: { ctx: RaidCtx }) {
    this.ctx = data.ctx;
  }

  create() {
    registerStaticTextures(this);
    const t = this.textures;
    if (!t.exists('raid-arena')) {
      t.addCanvas('raid-arena', arena());
      t.addCanvas('raid-shield', bossShield());
      t.addCanvas('raid-pencil', pencil());
      t.addCanvas('raid-paper', paperFile());
      t.addCanvas('raid-paper2', paperFile('#fff1c4'));
    }
    this.add.image(0, 0, 'raid-arena').setOrigin(0).setDepth(-1000);
    this.zoneGfx = this.add.graphics().setDepth(-900);
    this.gfx = this.add.graphics().setDepth(-800);
    this.boss = this.add.image(RAID.bossX, RAID.bossY + 22, this.bossTex('idle', 0, 0)).setOrigin(0.5, 1).setDepth(RAID.bossY);
    this.shield = this.add.image(RAID.bossX, RAID.bossY + 30, 'raid-shield').setOrigin(0.5, 1).setDepth(RAID.bossY + 1).setVisible(false);
    const cam = this.cameras.main;
    cam.setBackgroundColor('#f1e2ca');
    cam.setRoundPixels(true);
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
    this.unsubs.push(this.ctx.store.on('rfx', (list) => list.forEach((f) => this.fx(f))));
    // 내 위치는 서버 위치에서 시작
    const self = this.selfEntry();
    if (self) {
      this.me.x = self[1];
      this.me.y = self[2];
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
      for (const p of this.ps.values()) this.ctx.overlay.remove(p.id);
      this.ps.clear();
    });
  }

  private selfEntry() {
    const id = this.ctx.store.selfId;
    return this.ctx.mode === 'player' && id !== null ? this.ctx.store.raid.players.find((p) => p[0] === id) : undefined;
  }

  private fitCamera() {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    if (this.ctx.mode === 'screen') {
      const top = h > 600 ? 108 : 70;
      cam.setViewport(0, top, w, Math.max(100, h - top - 8));
      cam.setZoom(Math.min(cam.width / RAID.W, cam.height / RAID.H) * 0.99);
      cam.centerOn(RAID.W / 2, RAID.H / 2);
      return;
    }
    const fit = Math.min(w / RAID.W, h / RAID.H);
    cam.setZoom(Math.min(4, Math.max(fit, Math.min(w, h) / 200)));
    cam.setBounds(0, 0, RAID.W, RAID.H);
  }

  private bossTex(mood: BossMood, crack: number, step: number) {
    const key = `raid-boss-${mood}-${crack}-${step}`;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, bossFrame(mood, crack, step));
    return key;
  }

  // -------------------------------------------------------------- 행동 (UI 버튼·키보드)

  action(a: 'atk' | 'dodge' | 'revive' | 'final' | 'help') {
    const st = this.ctx.store.raid;
    if (st.phase !== 'battle' || st.paused) return;
    const now = this.time.now;
    if (a === 'dodge') {
      const v = this.ctx.input?.vector() ?? { x: 0, y: 0 };
      const len = Math.hypot(v.x, v.y);
      const [dx, dy] = len > 0.1 ? [v.x / len, v.y / len] : [[0, 1], [0, -1], [-1, 0], [1, 0]][this.me.d];
      this.me.dashUntil = now + 150;
      this.me.dashX = dx;
      this.me.dashY = dy;
    }
    this.ctx.net.socket.emit('ri', { a, x: this.me.x, y: this.me.y, d: this.me.d });
  }

  /** 지금 살릴 수 있는 동료가 가까이 있는지 */
  reviveTarget(range = RAID.reviveR): string | null {
    const id = this.ctx.store.selfId;
    let best: { d: number; name: string } | null = null;
    for (const p of this.ctx.store.raid.players) {
      if (p[0] === id || p[4] !== 1) continue;
      const d = Math.hypot(p[1] - this.me.x, p[2] - this.me.y);
      if (d <= range && (!best || d < best.d)) best = { d, name: this.ctx.store.players.get(p[0])?.info.nickname ?? '' };
    }
    return best ? best.name : null;
  }

  /** 내 위치에서 이 참가자까지 거리 */
  distTo(id: number) {
    const p = this.ctx.store.raid.players.find((q) => q[0] === id);
    return p ? Math.hypot(p[1] - this.me.x, p[2] - this.me.y) : Infinity;
  }

  /** 보스 머리 위 화면 좌표 (말풍선 위치용) */
  bossScreenPos() {
    const cam = this.cameras.main;
    const x = (this.boss.x - cam.worldView.x) * cam.zoom + cam.x;
    const y = (this.boss.y - BOSS_H - 4 - cam.worldView.y) * cam.zoom + cam.y;
    return { x, y };
  }

  // -------------------------------------------------------------- 프레임

  update(_t: number, dms: number) {
    const dt = Math.min(0.05, dms / 1000);
    const st = this.ctx.store.raid;
    this.syncPlayers(st, dt);
    this.drawBoss(st);
    this.drawHazards(st);
    this.drawZones(st);
    const cam = this.cameras.main;
    if (this.ctx.mode === 'player') {
      const mine = this.ps.get(this.ctx.store.selfId ?? -1);
      if (mine) {
        const hw = cam.width / cam.zoom / 2;
        const hh = cam.height / cam.zoom / 2;
        const tx = Phaser.Math.Clamp(mine.x, Math.min(hw, RAID.W / 2), Math.max(RAID.W - hw, RAID.W / 2));
        const ty = Phaser.Math.Clamp(mine.y - 20, Math.min(hh, RAID.H / 2), Math.max(RAID.H - hh, RAID.H / 2));
        cam.centerOn(cam.midPoint.x + (tx - cam.midPoint.x) * 0.2, cam.midPoint.y + (ty - cam.midPoint.y) * 0.2);
      }
    }
    this.ctx.overlay.render(cam, this.scale.width, this.scale.height);
  }

  private syncPlayers(st: RaidState, dt: number) {
    const { store } = this.ctx;
    const seen = new Set<number>();
    const selfId = this.ctx.mode === 'player' ? store.selfId : null;
    const now = this.time.now;
    for (const [id, sx, sy, , state, d] of st.players) {
      seen.add(id);
      const info = store.players.get(id)?.info;
      if (!info) continue;
      let p = this.ps.get(id);
      if (!p) {
        const key = ensureCharacter(this, info.look);
        const shadow = this.add.image(sx, sy, 'shadow').setOrigin(0.5, 0.6).setDepth(-700);
        const sprite = this.add.sprite(sx, sy, key, 'd0').setOrigin(0.5, 24 / 26);
        p = { id, sprite, shadow, key, x: sx, y: sy, tx: sx, ty: sy, dir: d, moving: false, state, anim: '', help: null, ring: null };
        this.ps.set(id, p);
        this.ctx.overlay.upsert(info, id === selfId);
      }
      p.state = state;
      if (id === selfId) {
        this.moveSelf(p, dt, now, state);
        // 서버와 크게 어긋나면 서버 위치로 (순간이동·벽 등)
        if (Math.hypot(sx - this.me.x, sy - this.me.y) > 40 && now > this.me.dashUntil + 400) {
          this.me.x = sx;
          this.me.y = sy;
        }
        p.x = this.me.x;
        p.y = this.me.y;
      } else {
        p.tx = sx;
        p.ty = sy;
        const k = 1 - Math.pow(0.0005, dt);
        const nx = p.x + (p.tx - p.x) * k;
        const ny = p.y + (p.ty - p.y) * k;
        p.moving = Math.hypot(p.tx - p.x, p.ty - p.y) > 1.2;
        p.x = nx;
        p.y = ny;
        p.dir = d;
      }
      this.drawPlayer(p, st, now);
      this.ctx.overlay.setWorldPos(id, p.x, p.y - (state === 1 ? 10 : 0));
    }
    for (const [id, p] of this.ps)
      if (!seen.has(id)) {
        p.sprite.destroy();
        p.shadow.destroy();
        p.help?.destroy();
        p.ring?.destroy();
        this.ps.delete(id);
        this.ctx.overlay.remove(id);
      }
  }

  private moveSelf(p: PSprite, dt: number, now: number, state: number) {
    const st = this.ctx.store.raid;
    const canMove = (st.phase === 'battle' || st.phase === 'countdown') && !st.paused && state !== 1;
    let v = canMove ? this.ctx.input?.vector() ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    let speed = RAID.speed;
    if (canMove && now < this.me.dashUntil) {
      v = { x: this.me.dashX, y: this.me.dashY };
      speed = RAID.dodgeDist / 0.15;
    }
    const moving = v.x !== 0 || v.y !== 0;
    if (moving) {
      let nx = Phaser.Math.Clamp(this.me.x + v.x * speed * dt, 8, RAID.W - 8);
      let ny = Phaser.Math.Clamp(this.me.y + v.y * speed * dt, 40, RAID.H - 6);
      if (Math.hypot(nx - RAID.bossX, (ny - RAID.bossY) * 1.3) < RAID.bossR) {
        nx = this.me.x;
        ny = this.me.y;
      }
      this.me.x = nx;
      this.me.y = ny;
      if (now >= this.me.dashUntil) {
        if (Math.abs(v.x) > Math.abs(v.y) + 0.05) this.me.d = v.x < 0 ? 2 : 3;
        else this.me.d = v.y < 0 ? 1 : 0;
      }
    }
    p.moving = moving;
    p.dir = this.me.d;
    // 서버 전송 (초당 10번, 움직였을 때만)
    if (now - this.me.sent >= 100 && (Math.abs(this.me.x - this.me.lastX) > 0.2 || Math.abs(this.me.y - this.me.lastY) > 0.2)) {
      this.me.sent = now;
      this.me.lastX = this.me.x;
      this.me.lastY = this.me.y;
      this.ctx.net.socket.emit('ri', { x: Math.round(this.me.x * 10) / 10, y: Math.round(this.me.y * 10) / 10, d: this.me.d });
    }
  }

  private drawPlayer(p: PSprite, st: RaidState, now: number) {
    const s = p.sprite;
    s.setPosition(Math.round(p.x), Math.round(p.y));
    p.shadow.setPosition(Math.round(p.x), Math.round(p.y));
    s.setDepth(p.y);
    let anim = '';
    if (st.phase === 'victory' || st.phase === 'awards') anim = 'static:p3';
    else if (p.state === 1) anim = 'static:p5';
    else if (p.moving) anim = `${p.key}-walk-${DIRK[p.dir]}`;
    else anim = `static:${DIRK[p.dir]}0`;
    if (anim !== p.anim) {
      p.anim = anim;
      if (anim.startsWith('static:')) {
        s.anims.stop();
        s.setFrame(anim.slice(7));
      } else s.play(anim);
    }
    s.setFlipX(p.dir === 3 && p.state !== 1 && st.phase !== 'victory');
    s.setRotation(p.state === 1 ? -1.4 : 0);
    s.setAlpha(p.state === 2 ? 0.55 + 0.25 * Math.sin(now / 40) : p.state === 1 ? 0.75 : 1);
    // 쓰러진 동료: 깜빡이는 빨간 원 + 머리 위 '살려줘!' (멀리서도 잘 보이게)
    const down = p.state === 1 && st.phase === 'battle';
    if (down && !p.help) {
      p.help = this.add
        .text(0, 0, '살려줘!', { fontFamily: 'Galmuri11 Bold, Galmuri11, sans-serif', fontSize: '28px', color: '#ffffff', backgroundColor: '#e2715f', padding: { x: 8, y: 4 }, resolution: 2 })
        .setOrigin(0.5, 1)
        .setScale(0.3)
        .setDepth(5500);
      p.ring = this.add.graphics().setDepth(-650);
    }
    if (!down && p.help) {
      p.help.destroy();
      p.ring?.destroy();
      p.help = null;
      p.ring = null;
    }
    if (p.help && p.ring) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      p.help.setPosition(Math.round(p.x), Math.round(p.y) - 26 - pulse * 2);
      p.ring.clear();
      p.ring.lineStyle(2, 0xff6b6b, 0.5 + pulse * 0.5);
      p.ring.strokeEllipse(Math.round(p.x), Math.round(p.y), RAID.reviveR * 2, RAID.reviveR * 1.2);
    }
  }

  private drawBoss(st: RaidState) {
    const now = this.time.now;
    if (now - this.stepAt > 320) {
      this.step = (this.step + 1) % 2;
      this.stepAt = now;
    }
    const r = st.boss.max ? st.boss.hp / st.boss.max : 1;
    const crack = st.boss.mood === 'broken' || st.boss.mood === 'off' ? 3 : r <= 0.25 ? 3 : r <= 0.5 ? 2 : r <= 0.75 ? 1 : 0;
    const key = this.bossTex(st.boss.mood, crack, st.boss.mood === 'off' ? 0 : this.step);
    if (key !== this.bossKey) {
      this.boss.setTexture(key);
      this.bossKey = key;
    }
    const shake = st.boss.mood === 'hurt' || st.boss.mood === 'broken' || now < this.shakeUntil ? Math.sin(now / 25) * (st.boss.mood === 'broken' ? 2 : 1) : 0;
    const bob = st.phase === 'battle' ? Math.round(Math.sin(now / 400)) : 0;
    this.boss.setPosition(Math.round(st.boss.x + shake), RAID.bossY + 22 + bob);
    this.boss.setVisible(st.phase !== 'lobby' && st.phase !== 'off');
    this.shield.setVisible(st.boss.shield).setPosition(this.boss.x, this.boss.y + 8);
    if (st.boss.shield) this.shield.setAlpha(0.75 + 0.15 * Math.sin(now / 200));
  }

  private drawHazards(st: RaidState) {
    const g = this.gfx;
    g.clear();
    const now = this.ctx.store.serverNow();
    const COLORS: Record<RaidHazard['kind'], number> = { bomb: 0xff6b6b, deadline: 0xe2715f, revision: 0x957bd8 };
    for (const h of st.hazards) {
      const total = Math.max(1, h.hitAt - h.at);
      const k = Phaser.Math.Clamp((now - h.at) / total, 0, 1);
      const c = COLORS[h.kind];
      const blink = k > 0.7 && Math.floor(now / 90) % 2 === 0;
      if (h.shape === 'circle') {
        g.fillStyle(c, blink ? 0.32 : 0.18);
        g.fillCircle(h.x, h.y, h.r);
        g.fillStyle(c, 0.35);
        g.fillCircle(h.x, h.y, h.r * k);
        g.lineStyle(1, c, 0.95);
        g.strokeCircle(h.x, h.y, h.r);
      } else {
        g.fillStyle(c, blink ? 0.3 : 0.16);
        g.fillRect(h.x, h.y, h.w, h.h);
        g.fillStyle(c, 0.28);
        if (h.kind === 'revision') g.fillRect(h.x, h.y, h.w, h.h * k);
        else g.fillRect(h.x, h.y + h.h * (1 - k), h.w, h.h * k);
        g.lineStyle(1, c, 0.95);
        g.strokeRect(h.x + 0.5, h.y + 0.5, h.w - 1, h.h - 1);
      }
    }
  }

  private drawZones(st: RaidState) {
    const g = this.zoneGfx;
    g.clear();
    const now = this.time.now;
    for (const z of st.zones) {
      const c = z.on ? 0x7fd8b6 : 0xffd66e;
      g.fillStyle(c, z.on ? 0.45 : 0.22 + 0.08 * Math.sin(now / 200));
      g.fillCircle(z.x, z.y, RAID.coopR);
      g.lineStyle(2, z.on ? 0x3fa883 : 0xebb94a, 1);
      g.strokeCircle(z.x, z.y, RAID.coopR);
      if (!z.on && z.p > 0) {
        g.lineStyle(3, 0x3fa883, 1);
        g.beginPath();
        g.arc(z.x, z.y, RAID.coopR - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * z.p);
        g.strokePath();
      }
    }
  }

  // -------------------------------------------------------------- 일회성 연출

  private fx(f: RaidFx) {
    const p = f.id !== undefined ? this.ps.get(f.id) : undefined;
    const selfId = this.ctx.mode === 'player' ? this.ctx.store.selfId : null;
    if (f.k === 'atk' && p) {
      const key = f.id! % 2 ? 'raid-pencil' : Math.random() < 0.5 ? 'raid-paper' : 'raid-paper2';
      const o = this.add.image(p.x, p.y - 12, key).setDepth(5000);
      const tx = this.boss.x + Phaser.Math.Between(-14, 14);
      const ty = this.boss.y - 40 + Phaser.Math.Between(-10, 10);
      o.setRotation(Math.atan2(ty - o.y, tx - o.x));
      this.tweens.add({
        targets: o,
        x: tx,
        y: ty,
        duration: 260,
        ease: 'Quad.In',
        onComplete: () => {
          o.destroy();
          if (f.v) this.puff(tx, ty, 0xffffff);
        },
      });
    }
    if (f.k === 'boom' && f.x !== undefined && f.y !== undefined) {
      this.puff(f.x, f.y, f.s === 'revision' ? 0xb9a3ef : 0xff8f7a, f.s === 'deadline' ? 20 : 12);
      for (let i = 0; i < 3; i++) {
        const o = this.add.image(f.x + Phaser.Math.Between(-10, 10), f.y - 40, i % 2 ? 'raid-paper' : 'raid-paper2').setDepth(5000);
        this.tweens.add({ targets: o, y: f.y + Phaser.Math.Between(-6, 6), angle: Phaser.Math.Between(-90, 90), alpha: 0, duration: 380, ease: 'Quad.In', onComplete: () => o.destroy() });
      }
    }
    if (f.k === 'hit' && p) {
      p.sprite.setTint(0xff8080);
      this.time.delayedCall(180, () => p.sprite.clearTint());
      if (f.id === selfId) this.cameras.main.shake(90, 0.003);
    }
    if (f.k === 'evade' && p) this.floatText(p.x, p.y - 30, '회피!', '#5aa3d6');
    if (f.k === 'down' && p) this.floatText(p.x, p.y - 30, '쓰러짐', '#e2715f');
    if (f.k === 'revive' && p) {
      this.floatText(p.x, p.y - 30, f.v ? '부활!' : '다시 일어남', '#3fa883');
      this.puff(p.x, p.y - 8, 0x7fd8b6);
    }
    if (f.k === 'coop' && f.x !== undefined && f.y !== undefined) this.puff(f.x, f.y, 0x7fd8b6, 22);
    if (f.k === 'help' && p) {
      // '살려줘요!!' 큰 외침
      const t = this.add
        .text(p.x, p.y - 30, '살려줘요!!', { fontFamily: 'Galmuri11 Bold, Galmuri11, sans-serif', fontSize: '40px', color: '#e2715f', stroke: '#ffffff', strokeThickness: 8, resolution: 2 })
        .setOrigin(0.5, 1)
        .setScale(0.2)
        .setDepth(6000);
      this.tweens.add({ targets: t, scale: 0.45, duration: 180, ease: 'Back.Out' });
      this.tweens.add({ targets: t, y: p.y - 46, alpha: 0, delay: 900, duration: 500, onComplete: () => t.destroy() });
      this.puff(p.x, p.y - 8, 0xff6b6b, 26);
    }
    if (f.k === 'shieldOff') {
      this.puff(this.boss.x, this.boss.y - 30, 0x86c8f2, 40);
      this.shakeUntil = this.time.now + 500;
    }
    if (f.k === 'final' && p) {
      const o = this.add.image(p.x, p.y - 12, 'star').setDepth(5000).setScale(1.5);
      this.tweens.add({ targets: o, x: this.boss.x, y: this.boss.y - 40, duration: 380, ease: 'Quad.In', onComplete: () => o.destroy() });
    }
  }

  private puff(x: number, y: number, color: number, r = 10) {
    const g = this.add.graphics().setDepth(5001);
    const obj = { k: 0 };
    this.tweens.add({
      targets: obj,
      k: 1,
      duration: 260,
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, color, 1 - obj.k);
        g.strokeCircle(x, y, 2 + r * obj.k);
      },
      onComplete: () => g.destroy(),
    });
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: 'Galmuri11 Bold, Galmuri11, sans-serif', fontSize: '24px', color, stroke: '#ffffff', strokeThickness: 5, resolution: 2 })
      .setOrigin(0.5)
      .setScale(0.4)
      .setDepth(6000);
    this.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }
}
