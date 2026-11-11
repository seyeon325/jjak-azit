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

/** 캐릭터 종류 수 */
export const LOOK_COUNT = 12;
/** (이전 버전 호환용) 옷 색상 번호 범위 — 현재 UI 에서는 사용하지 않음 */
export const COLOR_COUNT = 8;

/** 온천 안에서의 이동 속도 배율 */
export const BATH_SPEED = 0.5;
/** 음식을 먹는 데 걸리는 시간 */
export const EAT_MS = 2200;
/** 상호작용 버튼이 나타나는 거리 (px) */
export const INTERACT_RANGE = 40;
/** 게시판 쪽지 최대 글자 수 */
export const NOTE_MAX = 100;
/** 댓글 최대 글자 수 */
export const COMMENT_MAX = 60;
/** 채팅 최대 글자 수 */
export const CHAT_MAX = 80;
/** 학년 '기타' 직접 입력 최대 글자 수 */
export const GRADE_TEXT_MAX = 6;
/** 모닥불 대화 반경 (px) */
export const CAMPFIRE_R = 72;
/** 좌석·놀이기구에 앉을 수 있는 거리 (px) */
export const SEAT_RANGE = 30;
/** 미끄럼틀 타는 시간 */
export const SLIDE_MS = 1700;
/** 그네를 이만큼 밀면 '퐁!' */
export const SWING_LAUNCH = 5;
