/**
 * 메시지 게시판 저장소.
 * 쪽지는 메모리에 두고 JSON 파일(data/board.json)에 저장해 서버를 재시작해도 남습니다.
 * ※ Render 무료 요금제처럼 디스크가 초기화되는 환경에서는 재배포 시 쪽지가 지워집니다.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BoardNote } from '../shared/protocol';

const MAX_NOTES = 300;

export class BoardStore {
  private notes: BoardNote[] = [];
  private nextId = 1;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { notes?: BoardNote[] };
      if (Array.isArray(data.notes)) this.notes = data.notes.slice(-MAX_NOTES);
      this.nextId = this.notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;
    } catch {
      /* 파일이 없으면 빈 게시판으로 시작 */
    }
  }

  list(): BoardNote[] {
    return this.notes.slice();
  }

  get count() {
    return this.notes.length;
  }

  add(note: Omit<BoardNote, 'id' | 'at'>): BoardNote {
    const n: BoardNote = { ...note, id: this.nextId++, at: Date.now() };
    this.notes.push(n);
    if (this.notes.length > MAX_NOTES) this.notes.splice(0, this.notes.length - MAX_NOTES);
    this.scheduleSave();
    return n;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 500);
  }

  flush() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ notes: this.notes }), 'utf8');
      renameSync(tmp, this.file);
    } catch (e) {
      console.warn('게시판 저장 실패:', (e as Error).message);
    }
  }
}
