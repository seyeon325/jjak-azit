/** 접속 화면: 닉네임 → 선배/후배 → 캐릭터·색상 → 입장 */
import { COLOR_COUNT, LOOK_COUNT, NICK_MAX } from '../../../shared/constants';
import type { Profile, Role } from '../../../shared/protocol';
import { COLORS, LOOKS } from '../game/art/characters';
import { CharacterPreview } from './CharacterPreview';
import { h, icon, logoMark } from './dom';

export class LoginScreen {
  readonly el: HTMLElement;
  private nick: HTMLInputElement;
  private counter: HTMLSpanElement;
  private msg: HTMLParagraphElement;
  private submitBtn: HTMLButtonElement;
  private role: Role | null = null;
  private look = 0;
  private color = 0;
  private big: CharacterPreview;
  private bigName: HTMLSpanElement;
  private bigRole: HTMLSpanElement;
  private lookBtns: HTMLButtonElement[] = [];
  private colorBtns: HTMLButtonElement[] = [];
  private roleBtns: Record<Role, HTMLButtonElement>;
  private thumbs: CharacterPreview[] = [];
  private busy = false;

  constructor(
    private onSubmit: (p: Profile) => Promise<string | null>,
    initial: Profile | null,
  ) {
    if (initial) {
      this.role = initial.role;
      this.look = clamp(initial.look, LOOK_COUNT);
      this.color = clamp(initial.color, COLOR_COUNT);
    } else {
      this.look = Math.floor(Math.random() * LOOK_COUNT);
      this.color = Math.floor(Math.random() * COLOR_COUNT);
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
    if (initial) this.nick.value = initial.nickname;
    this.counter = h('span', { class: 'counter' });

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

    this.big = new CharacterPreview(this.look, this.color, 6, 'tour');
    this.bigName = h('span', { class: 'plate-name' });
    this.bigRole = h('span', { class: 'plate-role' });
    const bigPlate = h('div', { class: 'plate preview-plate' }, this.bigRole, this.bigName);

    const lookGrid = h('div', { class: 'look-grid', role: 'radiogroup', 'aria-label': '캐릭터 외형' });
    LOOKS.forEach((l, i) => {
      const thumb = new CharacterPreview(i, this.color, 3, 'idle');
      this.thumbs.push(thumb);
      const b = h(
        'button',
        { type: 'button', class: 'look-btn', role: 'radio', 'aria-label': l.name, onclick: () => this.setLook(i) },
        thumb.canvas,
        h('span', {}, l.name),
      );
      this.lookBtns.push(b);
      lookGrid.append(b);
    });

    const colorRow = h('div', { class: 'color-row', role: 'radiogroup', 'aria-label': '옷 색상' });
    COLORS.forEach((c, i) => {
      const b = h('button', {
        type: 'button',
        class: 'swatch',
        role: 'radio',
        title: c.name,
        'aria-label': c.name,
        style: `--c:${c.base};--cd:${c.dark}`,
        onclick: () => this.setColor(i),
      });
      this.colorBtns.push(b);
      colorRow.append(b);
    });

    this.msg = h('p', { class: 'login-msg', role: 'status', 'aria-live': 'polite' });
    this.submitBtn = h('button', { type: 'submit', class: 'btn-primary enter-btn' }, '아지트 입장하기');

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
      h(
        'section',
        { class: 'step' },
        h('div', { class: 'step-title' }, h('b', {}, '2'), '나는…'),
        h('div', { class: 'role-row' }, this.roleBtns.senior, this.roleBtns.junior),
      ),
      h(
        'section',
        { class: 'step' },
        h('div', { class: 'step-title' }, h('b', {}, '3'), '캐릭터 고르기'),
        h('div', { class: 'stage' }, h('div', { class: 'stage-floor' }), bigPlate, this.big.canvas),
        lookGrid,
        h('div', { class: 'color-label' }, '옷 색상'),
        colorRow,
      ),
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
  private setLook(i: number) {
    this.look = i;
    this.refresh();
  }
  private setColor(i: number) {
    this.color = i;
    this.thumbs.forEach((t, li) => t.set(li, i));
    this.refresh();
  }

  private refresh() {
    const len = Array.from(this.nick.value.trim()).length;
    this.counter.textContent = `${Math.min(len, NICK_MAX)}/${NICK_MAX}`;
    this.counter.classList.toggle('over', len > NICK_MAX);
    this.roleBtns.senior.classList.toggle('on', this.role === 'senior');
    this.roleBtns.junior.classList.toggle('on', this.role === 'junior');
    this.roleBtns.senior.setAttribute('aria-pressed', String(this.role === 'senior'));
    this.roleBtns.junior.setAttribute('aria-pressed', String(this.role === 'junior'));
    this.lookBtns.forEach((b, i) => {
      b.classList.toggle('on', i === this.look);
      b.setAttribute('aria-checked', String(i === this.look));
    });
    this.colorBtns.forEach((b, i) => {
      b.classList.toggle('on', i === this.color);
      b.setAttribute('aria-checked', String(i === this.color));
    });
    this.thumbs.forEach((t, i) => t.set(i, this.color));
    this.big.set(this.look, this.color);
    this.bigName.textContent = this.nickValue() || '닉네임';
    const plate = this.bigName.parentElement!;
    plate.classList.toggle('senior', this.role === 'senior');
    plate.classList.toggle('junior', this.role === 'junior');
    plate.classList.toggle('no-role', !this.role);
    this.bigRole.textContent = this.role ? (this.role === 'senior' ? '선배' : '후배') : '?';
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
    if (!this.role) {
      this.setMessage('선배인지 후배인지 골라주세요.');
      return;
    }
    this.busy = true;
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = '입장하는 중…';
    this.setMessage('', 'info');
    const err = await this.onSubmit({ nickname, role: this.role, look: this.look, color: this.color });
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

function clamp(n: number, count: number) {
  return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
}
