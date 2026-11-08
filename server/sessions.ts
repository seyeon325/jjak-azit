/**
 * 세션 = 브라우저에 저장되는 토큰과 서버의 참가자를 잇는 연결고리.
 * 새로고침하거나 잠깐 연결이 끊겨도 토큰으로 같은 캐릭터에 복귀할 수 있습니다.
 * (서버 메모리에만 저장 — 서버를 재시작하면 참가자는 저장된 프로필로 자동 재입장합니다.)
 */
export interface Session {
  token: string;
  playerId: number;
  nickname: string;
  socketId: string | null;
  graceTimer: NodeJS.Timeout | null;
}

export class SessionStore {
  private byToken = new Map<string, Session>();

  create(token: string, playerId: number, nickname: string): Session {
    const s: Session = { token, playerId, nickname, socketId: null, graceTimer: null };
    this.byToken.set(token, s);
    return s;
  }

  get(token: string | undefined): Session | undefined {
    return token ? this.byToken.get(token) : undefined;
  }

  delete(token: string) {
    const s = this.byToken.get(token);
    if (s) this.cancelGrace(s);
    this.byToken.delete(token);
  }

  startGrace(s: Session, ms: number, onExpire: () => void) {
    this.cancelGrace(s);
    s.graceTimer = setTimeout(() => {
      s.graceTimer = null;
      if (s.socketId) return; // 그 사이 복귀함
      this.byToken.delete(s.token);
      onExpire();
    }, ms);
  }

  cancelGrace(s: Session) {
    if (s.graceTimer) clearTimeout(s.graceTimer);
    s.graceTimer = null;
  }
}
