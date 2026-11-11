/**
 * 빔프로젝터 무대 화면 (관객용) — 우수 PAIR 경품 가챠 · 오늘의 행운은 누구에게?
 *  - 1920×1080 기준으로 그리고 화면 크기에 맞춰 통째로 확대/축소 (16:9)
 *  - 결과는 서버가 이미 확정한 것만 보여줌 (연출은 공개 순서·타이밍만 담당)
 *  - 학회장 조작 버튼·개인정보 없음
 */
import { gradeLabel } from '../../../shared/foods';
import { GACHA_SPIN_MS, LUCKY_SPIN_MS, type PairTeam, type StageState, type StageWinner } from '../../../shared/events';
import { TEAMS, teamSvg } from '../../../shared/social';
import { buildCharacterSheet, FRAME_H, FRAME_W } from '../game/art/characters';
import { capsule, CAPSULE_COLORS, gachaHandle, gachaMachine, giftBox, pixelEl, prizeIcon, starIcon } from '../game/art/prizes';
import type { WorldStore } from '../state/WorldStore';
import { h } from './dom';
import { chime } from './HideSeekUi';

function avatar(look: number, frame: 'v' | 'stand' = 'v', scale = 8): HTMLCanvasElement {
  const sheet = buildCharacterSheet(look);
  const c = document.createElement('canvas');
  c.width = FRAME_W;
  c.height = FRAME_H;
  const [col, row] = frame === 'v' ? [3, 4] : [0, 0];
  c.getContext('2d')!.drawImage(sheet, col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
  return pixelEl(c, scale, 'avatar');
}

function teamBadge(t: PairTeam) {
  const tm = TEAMS[t.badge];
  return tm ? h('span', { class: 'st-badge', style: `--tc:${tm.color}`, html: teamSvg(tm.symbol, '#fff') }) : null;
}

export class StageShow {
  readonly el: HTMLElement;
  private board: HTMLElement;
  private timer = 0;
  private later: number[] = [];
  private seq = -1;

  constructor(private store: WorldStore) {
    this.board = h('div', { class: 'st-board' });
    this.el = h('div', { class: 'stage-show hidden' }, this.board);
    store.on('stage', (st) => this.apply(st));
    store.on('reset', () => this.apply(store.stage));
    window.addEventListener('resize', () => this.fit());
    this.apply(store.stage);
  }

  private fit() {
    const r = this.el.getBoundingClientRect();
    const k = Math.min(r.width / 1920, r.height / 1080) || 0.5;
    this.board.style.transform = `translate(-50%, -50%) scale(${k})`;
  }

  private wait(ms: number, fn: () => void) {
    this.later.push(window.setTimeout(fn, Math.max(0, ms)));
  }

  private apply(st: StageState) {
    if (st.seq === this.seq && st.mode !== 'idle') return;
    this.seq = st.seq;
    this.later.forEach(clearTimeout);
    this.later = [];
    clearInterval(this.timer);
    const on = st.mode !== 'idle';
    this.el.classList.toggle('hidden', !on);
    document.body.classList.toggle('stage-on', on);
    if (!on) return;
    requestAnimationFrame(() => this.fit());
    setTimeout(() => this.fit(), 50);
    const head = (title: string, sub?: string) =>
      h('header', { class: 'st-head' }, h('p', { class: 'st-event' }, '짝선짝후 2026 PAIR'), h('h1', {}, title), sub ? h('p', { class: 'st-sub' }, sub) : null);
    if (st.mode === 'gacha') this.gacha(st, head);
    if (st.mode === 'gachaSummary') {
      this.board.replaceChildren(
        head('우수 PAIR 경품 추첨 결과'),
        h(
          'div',
          { class: 'st-cards' },
          ...st.results.map((r) =>
            h(
              'div',
              { class: 'st-card' },
              h('div', { class: 'st-card-team' }, teamBadge(r.team), h('b', {}, r.team.name)),
              h('p', { class: 'st-members' }, r.team.members),
              h('div', { class: 'st-card-icon' }, pixelEl(prizeIcon(r.itemId), 8)),
              h('strong', { class: 'st-prize-name' }, r.itemName),
            ),
          ),
        ),
        h('p', { class: 'st-foot' }, '수상을 축하합니다!'),
        this.confetti(40),
      );
      chime([784, 988, 1175, 1568], 0.09);
    }
    if (st.mode === 'lucky') this.lucky(st, head);
    if (st.mode === 'luckySummary') {
      this.board.replaceChildren(
        head('오늘의 행운은 누구에게?', '배달의민족 상품권 당첨자'),
        h('div', { class: 'st-cards' }, ...st.winners.map((w) => this.winnerCard(w))),
        h('p', { class: 'st-foot' }, '축하합니다! 행사장에서 상품권을 받아가세요'),
        this.confetti(40),
      );
      chime([784, 988, 1175, 1568], 0.09);
    }
  }

  // ---------------------------------------------------------------- 가챠

  private gacha(st: Extract<StageState, { mode: 'gacha' }>, head: (t: string, s?: string) => HTMLElement) {
    const machine = h('div', { class: 'gacha' });
    const glass = h('div', { class: 'gacha-balls' });
    for (let i = 0; i < 9; i++) {
      const b = pixelEl(capsule(i), 4, 'ball');
      b.style.left = `${92 + (i % 3) * 66 + (Math.floor(i / 3) % 2) * 30}px`;
      b.style.top = `${52 + Math.floor(i / 3) * 50}px`;
      b.style.animationDelay = `${-i * 0.13}s`;
      glass.append(b);
    }
    const handle = pixelEl(gachaHandle(), 6, 'handle');
    const out = h('div', { class: 'gacha-out' });
    machine.append(pixelEl(gachaMachine(), 6, 'body'), glass, handle, out);
    const teamCard = h(
      'div',
      { class: 'st-team' },
      h('small', {}, `우수 PAIR · ${st.done + (st.phase === 'spin' ? 0 : 1)} / ${st.total}`),
      h('div', { class: 'st-card-team' }, teamBadge(st.team), h('b', {}, st.team.name)),
      h('p', { class: 'st-members' }, st.team.members),
    );
    const left = h(
      'aside',
      { class: 'st-remain' },
      h('small', {}, st.phase === 'spin' ? '이번 후보' : '남은 상품'),
      ...st.pool.map((p) => h('div', { class: 'st-remain-item' }, pixelEl(prizeIcon(p.id), 3), h('span', {}, p.name))),
    );
    const result = h('div', { class: 'st-result hidden' });
    this.board.replaceChildren(head('우수 PAIR 경품 가챠'), teamCard, h('div', { class: 'gacha-stage' }, left, machine), result);
    if (st.phase !== 'spin' || !st.result) {
      machine.classList.add('idle');
      return;
    }
    // 서버 시각 기준 타임라인: 준비(0.8s) → 회전(2s) → 캡슐(0.8s) → 공개
    const start = st.revealAt - GACHA_SPIN_MS;
    const at = (ms: number) => start + ms - this.store.serverNow();
    const res = st.result;
    this.wait(at(0), () => {
      machine.classList.add('turn');
      chime([523, 659], 0.12);
    });
    this.wait(at(800), () => {
      machine.classList.add('shake');
      let k = 0;
      this.timer = window.setInterval(() => {
        if (++k % 3 === 0) chime([880 + (k % 4) * 60], 0.05);
      }, 120);
    });
    this.wait(at(2800), () => {
      clearInterval(this.timer);
      machine.classList.remove('shake');
      out.replaceChildren(pixelEl(capsule(st.pool.findIndex((p) => p.id === res.id) + 1), 6, 'drop'));
      chime([392, 523], 0.1);
    });
    this.wait(at(3200), () => {
      out.replaceChildren(pixelEl(capsule(1, true), 6, 'opened'), pixelEl(prizeIcon(res.id, true), 6, 'silhouette'));
    });
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      clearInterval(guard);
      result.classList.remove('hidden');
      result.replaceChildren(
        h(
          'div',
          { class: 'st-result-card' },
          h('p', { class: 'st-kicker' }, '가챠 결과 공개!'),
          h('div', { class: 'st-card-team big' }, teamBadge(st.team), h('b', {}, st.team.name)),
          h('div', { class: 'st-card-icon' }, pixelEl(prizeIcon(res.id), 10, 'pop')),
          h('strong', { class: 'st-prize-name big' }, res.name),
          h('p', { class: 'st-foot' }, '축하합니다!'),
        ),
        this.confetti(36),
      );
      chime([784, 988, 1175, 1568], 0.09);
    };
    // 타이머가 늦어도 시간이 되면 반드시 공개
    const guard = window.setInterval(() => at(GACHA_SPIN_MS) <= 0 && reveal(), 250);
    this.later.push(guard);
    if (at(GACHA_SPIN_MS) <= 0) reveal();
    else this.wait(at(GACHA_SPIN_MS), reveal);
  }

  // ---------------------------------------------------------------- 행운 추첨

  private winnerCard(w: StageWinner, cls = '') {
    const t = TEAMS[w.team];
    return h(
      'div',
      { class: `st-card winner ${cls}` },
      h('div', { class: 'st-avatar' }, avatar(w.look, 'v', 8)),
      h('div', { class: 'st-card-team' }, t ? h('span', { class: 'st-badge', style: `--tc:${t.color}`, html: teamSvg(t.symbol, '#fff') }) : null, h('b', {}, w.nickname)),
      h('p', { class: 'st-members' }, `${gradeLabel(w.grade as 0, w.gradeText)} · ${w.role === 'senior' ? '선배' : '후배'}`),
      h('div', { class: 'st-card-icon small' }, pixelEl(prizeIcon('baemin'), 4)),
    );
  }

  private lucky(st: Extract<StageState, { mode: 'lucky' }>, head: (t: string, s?: string) => HTMLElement) {
    const total = st.phase === 'drawn' ? st.winners.length : 3;
    const slots = h('div', { class: 'st-cards' });
    for (let i = 0; i < total; i++) {
      const w = st.winners[i];
      if (w && i < st.revealed - 1) slots.append(this.winnerCard(w));
      else slots.append(h('div', { class: 'st-card empty' }, pixelEl(giftBox(...(i % 2 ? (['#86c8f2', '#5aa3d6', '#ffd66e', '#ebb94a'] as const) : (['#ff8f7a', '#e2715f', '#ffd66e', '#ebb94a'] as const))), 8), h('b', {}, `${i + 1}번째 행운`)));
    }
    const info = h('p', { class: 'st-sub2' }, st.phase === 'ready' ? `추첨 대상 ${st.candidateCount}명 · 배달의민족 상품권 ${total}명` : `추첨 대상 ${st.candidateCount}명 중 ${st.winners.length}명`);
    this.board.replaceChildren(head('오늘의 행운은 누구에게?', '배달의민족 상품권 랜덤 추첨'), info, slots);
    if (st.phase !== 'drawn' || st.revealed < 1) return;
    // 지금 공개 중인 칸: 이름 룰렛 → 카운트다운 → 당첨자
    const idx = st.revealed - 1;
    const w = st.winners[idx];
    const slot = slots.children[idx] as HTMLElement;
    const left = st.revealAt - this.store.serverNow();
    let shown = false;
    const showWinner = () => {
      if (shown) return;
      shown = true;
      clearInterval(this.timer);
      const card = this.winnerCard(w, 'pop');
      slot.replaceWith(card);
      this.board.append(this.confetti(30));
      chime([784, 988, 1175, 1568], 0.09);
    };
    if (left <= 0) return showWinner();
    const roll = h('div', { class: 'st-card rolling' }, h('div', { class: 'st-roll-name' }, ''), h('div', { class: 'st-count' }, ''));
    slot.replaceWith(roll);
    const names = st.names.length ? st.names : [w.nickname];
    let k = 0;
    const tick = () => {
      const remain = st.revealAt - this.store.serverNow();
      if (remain <= 0) return showWinner(); // 타이머가 늦게 와도 시간이 되면 공개
      (roll.firstChild as HTMLElement).textContent = names[k++ % names.length];
      (roll.lastChild as HTMLElement).textContent = remain > 0 ? String(Math.ceil(remain / 1000)) : '';
      if (k % 2 === 0) chime([700 + (k % 5) * 40], 0.04);
    };
    tick();
    this.timer = window.setInterval(tick, left > 1200 ? 90 : 160);
    this.wait(Math.max(0, left - 1200), () => {
      clearInterval(this.timer);
      this.timer = window.setInterval(tick, 220);
    });
    this.wait(left, showWinner);
    void LUCKY_SPIN_MS;
  }

  // ---------------------------------------------------------------- 공용

  private confetti(n: number) {
    const box = h('div', { class: 'st-confetti' });
    for (let i = 0; i < n; i++) {
      const c = CAPSULE_COLORS[i % CAPSULE_COLORS.length][0];
      const p = i % 7 === 0 ? pixelEl(starIcon(4), 4, 'piece') : h('i', { class: 'piece', style: `background:${c}` });
      p.style.left = `${(i * 37) % 100}%`;
      p.style.animationDelay = `${(i % 10) * 0.12}s`;
      p.style.animationDuration = `${2.2 + (i % 5) * 0.35}s`;
      box.append(p);
    }
    return box;
  }
}
