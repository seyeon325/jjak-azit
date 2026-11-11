/** 접속 화면: 닉네임 → 학년 → 선배/후배 → 캐릭터 → 입장 */
import { GRADE_TEXT_MAX, LOOK_COUNT, NICK_MAX } from '../../../shared/constants';
import { TEAMS, teamSvg } from '../../../shared/social';
import { gradeLabel } from '../../../shared/foods';
import type { Grade, Profile, Role } from '../../../shared/protocol';
import { LOOKS } from '../game/art/characters';
import { CharacterPreview, type PreviewDir } from './CharacterPreview';
import { h, icon, ICON, logoMark } from './dom';

const GRADES: Grade[] = [1, 2, 3, 4, 0];

export class LoginScreen {
  readonly el: HTMLElement;
  private nick: HTMLInputElement;
  private counter: HTMLSpanElement;
  private msg: HTMLParagraphElement;
  private submitBtn: HTMLButtonElement;
  private role: Role | null = null;
  private grade: Grade | null = null;
  private team = -1;
  private gradeInput: HTMLInputElement;
  private gradeOther: HTMLElement;
  private teamBtns: HTMLButtonElement[] = [];
  private look = 0;
  private big: CharacterPreview;
  private plate: HTMLDivElement;
  private lookName: HTMLElement;
  private lookDesc: HTMLElement;
  private walkBtn: HTMLButtonElement;
  private lookBtns: HTMLButtonElement[] = [];
  private gradeBtns: HTMLButtonElement[] = [];
  private roleBtns: Record<Role, HTMLButtonElement>;
  private thumbs: CharacterPreview[] = [];
  private busy = false;

  constructor(
    private onSubmit: (p: Profile) => Promise<string | null>,
    initial: Partial<Profile> | null,
    private teamNames: string[] = TEAMS.map((t) => t.defaultName),
  ) {
    // 이전 버전에 저장된 프로필(학년 없음)도 그대로 불러옵니다
    if (initial) {
      if (initial.role === 'senior' || initial.role === 'junior') this.role = initial.role;
      if (typeof initial.grade === 'number' && GRADES.includes(initial.grade)) this.grade = initial.grade;
      this.look = Number.isInteger(initial.look) && initial.look! >= 0 && initial.look! < LOOK_COUNT ? initial.look! : 0;
      if (typeof initial.team === 'number' && TEAMS.some((t) => t.id === initial.team)) this.team = initial.team;
    } else {
      this.look = Math.floor(Math.random() * LOOK_COUNT);
    }

    this.nick = h('input', {
      id: 'nick',
      type: 'text',
      maxlength: NICK_MAX * 2,
      autocomplete: 'off',
      enterkeyhint: 'done',
      placeholder: '아지트에서 쓸 이름',
      oninput: () => this.refresh(),
      onkeydown: (e) => {
        if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur();
      },
    });
    if (initial?.nickname) this.nick.value = initial.nickname;
    this.counter = h('span', { class: 'counter' });

    this.gradeInput = h('input', {
      type: 'text',
      maxlength: GRADE_TEXT_MAX * 2,
      placeholder: '예: 교수, 조교, 졸업생',
      autocomplete: 'off',
      oninput: () => this.refresh(),
    });
    if (initial?.gradeText) this.gradeInput.value = initial.gradeText;
    this.gradeOther = h('div', { class: 'grade-other hidden' }, h('label', {}, '소속을 직접 적어주세요 (선택)'), this.gradeInput);
    const teamRow = h('div', { class: 'team-row', role: 'radiogroup', 'aria-label': '팀' });
    [...TEAMS.map((t) => t.id), -1].forEach((id) => {
      const t = TEAMS[id];
      const b = h(
        'button',
        { type: 'button', class: 'team-btn', role: 'radio', style: t ? `--tc:${t.color};--td:${t.dark}` : '', onclick: () => this.setTeam(id) },
        t ? h('i', { html: teamSvg(t.symbol, '#ffffff') }) : h('i', { class: 'none' }, '?'),
        h('span', {}, t ? this.teamNames[id] ?? t.defaultName : '미정'),
      );
      this.teamBtns.push(b);
      teamRow.append(b);
    });
    const gradeRow = h('div', { class: 'grade-row', role: 'radiogroup', 'aria-label': '학년' });
    for (const g of GRADES) {
      const b = h(
        'button',
        { type: 'button', class: 'grade-btn', role: 'radio', onclick: () => this.setGrade(g) },
        g ? h('b', {}, String(g)) : null,
        g ? '학년' : '기타',
      );
      if (!g) b.title = '편입생·졸업생 등';
      this.gradeBtns.push(b);
      gradeRow.append(b);
    }

    this.roleBtns = {
      senior: h(
        'button',
        { type: 'button', class: 'role-btn senior', onclick: () => this.setRole('senior') },
        icon('crown', 'role-ico'),
        h('strong', {}, '선배'),
        h('small', {}, '아지트를 안내해요'),
      ),
      junior: h(
        'button',
        { type: 'button', class: 'role-btn junior', onclick: () => this.setRole('junior') },
        icon('sprout', 'role-ico'),
        h('strong', {}, '후배'),
        h('small', {}, '처음 놀러 왔어요'),
      ),
    };

    // 큰 미리보기
    this.big = new CharacterPreview(this.look, 5, 'tour');
    this.plate = h('div', { class: 'plate preview-plate' });
    this.lookName = h('strong', {});
    this.lookDesc = h('span', {});
    this.walkBtn = h('button', { type: 'button', class: 'stage-btn wide', onclick: () => this.toggleWalk() }, '걷기');
    const rotate = (d: 1 | -1) => {
      const order: PreviewDir[] = [0, 2, 1, 3];
      if (this.big.pose === 'tour') this.big.pose = 'idle';
      const i = order.indexOf(this.big.dir);
      this.big.dir = order[(i + d + 4) % 4];
      this.refresh();
    };
    const stage = h(
      'div',
      { class: 'stage' },
      this.plate,
      this.big.canvas,
      h('button', { type: 'button', class: 'stage-btn left', 'aria-label': '왼쪽으로 돌리기', onclick: () => rotate(-1) }, '◀'),
      h('button', { type: 'button', class: 'stage-btn right', 'aria-label': '오른쪽으로 돌리기', onclick: () => rotate(1) }, '▶'),
      h('div', { class: 'stage-caption' }, this.lookName, this.lookDesc),
      this.walkBtn,
    );

    const lookGrid = h('div', { class: 'look-grid', role: 'radiogroup', 'aria-label': '캐릭터' });
    LOOKS.forEach((l, i) => {
      const thumb = new CharacterPreview(i, 3, 'idle');
      this.thumbs.push(thumb);
      const b = h(
        'button',
        { type: 'button', class: 'look-btn', role: 'radio', 'aria-label': `${l.name} — ${l.desc}`, onclick: () => this.setLook(i) },
        thumb.canvas,
        h('span', {}, l.name),
      );
      this.lookBtns.push(b);
      lookGrid.append(b);
    });

    this.msg = h('p', { class: 'login-msg', role: 'status', 'aria-live': 'polite' });
    this.submitBtn = h('button', { type: 'submit', class: 'btn-primary enter-btn' }, '아지트 입장하기');

    const step = (n: number, title: string, ...body: (Node | null)[]) =>
      h('section', { class: 'step' }, h('div', { class: 'step-title' }, h('b', {}, String(n)), title), ...body);

    const form = h(
      'form',
      {
        class: 'login-card',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          this.submit();
        },
      },
      h(
        'header',
        { class: 'login-head' },
        logoMark('logo-mark big'),
        h('h1', {}, '짝선짝후 아지트'),
        h('p', {}, '2026 PAIR · AR·VR미디어디자인전공'),
      ),
      h(
        'section',
        { class: 'step' },
        h('label', { class: 'step-title', for: 'nick' }, h('b', {}, '1'), '닉네임'),
        h('div', { class: 'nick-field' }, this.nick, this.counter),
      ),
      step(2, '학년', gradeRow, this.gradeOther),
      step(3, '나는…', h('div', { class: 'role-row' }, this.roleBtns.senior, this.roleBtns.junior)),
      step(4, '우리 팀', teamRow),
      step(5, '캐릭터 고르기', stage, lookGrid),
      this.submitBtn,
      this.msg,
    );

    this.el = h(
      'div',
      { class: 'login' },
      h('div', { class: 'sky' }, h('i', { class: 'cloud c1' }), h('i', { class: 'cloud c2' }), h('i', { class: 'cloud c3' })),
      form,
      h('p', { class: 'login-foot' }, '같은 링크로 접속한 모두가 한 공간에서 만나요'),
    );
    this.refresh();
  }

  private nickValue() {
    return Array.from(this.nick.value.replace(/\s+/g, ' ').trim()).slice(0, NICK_MAX).join('');
  }

  private setRole(r: Role) {
    this.role = r;
    this.refresh();
  }
  private setGrade(g: Grade) {
    this.grade = g;
    this.refresh();
    if (g === 0) setTimeout(() => this.gradeInput.focus(), 50);
  }
  private setTeam(t: number) {
    this.team = t;
    this.refresh();
  }
  private gradeTextValue() {
    return Array.from(this.gradeInput.value.replace(/\s+/g, ' ').trim()).slice(0, GRADE_TEXT_MAX).join('');
  }
  private setLook(i: number) {
    this.look = i;
    this.big.pose = 'tour';
    this.refresh();
  }
  private toggleWalk() {
    this.big.pose = this.big.pose === 'idle' ? 'walk' : 'idle';
    this.refresh();
  }

  private refresh() {
    const len = Array.from(this.nick.value.trim()).length;
    this.counter.textContent = `${Math.min(len, NICK_MAX)}/${NICK_MAX}`;
    this.counter.classList.toggle('over', len > NICK_MAX);
    for (const r of ['senior', 'junior'] as Role[]) {
      this.roleBtns[r].classList.toggle('on', this.role === r);
      this.roleBtns[r].setAttribute('aria-pressed', String(this.role === r));
    }
    this.gradeOther.classList.toggle('hidden', this.grade !== 0);
    this.teamBtns.forEach((b, i) => {
      const id = i < TEAMS.length ? i : -1;
      b.classList.toggle('on', id === this.team);
      b.setAttribute('aria-checked', String(id === this.team));
    });
    this.gradeBtns.forEach((b, i) => {
      b.classList.toggle('on', GRADES[i] === this.grade);
      b.setAttribute('aria-checked', String(GRADES[i] === this.grade));
    });
    this.lookBtns.forEach((b, i) => {
      b.classList.toggle('on', i === this.look);
      b.setAttribute('aria-checked', String(i === this.look));
    });
    this.big.set(this.look);
    const L = LOOKS[this.look];
    this.lookName.textContent = L.name;
    this.lookDesc.textContent = L.desc;
    this.walkBtn.textContent = this.big.pose === 'walk' ? '멈추기' : this.big.pose === 'tour' ? '둘러보는 중' : '걷기';
    this.walkBtn.classList.toggle('on', this.big.pose !== 'idle');

    // 이름표 미리보기: [3학년] 닉네임
    const p = this.plate;
    p.className = `plate preview-plate ${this.role ?? 'no-role'}`;
    const badge = h('span', { class: 'plate-role' });
    if (this.role) badge.append(h('i', { html: this.role === 'senior' ? ICON.crown : ICON.sprout }));
    badge.append(this.grade === null ? '학년' : gradeLabel(this.grade, this.gradeTextValue()));
    const tm = TEAMS[this.team];
    p.replaceChildren(
      badge,
      h('span', { class: 'plate-name' }, this.nickValue() || '닉네임'),
      ...(tm ? [h('span', { class: 'plate-team', style: `--tc:${tm.color}`, html: teamSvg(tm.symbol, '#ffffff') })] : []),
    );
  }

  setMessage(text: string, kind: 'error' | 'info' = 'error') {
    this.msg.textContent = text;
    this.msg.dataset.kind = kind;
  }

  private async submit() {
    if (this.busy) return;
    const nickname = this.nickValue();
    if (!nickname) {
      this.setMessage('닉네임을 입력해주세요.');
      this.nick.focus();
      return;
    }
    if (this.grade === null) {
      this.setMessage('학년을 골라주세요.');
      return;
    }
    if (!this.role) {
      this.setMessage('선배인지 후배인지 골라주세요.');
      return;
    }
    this.busy = true;
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = '입장하는 중…';
    this.setMessage('', 'info');
    const err = await this.onSubmit({
      nickname,
      role: this.role,
      grade: this.grade,
      gradeText: this.grade === 0 ? this.gradeTextValue() : '',
      team: this.team,
      look: this.look,
      color: 0,
    });
    this.busy = false;
    this.submitBtn.disabled = false;
    this.submitBtn.textContent = '아지트 입장하기';
    if (err) this.setMessage(err);
  }

  destroy() {
    this.big.destroy();
    this.thumbs.forEach((t) => t.destroy());
    this.el.remove();
  }
}
