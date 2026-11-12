/**
 * 채팅: 일반(전체 공개) · 모닥불(반경 안 참가자) · 벤치(같은 벤치 2인) · 테이블(같은 테이블 최대 4인)
 * 실제 받는 사람은 서버가 위치·좌석으로 다시 검증합니다.
 */
import { CHAT_MAX } from '../../../shared/constants';
import type { ChatChannel, ChatMessage } from '../../../shared/protocol';
import type { Network } from '../net/Network';
import type { WorldStore } from '../state/WorldStore';
import { h, icon } from './dom';

export interface ChannelState {
  fire: boolean;
  fireCount: number;
  bench: string | null;
  /** 테이블에 앉아 있을 때: 같이 앉은 사람 수(나 포함) — 2명 이상일 때만 대화 가능 */
  table: number | null;
}

const CH_LABEL: Record<ChatChannel, string> = { all: '일반', fire: '모닥불', bench: '벤치', table: '테이블' };

export class ChatBar {
  readonly el: HTMLElement;
  readonly mini: HTMLElement;
  private input: HTMLInputElement;
  private chips: HTMLElement;
  private logEl: HTMLElement;
  private msg: HTMLElement;
  private ch: ChatChannel = 'all';
  private userPicked = false;
  private state: ChannelState = { fire: false, fireCount: 0, bench: null, table: null };
  /** 마지막으로 그린 칩 — 같으면 다시 그리지 않음 (휴대폰에서 누르는 도중 버튼이 바뀌면 터치가 씹힘) */
  private chipKey = '';
  private log: ChatMessage[] = [];
  private open_ = false;

  constructor(
    private store: WorldStore,
    private net: Network,
    private onOpenChange: (open: boolean) => void,
  ) {
    this.input = h('input', {
      type: 'text',
      maxlength: CHAT_MAX * 2,
      placeholder: '메시지 입력',
      enterkeyhint: 'send',
      autocomplete: 'off',
      onkeydown: (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter') {
          e.preventDefault();
          this.send();
        }
        if (k === 'Escape') this.close();
        e.stopPropagation();
      },
    });
    this.chips = h('div', { class: 'chat-chips' });
    this.logEl = h('ul', { class: 'chat-log' });
    this.msg = h('p', { class: 'chat-msg' });
    this.el = h(
      'div',
      { class: 'chat-bar hidden' },
      this.logEl,
      h('div', { class: 'chat-head' }, this.chips, h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '채팅 닫기', onclick: () => this.close() }, icon('close'))),
      this.msg,
      h(
        'form',
        {
          class: 'chat-form',
          onsubmit: (e) => {
            e.preventDefault();
            this.send();
          },
        },
        this.input,
        h('button', { type: 'submit', class: 'btn-primary small' }, '보내기'),
      ),
    );
    this.mini = h('ul', { class: 'chat-mini', onclick: () => this.open() });

    store.on('chat', (m) => this.receive(m));
    // 휴대폰 키보드가 올라오면 입력창을 키보드 위로
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => {
        const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        this.el.style.setProperty('--kb', `${gap}px`);
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
    this.renderChips();
  }

  get isOpen() {
    return this.open_;
  }

  setState(s: ChannelState) {
    const prev = this.state;
    this.state = s;
    const tableOk = (x: ChannelState) => (x.table ?? 0) >= 2;
    // 채널 자동 선택: 벤치 > 모닥불 > 일반 (사용자가 고른 건 유지, 단 쓸 수 없게 되면 해제)
    if (this.ch === 'bench' && !s.bench) this.ch = 'all';
    if (this.ch === 'fire' && !s.fire) this.ch = 'all';
    if (this.ch === 'table' && !tableOk(s)) this.ch = 'all';
    if (!this.userPicked || this.ch === 'all') {
      if (s.bench && !prev.bench) this.ch = 'bench';
      else if (tableOk(s) && !tableOk(prev)) this.ch = 'table';
      else if (s.fire && !prev.fire && this.ch === 'all') this.ch = 'fire';
    }
    if (!s.bench && !s.fire && !tableOk(s)) this.userPicked = false;
    this.renderChips();
  }

  get channel() {
    return this.ch;
  }

  private renderChips(force = false) {
    const opts: { ch: ChatChannel; label: string }[] = [{ ch: 'all', label: '일반 (모두)' }];
    if (this.state.fire) opts.push({ ch: 'fire', label: `모닥불 ${this.state.fireCount}명` });
    if (this.state.bench) opts.push({ ch: 'bench', label: `벤치 · ${this.state.bench}` });
    if ((this.state.table ?? 0) >= 2) opts.push({ ch: 'table', label: `테이블 ${this.state.table}/4` });
    const key = `${this.ch}|${opts.map((o) => o.ch + o.label).join('|')}`;
    if (!force && key === this.chipKey) return;
    this.chipKey = key;
    this.chips.replaceChildren(
      ...opts.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: `chat-chip ch-${o.ch} ${o.ch === this.ch ? 'on' : ''}`,
            onclick: () => {
              this.ch = o.ch;
              this.userPicked = true;
              this.renderChips();
              this.input.focus();
            },
          },
          o.label,
        ),
      ),
    );
    this.input.placeholder =
      this.ch === 'all'
        ? '모두에게 보내기'
        : this.ch === 'fire'
          ? '모닥불에 있는 사람에게만'
          : this.ch === 'table'
            ? '같은 테이블 사람에게만 (비공개)'
            : `${this.state.bench} 님에게만 (비공개)`;
    this.el.dataset.ch = this.ch;
  }

  open(ch?: ChatChannel) {
    if (ch && (ch === 'all' || (ch === 'fire' && this.state.fire) || (ch === 'bench' && this.state.bench) || (ch === 'table' && (this.state.table ?? 0) >= 2))) {
      this.ch = ch;
      this.userPicked = true;
    }
    this.renderChips();
    this.open_ = true;
    this.el.classList.remove('hidden');
    this.renderLog();
    this.onOpenChange(true);
    setTimeout(() => this.input.focus(), 30);
  }

  close() {
    this.open_ = false;
    this.el.classList.add('hidden');
    this.input.blur();
    this.onOpenChange(false);
  }

  private async send() {
    const text = this.input.value.trim();
    if (!text) return;
    const res = await this.net.req('chat', { ch: this.ch, text });
    if (!res.ok) {
      this.msg.textContent = res.reason;
      setTimeout(() => (this.msg.textContent = ''), 3000);
      return;
    }
    this.input.value = '';
    this.msg.textContent = '';
  }

  private receive(m: ChatMessage) {
    this.log.push(m);
    if (this.log.length > 80) this.log.shift();
    if (this.open_) this.renderLog();
    this.renderMini(m);
  }

  private line(m: ChatMessage) {
    const mine = m.from === this.store.selfId;
    return h(
      'li',
      { class: `ch-${m.ch} ${mine ? 'mine' : ''}` },
      m.ch !== 'all' ? h('em', {}, CH_LABEL[m.ch]) : null,
      h('b', {}, m.nickname),
      h('span', {}, m.text),
    );
  }

  private renderLog() {
    this.logEl.replaceChildren(...this.log.slice(-40).map((m) => this.line(m)));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private renderMini(m: ChatMessage) {
    const li = this.line(m);
    this.mini.append(li);
    while (this.mini.children.length > 3) this.mini.firstElementChild?.remove();
    setTimeout(() => li.classList.add('old'), 7000);
    setTimeout(() => li.remove(), 9000);
  }
}
