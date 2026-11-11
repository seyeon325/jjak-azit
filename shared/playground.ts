/**
 * 놀이기구 공용 계산 (서버·클라이언트가 같은 식으로 움직임을 계산 → 모든 화면이 같은 모습)
 *
 * 그네: 상단 막대를 회전축으로 하는 진자.
 *   각도 θ(t) = A(t) · sin(ω · (t − epoch))
 *   A(t)  = 밀 때마다 커지고, 시간이 지나면 지수적으로 줄어듦 (탑승 중엔 살짝 '발 구르기' 최소값 유지)
 *   sin 이므로 양 끝에서 감속, 가운데에서 가장 빠름
 */

export interface SwingState {
  /** 기준 시각의 진폭 (라디안) */
  amp: number;
  /** amp 를 잰 서버 시각 */
  at: number;
  /** 위상 기준 시각 (θ = A·sin(ω(t−epoch))) */
  epoch: number;
}

export const SWING = {
  /** 한 번 왕복 시간 (ms) */
  period: 1900,
  /** 진폭 감소 시간 상수 (ms) */
  decay: 9000,
  /** 탑승 중 최소 진폭 (스스로 살짝 구르기) */
  ridingMin: 0.16,
  /** 한 번 밀 때 늘어나는 진폭 */
  pushBoost: 0.22,
  max: 1.05,
  /** 이 진폭 이상에서 또 밀면 '퐁!' */
  launchAt: 0.68,
  /** 줄 길이 (px, 상단 막대 ~ 좌석) */
  rope: 28,
};

export const SWING_OMEGA = (Math.PI * 2) / SWING.period;

export function swingAmp(st: SwingState | undefined, t: number, occupied: boolean): number {
  if (!st) return occupied ? SWING.ridingMin : 0;
  const a = st.amp * Math.exp(-Math.max(0, t - st.at) / SWING.decay);
  return occupied ? Math.max(a, SWING.ridingMin) : a < 0.01 ? 0 : a;
}

export function swingAngle(st: SwingState | undefined, t: number, occupied: boolean): number {
  const a = swingAmp(st, t, occupied);
  if (!a) return 0;
  const epoch = st?.epoch ?? 0;
  return a * Math.sin(SWING_OMEGA * (t - epoch));
}

/**
 * 탑다운 3/4 시점에서 본 좌석 위치.
 * θ>0: 앞으로(화면 아래, 카메라 쪽) 나오며 커짐 / θ<0: 뒤로(위로) 올라가며 작아짐
 */
export function swingSeatOffset(theta: number) {
  const L = SWING.rope;
  const dy = L * Math.cos(theta) + L * 0.85 * Math.sin(theta) - L; // 기준(정지) 위치로부터
  const scale = 1 + 0.22 * Math.sin(theta);
  return { dy, scale, lean: theta * 0.35 };
}

/** 미끄럼틀 연출 시간표 (ms) */
export const SLIDE_TIMES = { climb: 1000, wait: 380, slide: 950, land: 320 };
export const SLIDE_TOTAL = SLIDE_TIMES.climb + SLIDE_TIMES.wait + SLIDE_TIMES.slide + SLIDE_TIMES.land;
