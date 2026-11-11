/**
 * 메시지 게시판 저장소 — 게시물 · 댓글 · 공감
 * - 소유권은 닉네임이 아니라 서버가 관리하는 ownerKey(기기 키의 해시)로 판단
 * - data/board.json 에 저장 → 새로고침·재접속·서버 재시작 후에도 유지
 *   (Render 무료 요금제는 재배포 시 디스크가 초기화되므로 그때는 지워짐)
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AdminNote, BoardComment, BoardMine, BoardNote, Grade, Role } from '../shared/protocol';

const MAX_NOTES = 500;

export interface Author {
  ownerKey: string;
  nickname: string;
  role: Role;
  grade: Grade;
  gradeText: string;
  team: number;
  look: number;
}

interface NoteRec extends Author {
  id: number;
  anon: boolean;
  text: string;
  color: number;
  at: number;
  editedAt: number | null;
  likes: string[];
}

interface CommentRec extends Omit<Author, 'look'> {
  id: number;
  noteId: number;
  text: string;
  at: number;
  editedAt: number | null;
}

interface FileData {
  notes: NoteRec[];
  comments: CommentRec[];
  nextNote: number;
  nextComment: number;
}

export class BoardStore {
  private notes: NoteRec[] = [];
  private comments: CommentRec[] = [];
  private nextNote = 1;
  private nextComment = 1;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    try {
      const d = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileData> & { notes?: Partial<NoteRec>[] };
      this.notes = (d.notes ?? []).map((n) => ({
        id: n.id ?? 0,
        ownerKey: n.ownerKey ?? '',
        nickname: n.nickname ?? '',
        role: n.role ?? 'junior',
        grade: (n.grade ?? 0) as Grade,
        gradeText: n.gradeText ?? '',
        team: n.team ?? -1,
        look: n.look ?? 0,
        anon: !!n.anon,
        text: n.text ?? '',
        color: n.color ?? 0,
        at: n.at ?? Date.now(),
        editedAt: n.editedAt ?? null,
        likes: Array.isArray(n.likes) ? n.likes : [],
      }));
      this.comments = d.comments ?? [];
      this.nextNote = Math.max(d.nextNote ?? 1, ...this.notes.map((n) => n.id + 1), 1);
      this.nextComment = Math.max(d.nextComment ?? 1, ...this.comments.map((c) => c.id + 1), 1);
    } catch {
      /* 빈 게시판 */
    }
  }

  // ---------------------------------------------------------------- 공개용 변환

  private pub(n: NoteRec): BoardNote {
    return {
      id: n.id,
      nickname: n.anon ? '익명' : n.nickname,
      anon: n.anon,
      role: n.anon ? null : n.role,
      grade: n.anon ? null : n.grade,
      gradeText: n.anon ? '' : n.gradeText,
      team: n.anon ? -1 : n.team,
      look: n.anon ? -1 : n.look,
      text: n.text,
      color: n.color,
      at: n.at,
      editedAt: n.editedAt,
      likes: n.likes.length,
      comments: this.comments.filter((c) => c.noteId === n.id).length,
    };
  }

  private pubC(c: CommentRec): BoardComment {
    const { ownerKey: _o, ...rest } = c;
    return rest;
  }

  note(id: number) {
    const n = this.notes.find((x) => x.id === id);
    return n ? this.pub(n) : null;
  }

  list(): BoardNote[] {
    return this.notes.map((n) => this.pub(n));
  }

  mine(ownerKey: string): BoardMine {
    return {
      notes: this.notes.filter((n) => n.ownerKey === ownerKey).map((n) => n.id),
      comments: this.comments.filter((c) => c.ownerKey === ownerKey).map((c) => c.id),
      liked: this.notes.filter((n) => n.likes.includes(ownerKey)).map((n) => n.id),
    };
  }

  commentsOf(noteId: number) {
    return this.comments.filter((c) => c.noteId === noteId).map((c) => this.pubC(c));
  }

  myCommentIds(noteId: number, ownerKey: string) {
    return this.comments.filter((c) => c.noteId === noteId && c.ownerKey === ownerKey).map((c) => c.id);
  }

  // ---------------------------------------------------------------- 게시물

  add(a: Author, text: string, color: number, anon: boolean): BoardNote {
    const n: NoteRec = { ...a, id: this.nextNote++, anon, text, color, at: Date.now(), editedAt: null, likes: [] };
    this.notes.push(n);
    if (this.notes.length > MAX_NOTES) {
      const drop = this.notes.splice(0, this.notes.length - MAX_NOTES).map((x) => x.id);
      this.comments = this.comments.filter((c) => !drop.includes(c.noteId));
    }
    this.save();
    return this.pub(n);
  }

  /** 본인 글만 수정 */
  edit(id: number, ownerKey: string, text: string): BoardNote | string {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return '이미 지워진 쪽지예요.';
    if (n.ownerKey !== ownerKey) return '내가 쓴 쪽지만 고칠 수 있어요.';
    n.text = text;
    n.editedAt = Date.now();
    this.save();
    return this.pub(n);
  }

  /** 삭제 (admin=true 면 소유자 확인 생략). 연결된 댓글도 함께 삭제 */
  remove(id: number, ownerKey: string | null): true | string {
    const i = this.notes.findIndex((x) => x.id === id);
    if (i < 0) return '이미 지워진 쪽지예요.';
    if (ownerKey !== null && this.notes[i].ownerKey !== ownerKey) return '내가 쓴 쪽지만 지울 수 있어요.';
    this.notes.splice(i, 1);
    this.comments = this.comments.filter((c) => c.noteId !== id);
    this.save();
    return true;
  }

  /** 공감 토글 (사용자당 1회) */
  toggleLike(id: number, ownerKey: string): { liked: boolean; note: BoardNote } | string {
    const n = this.notes.find((x) => x.id === id);
    if (!n) return '이미 지워진 쪽지예요.';
    const i = n.likes.indexOf(ownerKey);
    if (i >= 0) n.likes.splice(i, 1);
    else n.likes.push(ownerKey);
    this.save();
    return { liked: i < 0, note: this.pub(n) };
  }

  // ---------------------------------------------------------------- 댓글

  addComment(noteId: number, a: Author, text: string): BoardComment | string {
    if (!this.notes.some((n) => n.id === noteId)) return '이미 지워진 쪽지예요.';
    const { look: _l, ...author } = a;
    const c: CommentRec = { ...author, id: this.nextComment++, noteId, text, at: Date.now(), editedAt: null };
    this.comments.push(c);
    this.save();
    return this.pubC(c);
  }

  editComment(id: number, ownerKey: string, text: string): BoardComment | string {
    const c = this.comments.find((x) => x.id === id);
    if (!c) return '이미 지워진 댓글이에요.';
    if (c.ownerKey !== ownerKey) return '내가 쓴 댓글만 고칠 수 있어요.';
    c.text = text;
    c.editedAt = Date.now();
    this.save();
    return this.pubC(c);
  }

  removeComment(id: number, ownerKey: string | null): { noteId: number } | string {
    const i = this.comments.findIndex((x) => x.id === id);
    if (i < 0) return '이미 지워진 댓글이에요.';
    if (ownerKey !== null && this.comments[i].ownerKey !== ownerKey) return '내가 쓴 댓글만 지울 수 있어요.';
    const [c] = this.comments.splice(i, 1);
    this.save();
    return { noteId: c.noteId };
  }

  // ---------------------------------------------------------------- 운영자

  adminList(): AdminNote[] {
    return this.notes
      .slice()
      .reverse()
      .map((n) => ({
        ...this.pub(n),
        author: n.nickname,
        ownerKey: n.ownerKey.slice(0, 8),
        commentList: this.comments
          .filter((c) => c.noteId === n.id)
          .map((c) => ({ ...this.pubC(c), ownerKey: c.ownerKey.slice(0, 8) })),
      }));
  }

  toCSV(): string {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const t = (ms: number | null) => (ms ? new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '');
    const rows = [['종류', '번호', '게시물번호', '작성자', '익명', '학년', '선후배', '내용', '하트', '작성시각', '수정시각', '작성자키']];
    for (const n of this.notes) {
      rows.push([
        '게시물',
        String(n.id),
        String(n.id),
        n.nickname,
        n.anon ? 'O' : '',
        n.grade ? `${n.grade}학년` : n.gradeText || '기타',
        n.role === 'senior' ? '선배' : '후배',
        n.text,
        String(n.likes.length),
        t(n.at),
        t(n.editedAt),
        n.ownerKey.slice(0, 8),
      ]);
      for (const c of this.comments.filter((x) => x.noteId === n.id))
        rows.push([
          '댓글',
          String(c.id),
          String(n.id),
          c.nickname,
          '',
          c.grade ? `${c.grade}학년` : c.gradeText || '기타',
          c.role === 'senior' ? '선배' : '후배',
          c.text,
          '',
          t(c.at),
          t(c.editedAt),
          c.ownerKey.slice(0, 8),
        ]);
    }
    return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }

  // ---------------------------------------------------------------- 저장

  private save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 400);
  }

  flush() {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const data: FileData = { notes: this.notes, comments: this.comments, nextNote: this.nextNote, nextComment: this.nextComment };
      writeFileSync(`${this.file}.tmp`, JSON.stringify(data), 'utf8');
      renameSync(`${this.file}.tmp`, this.file);
    } catch (e) {
      console.warn('게시판 저장 실패:', (e as Error).message);
    }
  }
}
