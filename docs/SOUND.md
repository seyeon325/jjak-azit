# 짝선짝후 아지트 — 사운드 안내

## 어떻게 만들어졌나요?
- **음원 파일이 없습니다.** 모든 배경음악·효과음·환경음은 브라우저(WebAudio)가 코드로 직접 합성하는 오리지널 8비트 소리입니다.
  기존 곡을 흉내 내지 않았고 외부 음원을 쓰지 않았으므로 저작권 문제가 없습니다.
- 코드: `client/src/audio/Sound.ts` (엔진·곡·효과음 목록), `client/src/audio/SoundDirector.ts` (언제 무엇을 틀지), `client/src/audio/SoundPanel.ts` (설정 화면)

## 어디서 소리가 나나요?
| 화면 | 기본값 | 비고 |
|---|---|---|
| 빔프로젝터 `/screen` | **켜짐** | 행사 메인 스피커. 처음 한 번 화면(또는 '🔊 소리 켜기')을 눌러야 브라우저가 소리를 허용 |
| 운영자 `/admin` | 꺼짐 | 같은 공간에서 빔프로젝터와 소리가 겹치지 않도록 |
| 참가자 휴대폰 | 꺼짐 | 메뉴 → 안내 → 소리에서 켜기·볼륨 조절 |

설정(켜기/끄기, 전체·배경음악·효과음·환경음 볼륨)은 화면마다 따로 저장됩니다. 관전 화면에서는 **S 키**로 켜기/끄기.

## 배경음악 (한 번에 한 곡, 바뀔 때 페이드)
| 곡 이름 | 언제 |
|---|---|
| `azit` | 평소 아지트 |
| `hsHide` | 운영자를 찾아라! — 숨는 시간 |
| `hsSearch` | 운영자를 찾아라! — 수색 |
| `victory` | 숨바꼭질 발견 직후 · 레이드 승리 |
| `stage` | 우수 PAIR 가챠 · 행운 추첨 무대 (빔프로젝터·운영자 화면) |
| `raidLobby` | 레이드 대기실 · 카운트다운 |
| `raid` → `raidShield` → `raidFinal` | 레이드 1페이즈 → 방어막 → 최후의 일격 |
| `awards` | 레이드 특별 시상식 |

우선순위: 레이드 > 숨바꼭질 > 무대 > 아지트. 레이드 패배 때는 음악을 멈춥니다.

## 효과음 ↔ 이벤트
| 분류 | 효과음 | 이벤트 |
|---|---|---|
| UI | `ui.open` / `ui.close` | 창(시트) 열기·닫기 |
| | `ui.notice` | 운영자 전체 공지 |
| | `ui.join` | 입장 (빔프로젝터만) |
| 게시판 | `board.post` · `board.comment` · `board.like` | 쪽지 작성 · 댓글 · 하트 |
| 채팅 | `chat.recv` | 다른 사람 메시지 (휴대폰만, 작게) |
| 캐릭터 | `emote` · `pose.jump/wave/dance` | 이모티콘 · 동작 |
| | `act.greet/heart/clap/plane/balloon/hammer` | 참가자 상호작용 |
| 푸드트럭 | `food.buy` · `food.eat` | 음식 받기 · 먹기 |
| 놀이터 | `ride.swing/seesaw/spring` · `ride.push` · `ride.slide` · `ride.launch` | 타기 · 그네 밀기 · 미끄럼틀 · 그네에서 퐁! |
| 온천 | `bath.in` · `bath.out` | 들어가기 · 나오기 |
| 벤치·테이블 | `sit` · `stand` · `table.full` | 앉기 · 일어나기 · 테이블 만석 |
| 숨바꼭질 | `hs.start` · `hs.search` · `hs.found` · `hs.fail` | 시작 · 수색 시작 · 발견 · 시간 초과 |
| 가챠·추첨 | `stage.roll` · `stage.tick` · `stage.drop` · `stage.reveal` | 돌리기 · 이름 넘어감 · 캡슐 · 결과 공개 |
| 레이드 | `raid.count` · `raid.go` | 카운트다운 · 전투 시작 |
| | `raid.atk` · `raid.hit` · `raid.boom` · `raid.evade` | 공격 · 피격 · 폭발 · 회피 |
| | `raid.down` · `raid.help` · `raid.revive` | 쓰러짐 · 살려줘! · 부활 |
| | `raid.warn` · `raid.coop` · `raid.shieldOff` · `raid.final` | 경고 패턴 · 협동 구역 · 방어막 해제 · 최후의 일격 |
| | `raid.victory` · `raid.defeat` | 승리 · 패배 |
| 시상식 | `award.reveal` | 수상자 공개 |
| 이스터에그 | `egg.found` | 최초 발견 |

환경음: 온천 물소리 · 모닥불 타닥 소리 (가까이 갈수록 크게, 레이드 전투 중에는 꺼짐)

## 시끄럽지 않게
- 같은 효과음은 정해진 간격(쿨타임) 안에 다시 울리지 않음
- 동시에 울리는 소리 최대 14개 (경고·승리음 등 중요한 소리는 예외)
- 거리 감쇠: 멀리서 난 소리는 작게, 너무 멀면 생략
- 레이드 공격음: 휴대폰은 내 공격만, 빔프로젝터는 작게
- 마스터에 리미터가 있어 갑자기 큰 소리가 나지 않음

## 음원 파일로 바꾸고 싶다면 (선택)
1. `client/public/sounds/bgm/<곡 이름>.ogg` 또는 `client/public/sounds/sfx/<효과음 이름>.ogg` 에 파일을 넣습니다.
   예: `client/public/sounds/bgm/azit.ogg`, `client/public/sounds/sfx/stage.reveal.ogg`
2. `client/src/audio/Sound.ts` 맨 위 `FILE_OVERRIDES` 에 `'bgm/azit'`, `'sfx/stage.reveal'` 처럼 이름을 추가합니다.
3. 파일을 불러오지 못하면 자동으로 코드 합성 소리로 돌아갑니다.
- **사용 허락을 받은 음원만** 넣어주세요. 현재는 넣은 파일이 없습니다.
