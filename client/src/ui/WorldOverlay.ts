/**
 * 캔버스 위에 띄우는 DOM 레이어: 이름표, 구역 라벨.
 * 한글을 픽셀 확대 없이 선명하게 보여주기 위해 DOM 으로 그립니다.
 * (2차의 말풍선·이모트도 이 레이어에 붙이면 됩니다.)
 */
import type { PlayerInfo } from '../../../shared/protocol';
import type { Zone } from '../../../shared/map';

interface Plate {
  el: HTMLDivElement;
  wx: number;
  wy: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  lift: number;
}

export interface CameraLike {
  worldView: { x: number; y: number; width: number; height: number };
  zoom: number;
  /** 캔버스 안에서 카메라 뷰포트의 위치 */
  x: number;
  y: number;
}

const HEAD_OFFSET = 21; // 발에서 머리 위까지(px, 월드 단위)

export class WorldOverlay {
  readonly root: HTMLDivElement;
  private plates = new Map<number, Plate>();
  private zoneEls: { el: HTMLDivElement; x: number; y: number }[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'world-overlay';
    parent.appendChild(this.root);
  }

  upsert(info: PlayerInfo, isSelf: boolean) {
    let p = this.plates.get(info.id);
    if (!p) {
      const el = document.createElement('div');
      el.className = 'plate';
      this.root.appendChild(el);
      p = { el, wx: info.x, wy: info.y, w: 0, h: 0, sx: 0, sy: 0, lift: 0 };
      this.plates.set(info.id, p);
    }
    const el = p.el;
    el.classList.toggle('self', isSelf);
    el.classList.toggle('senior', info.role === 'senior');
    el.classList.toggle('junior', info.role === 'junior');
    el.classList.toggle('away', info.status === 'away');
    el.replaceChildren();
    const badge = document.createElement('span');
    badge.className = 'plate-role';
    badge.textContent = info.role === 'senior' ? '선배' : '후배';
    const name = document.createElement('span');
    name.className = 'plate-name';
    name.textContent = info.nickname;
    el.append(badge, name);
    if (info.status === 'away') {
      const s = document.createElement('span');
      s.className = 'plate-away';
      s.textContent = '연결 끊김';
      el.append(s);
    }
    p.w = 0; // 다음 렌더에서 다시 측정
  }

  setStatus(info: PlayerInfo, isSelf: boolean) {
    this.upsert(info, isSelf);
  }

  remove(id: number) {
    const p = this.plates.get(id);
    if (!p) return;
    p.el.remove();
    this.plates.delete(id);
  }

  clear() {
    for (const p of this.plates.values()) p.el.remove();
    this.plates.clear();
  }

  setWorldPos(id: number, x: number, y: number) {
    const p = this.plates.get(id);
    if (p) {
      p.wx = x;
      p.wy = y;
    }
  }

  addZoneLabels(zones: Zone[]) {
    for (const z of zones) {
      const el = document.createElement('div');
      el.className = `zone-label phase-${z.phase}`;
      const name = document.createElement('span');
      name.textContent = z.name;
      el.append(name);
      if (z.phase > 1) {
        const b = document.createElement('em');
        b.textContent = `${z.phase}차 예정`;
        el.append(b);
      }
      this.root.appendChild(el);
      this.zoneEls.push({ el, x: z.label.x, y: z.label.y });
    }
  }

  render(cam: CameraLike, viewW: number, viewH: number) {
    const v = cam.worldView;
    const z = cam.zoom;
    const list: Plate[] = [];
    for (const p of this.plates.values()) {
      if (!p.w) {
        p.w = p.el.offsetWidth;
        p.h = p.el.offsetHeight;
      }
      p.sx = (p.wx - v.x) * z + cam.x;
      p.sy = (p.wy - HEAD_OFFSET - v.y) * z + cam.y;
      p.lift = 0;
      const visible = p.sx > -80 && p.sx < viewW + 80 && p.sy > -40 && p.sy < viewH + 60;
      p.el.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) list.push(p);
    }
    // 이름표끼리 겹치면 위로 쌓기 (아래쪽 캐릭터가 앞에 있으므로 우선)
    list.sort((a, b) => b.sy - a.sy);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let guard = 0; guard < 6; guard++) {
        let bumped = false;
        for (let j = 0; j < i; j++) {
          const b = list[j];
          const ay = a.sy - a.lift;
          const by = b.sy - b.lift;
          if (Math.abs(a.sx - b.sx) < (a.w + b.w) / 2 + 2 && Math.abs(ay - by) < a.h + 1) {
            a.lift = a.sy - (by - a.h - 1);
            bumped = true;
          }
        }
        if (!bumped) break;
      }
    }
    for (const p of list) {
      p.el.style.transform = `translate3d(${Math.round(p.sx - p.w / 2)}px, ${Math.round(p.sy - p.h - p.lift)}px, 0)`;
      p.el.classList.toggle('stacked', p.lift > 0);
    }
    for (const zl of this.zoneEls) {
      zl.el.style.transform = `translate3d(${Math.round((zl.x - v.x) * z + cam.x)}px, ${Math.round((zl.y - v.y) * z + cam.y)}px, 0) translate(-50%, -50%)`;
    }
  }

  destroy() {
    this.root.remove();
  }
}
