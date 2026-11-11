/** 작은 JSON 파일 저장 도우미 (임시 파일에 쓰고 바꿔치기 → 저장 중 꺼져도 파일이 깨지지 않음) */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private file: string,
    private get: () => T,
  ) {}

  read(): unknown {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  /** 잠시 모아서 저장 */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 300);
  }

  /** 바로 저장 (당첨 기록처럼 중요한 변경) */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.get()), 'utf8');
      renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      console.warn(`저장 실패 (${path.basename(this.file)}):`, (e as Error).message);
    }
  }
}
