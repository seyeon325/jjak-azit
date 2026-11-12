/**
 * 캔버스 위에 띄우는 DOM 레이어: 이름표, 말풍선, 구역 라벨.
 * 한글을 픽셀 확대 없이 선명하게 보여주기 위해 DOM 으로 그립니다.
 */
import { gradeLabel } from '../../../shared/foods';
import type { Zone } from '../../../shared/map';
import type { PlayerInfo } from '../../../shared/protocol';
import { LOOKS } from '../game/art/characters';
import { ICON } from './dom';
import { TEAMS, teamSvg } from '../../../shared/social';
import { EGG_BY_ID } from '../../../shared/events';

interface Plate {
  el: HTMLDivElement;
  bubble: HTMLDivElement | null;
  bubbleTimer: number;
  wx: number;
  wy: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  lift: number;
  /** 모자 높이만큼 이름표를 더 올림 */
  extra: number;
}

export interface CameraLike {
  worldView: { x: number; y: number; width: number; height: number };
  zoom: number;
  /** 캔버스 안에서 카메라 뷰포트의 위치 */
  x: number;
  y: number;
}

const HEAD_OFFSET = 20; // 발에서 머리 위까지(px, 월드 단위)
const TALL_HATS = new Set(['bunny', 'crown', 'mushroom', 'catBeanie', 'frog', 'bear']);

export class WorldOverlay {
  readonly root: HTMLDivElement;
  private plates = new Map<number, Plate>();
  private zoneEls: { el: HTMLDivElement; x: number; y: number }[] = [];
  private pops: { el: HTMLDivElement; x: number; y: number }[] = [];

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
      p = { el, bubble: null, bubbleTimer: 0, wx: info.x, wy: info.y, w: 0, h: 0, sx: 0, sy: 0, lift: 0, extra: 0 };
      this.plates.set(info.id, p);
    }
    const hat = LOOKS[info.look]?.hat;
    p.extra = hat === 'bunny' ? 6 : hat && TALL_HATS.has(hat) ? 3 : 0;
    const el = p.el;
    el.classList.toggle('self', isSelf);
    el.classList.toggle('senior', info.role === 'senior');
    el.classList.toggle('junior', info.role === 'junior');
    el.classList.toggle('away', info.status === 'away');
    el.classList.toggle('bathing', !!info.bath);
    el.replaceChildren();
    // [학년] 표시 — 색과 아이콘으로 선배/후배 구분
    const badge = document.createElement('span');
    badge.className = 'plate-role';
    badge.title = info.role === 'senior' ? '선배' : '후배';
    const ico = document.createElement('i');
    ico.innerHTML = info.role === 'senior' ? ICON.crown : ICON.sprout;
    badge.append(ico, gradeLabel(info.grade, info.gradeText));
    const team = TEAMS[info.team];
    if (team) {
      const t = document.createElement('span');
      t.className = 'plate-team';
      t.style.setProperty('--tc', team.color);
      t.innerHTML = teamSvg(team.symbol, '#ffffff');
      el.append(t);
    }
    el.style.setProperty('--team', team ? team.color : 'transparent');
    el.classList.toggle('has-team', !!team);
    const name = document.createElement('span');
    name.className = 'plate-name';
    name.textContent = info.nickname;
    el.append(badge, name);
    // 운영자 배지 (숨바꼭질 중에는 서버가 host=false 로 바꿔 숨김)
    if (info.host) {
      const s = document.createElement('span');
      s.className = 'plate-host';
      s.textContent = '운영자';
      el.append(s);
    }
    // 이스터에그 칭호: 이름표 위쪽 작은 배지 (학년·팀 심볼과 겹치지 않게 따로 줄)
    const egg = info.title ? EGG_BY_ID.get(info.title) : undefined;
    el.classList.toggle('has-title', !!egg);
    if (egg) {
      const t = document.createElement('span');
      t.className = 'plate-title';
      t.style.setProperty('--ec', egg.color);
      t.textContent = egg.title;
      el.append(t);
    }
    if (info.bath) {
      const s = document.createElement('span');
      s.className = 'plate-tag spring';
      s.textContent = '♨';
      el.append(s);
    }
    if (info.status === 'away') {
      const s = document.createElement('span');
      s.className = 'plate-away';
      s.textContent = '연결 끊김';
      el.append(s);
    }
    p.w = 0; // 다음 렌더에서 다시 측정
  }

  /** 표시 설정 (이름표·팀·말풍선 숨기기) */
  setHidden(o: { names: boolean; teams: boolean; bubbles: boolean }) {
    this.root.classList.toggle('hide-names', o.names);
    this.root.classList.toggle('hide-teams', o.teams);
    this.root.classList.toggle('hide-bubbles', o.bubbles);
  }

  /** 월드 위치에 잠깐 떠오르는 쪽지 (새 게시물 알림) */
  pop(wx: number, wy: number, text: string, color = '#fff1a8') {
    const el = document.createElement('div');
    el.className = 'world-pop';
    el.style.setProperty('--bg', color);
    el.textContent = text;
    this.root.appendChild(el);
    this.pops.push({ el, x: wx, y: wy });
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => {
      el.remove();
      this.pops = this.pops.filter((p) => p.el !== el);
    }, 4700);
  }

  /** 머리 위 짧은 말풍선 */
  bubble(id: number, text: string, ms = 1800, cls = '') {
    const p = this.plates.get(id);
    if (!p) return;
    if (!p.bubble) {
      p.bubble = document.createElement('div');
      p.bubble.className = 'bubble';
      this.root.appendChild(p.bubble);
    }
    p.bubble.textContent = text;
    p.bubble.className = `bubble ${cls}`;
    p.bubble.classList.remove('out');
    clearTimeout(p.bubbleTimer);
    p.bubbleTimer = window.setTimeout(() => {
      p.bubble?.classList.add('out');
      p.bubbleTimer = window.setTimeout(() => {
        p.bubble?.remove();
        p.bubble = null;
      }, 300);
    }, ms);
  }

  remove(id: number) {
    const p = this.plates.get(id);
    if (!p) return;
    p.el.remove();
    p.bubble?.remove();
    clearTimeout(p.bubbleTimer);
    this.plates.delete(id);
  }

  clear() {
    for (const id of [...this.plates.keys()]) this.remove(id);
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
      p.sy = (p.wy - HEAD_OFFSET - p.extra - v.y) * z + cam.y;
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
      const top = Math.round(p.sy - p.h - p.lift);
      p.el.style.transform = `translate3d(${Math.round(p.sx - p.w / 2)}px, ${top}px, 0)`;
      p.el.classList.toggle('stacked', p.lift > 0);
      if (p.bubble) p.bubble.style.transform = `translate3d(${Math.round(p.sx)}px, ${top - 4}px, 0) translate(-50%, -100%)`;
    }
    for (const pp of this.pops)
      pp.el.style.transform = `translate3d(${Math.round((pp.x - v.x) * z + cam.x)}px, ${Math.round((pp.y - v.y) * z + cam.y)}px, 0) translate(-50%, -100%)`;
    for (const zl of this.zoneEls) {
      zl.el.style.transform = `translate3d(${Math.round((zl.x - v.x) * z + cam.x)}px, ${Math.round((zl.y - v.y) * z + cam.y)}px, 0) translate(-50%, -50%)`;
    }
  }

  destroy() {
    this.root.remove();
  }
}
