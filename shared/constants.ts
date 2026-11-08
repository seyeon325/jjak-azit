/** 클라이언트·서버 공용 상수. 값을 바꾸면 양쪽에 동시에 반영됩니다. */
export const TILE = 16;
export const MAP_COLS = 60;
export const MAP_ROWS = 34;
export const WORLD_W = MAP_COLS * TILE; // 960px
export const WORLD_H = MAP_ROWS * TILE; // 544px

/** 서버가 위치를 브로드캐스트하는 주기 */
export const TICK_HZ = 15;
/** 클라이언트가 자기 위치를 보내는 주기 */
export const SEND_HZ = 15;
/** 원격 캐릭터 보간 지연 (네트워크 흔들림 흡수용) */
export const INTERP_DELAY_MS = 140;

/** 캐릭터 이동 속도 (px/s) */
export const MOVE_SPEED = 76;
/** 발 충돌 박스 (캐릭터 좌표 = 발 중앙 아래) */
export const FOOT_W = 10;
export const FOOT_H = 6;
/** 충돌 격자 해상도 */
export const COLLISION_CELL = 8;

export const NICK_MIN = 1;
export const NICK_MAX = 10;

export const LOOK_COUNT = 8;
export const COLOR_COUNT = 8;
