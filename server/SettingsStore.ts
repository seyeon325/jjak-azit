/**
 * 운영 설정 저장소 (data/settings.json)
 *  - 팀 이름, 화면 표시 설정, 운영자가 바꾼 팀 배정, 채팅 제한 대상
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DisplaySettings } from '../shared/protocol';
import { TEAMS } from '../shared/social';

interface Data {
  teamNames: string[];
  display: DisplaySettings;
  /** ownerKey → 팀 번호 (운영자 배정) */
  teamOverrides: Record<string, number>;
  /** 채팅 제한된 ownerKey */
  muted: string[];
}

export class SettingsStore {
  data: Data = {
    teamNames: TEAMS.map((t) => t.defaultName),
    display: { hideNames: false, hideTeams: false, hideBubbles: false, photo: false },
    teamOverrides: {},
    muted: [],
  };
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Data>;
      if (Array.isArray(raw.teamNames)) this.data.teamNames = TEAMS.map((t, i) => String(raw.teamNames![i] ?? t.defaultName));
      if (raw.display) this.data.display = { ...this.data.display, ...raw.display, photo: false };
      if (raw.teamOverrides) this.data.teamOverrides = raw.teamOverrides;
      if (Array.isArray(raw.muted)) this.data.muted = raw.muted;
    } catch {
      /* 처음 실행 */
    }
  }

  isMuted(ownerKey: string) {
    return this.data.muted.includes(ownerKey);
  }

  setMuted(ownerKey: string, muted: boolean) {
    this.data.muted = this.data.muted.filter((k) => k !== ownerKey);
    if (muted) this.data.muted.push(ownerKey);
    this.save();
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 300);
  }

  flush() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), 'utf8');
      renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      console.warn('설정 저장 실패:', (e as Error).message);
    }
  }
}
