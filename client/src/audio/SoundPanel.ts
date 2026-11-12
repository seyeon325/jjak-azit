/**
 * 소리 설정 UI
 *  - soundControls: 켜기/끄기 + 배경음악·효과음·환경음 볼륨 (참가자 메뉴 · 관전 화면 팝업에서 같이 사용)
 *  - unlockButton: 소리를 켜 두었지만 브라우저가 아직 막고 있을 때 크게 보이는 '소리 켜기' 버튼
 */
import { h } from '../ui/dom';
import type { Channel, Engine } from './Sound';

const LABEL: Record<Channel | 'master', string> = { master: '전체', bgm: '배경음악', sfx: '효과음', amb: '환경음' };

export function soundControls(e: Engine, note?: string) {
  const toggle = h('button', { type: 'button', class: 'snd-toggle' });
  const sliders = (['master', 'bgm', 'sfx', 'amb'] as const).map((c) => {
    const input = h('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      'aria-label': `${LABEL[c]} 볼륨`,
      oninput: () => e.setVolume(c, Number(input.value) / 100),
    });
    input.value = String(Math.round(e.settings[c] * 100));
    return h('label', { class: 'snd-row' }, h('span', {}, LABEL[c]), input);
  });
  const box = h('div', { class: 'snd-controls' }, toggle, h('div', { class: 'snd-sliders' }, ...sliders), note ? h('p', { class: 'muted small' }, note) : null);
  const render = () => {
    toggle.textContent = e.enabled ? (e.locked ? '🔈 화면을 눌러 소리 켜기' : '🔊 소리 켜짐 (누르면 끄기)') : '🔇 소리 꺼짐 (누르면 켜기)';
    toggle.classList.toggle('on', e.enabled);
    box.classList.toggle('off', !e.enabled);
  };
  toggle.addEventListener('click', () => e.setEnabled(!e.enabled));
  const off = e.onChange(render);
  render();
  // 화면에서 빠지면 구독 해제
  const mo = new MutationObserver(() => {
    if (!box.isConnected) {
      off();
      mo.disconnect();
    }
  });
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
  return box;
}

/** 관전 화면 · 학회장 화면용: 상단 버튼 + 펼치는 설정 */
export function soundButton(e: Engine) {
  const txt = document.createTextNode('');
  const panel = h('div', { class: 'snd-pop hidden' });
  const btn = h('button', { type: 'button', title: '소리 설정', onclick: (ev) => {
    ev.stopPropagation();
    const open = panel.classList.toggle('hidden') === false;
    if (open) panel.replaceChildren(soundControls(e, e.role === 'admin' ? '학회장 화면은 기본으로 꺼져 있어요. 빔프로젝터 화면과 같은 공간이면 꺼 두세요 (소리 겹침 방지).' : '빔프로젝터 화면이 행사 메인 스피커예요.'));
  } }, h('kbd', {}, 'S'), txt);
  const render = () => (txt.textContent = e.enabled ? (e.locked ? ' 소리 대기' : ' 소리 켜짐') : ' 소리 꺼짐');
  e.onChange(render);
  render();
  document.addEventListener('click', (ev) => {
    if (!panel.contains(ev.target as Node) && ev.target !== btn) panel.classList.add('hidden');
  });
  return { btn, panel };
}

/** 소리는 켜져 있는데 브라우저가 막은 상태 → 한 번 누르면 시작 */
export function unlockButton(e: Engine) {
  const b = h('button', { type: 'button', class: 'snd-unlock hidden' }, '🔊 소리 켜기', h('small', {}, '화면을 한 번 눌러주세요'));
  b.addEventListener('click', () => e.setEnabled(true));
  const render = () => b.classList.toggle('hidden', !e.locked);
  e.onChange(render);
  render();
  return b;
}
