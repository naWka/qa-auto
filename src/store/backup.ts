// Backups of everything the student has: a JSON file or a compact text code (gzip + base64url),
// restored either by replacing local progress or by merging it with what this browser has.
import { BOSS_BONUS, LESSON_BONUS } from '../engine/xp';
import { addDays, diffDays, today } from '../lib/dates';
import { emptyProgress, progressSnapshot, useProgress, type ProgressData } from './progress';
import { settingsSnapshot, useSettings, type Settings } from './settings';

export const PLAYGROUND_KEY = 'bloomqa-playground';
const CODE_PREFIX = 'BQA1.';
/** Remind to save a copy this often (days). */
export const BACKUP_EVERY = 7;

export interface Backup {
  app: 'bloom-qa';
  version: 1;
  exportedAt: string;
  settings?: Partial<Settings>;
  progress: ProgressData;
  playground?: string;
}

export interface Summary { xp: number; lessons: number; tasks: number; lastDay: string | null }

export function summarize(p: ProgressData): Summary {
  return {
    xp: p.xp,
    lessons: Object.values(p.lessons).filter((l) => l.status === 'done').length,
    tasks: Object.values(p.tasks).filter((t) => t.solved).length,
    lastDay: p.days[p.days.length - 1] ?? null,
  };
}

export function hasProgress(p: ProgressData): boolean {
  return p.xp > 0 || Object.keys(p.lessons).length > 0 || Object.keys(p.tasks).length > 0;
}

function readPlayground(): string | undefined {
  try { return localStorage.getItem(PLAYGROUND_KEY) ?? undefined; } catch { return undefined; }
}

export function makeBackup(): Backup {
  return { app: 'bloom-qa', version: 1, exportedAt: new Date().toISOString(), settings: settingsSnapshot(), progress: progressSnapshot(), playground: readPlayground() };
}

function markSaved() {
  useSettings.getState().update({ backupAt: today() });
}

export function downloadBackup() {
  const blob = new Blob([JSON.stringify(makeBackup(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-qa-progress-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  markSaved();
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** The whole backup as one line of text, to send to yourself and paste in another browser. */
export async function backupCode(): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(makeBackup()));
  const code = CODE_PREFIX + toBase64Url(await pipe(json, new CompressionStream('gzip')));
  markSaved();
  return code;
}

/** Accepts a backup file's text or a progress code. Throws if it isn't a Bloom QA backup. */
export async function parseBackup(text: string): Promise<Backup> {
  const raw = text.trim();
  let json = raw;
  if (raw.startsWith(CODE_PREFIX)) {
    const bytes = await pipe(fromBase64Url(raw.slice(CODE_PREFIX.length).replace(/\s+/g, '')), new DecompressionStream('gzip'));
    json = new TextDecoder().decode(bytes);
  }
  const data = JSON.parse(json) as Partial<Backup>;
  if (data.app !== 'bloom-qa' || !data.progress || typeof data.progress.xp !== 'number') throw new Error('not a Bloom QA backup');
  return { ...data, progress: { ...emptyProgress(), ...data.progress } } as Backup;
}

export function applyBackup(b: Backup, mode: 'replace' | 'merge') {
  const store = useProgress.getState();
  if (mode === 'replace') {
    store.replaceAll(b.progress);
    if (b.settings) useSettings.getState().update(b.settings);
  } else {
    store.replaceAll(mergeProgress(progressSnapshot(), b.progress));
  }
  const keepLocal = mode === 'merge' && readPlayground();
  if (b.playground && !keepLocal) {
    try { localStorage.setItem(PLAYGROUND_KEY, b.playground); } catch { /* ignore */ }
  }
}

function longestStreak(days: string[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && diffDays(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function mergeRecords<T>(a: Record<string, T>, b: Record<string, T>, pick: (x: T, y: T) => T): Record<string, T> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}

const earlier = (x?: string, y?: string) => (x && y ? (x < y ? x : y) : x || y);

/**
 * Keeps the best of two progress histories (for example, two browsers used in turns): solved beats
 * unsolved, done beats in progress, streak days are united. XP starts from the larger side and adds
 * what only the other side earned (solved tasks, finished lessons, bosses) — an estimate, because
 * lessons counted by a check don't store their XP per task.
 */
export function mergeProgress(a: ProgressData, b: ProgressData): ProgressData {
  const [base, other] = a.xp >= b.xp ? [a, b] : [b, a];

  let xp = base.xp;
  for (const [id, t] of Object.entries(other.tasks)) if (t.solved && !base.tasks[id]?.solved) xp += t.xp ?? 0;
  for (const [id, l] of Object.entries(other.lessons)) if (l.status === 'done' && base.lessons[id]?.status !== 'done') xp += LESSON_BONUS;
  for (const [id, c] of Object.entries(other.chapters)) if (c.bossDone && !base.chapters[id]?.bossDone) xp += BOSS_BONUS;

  const days = [...new Set([...base.days, ...other.days])].sort().slice(-400);
  const stats = { ...base.stats };
  for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = Math.max(stats[k], other.stats[k] ?? 0);

  return {
    v: 1,
    startedAt: earlier(base.startedAt, other.startedAt) || today(),
    xp,
    days,
    bestStreak: Math.max(base.bestStreak, other.bestStreak, longestStreak(days)),
    tasks: mergeRecords(base.tasks, other.tasks, (x, y) => (x.solved !== y.solved ? (x.solved ? x : y) : y.attempts > x.attempts ? y : x)),
    lessons: mergeRecords(base.lessons, other.lessons, (x, y) => {
      if (x.status !== y.status) return x.status === 'done' ? x : y;
      return x.status === 'in-progress' && (y.step ?? 0) > (x.step ?? 0) ? y : x;
    }),
    chapters: mergeRecords(base.chapters, other.chapters, (x, y) => ({
      bossDone: x.bossDone || y.bossDone || undefined,
      checkPassed: x.checkPassed || y.checkPassed || undefined,
      doneAt: earlier(x.doneAt, y.doneAt),
    })),
    kp: mergeRecords(base.kp, other.kp, (x, y) => (y.ok + y.bad > x.ok + x.bad ? y : x)),
    checks: mergeRecords(base.checks, other.checks, (x, y) => {
      const c = y.attempts > x.attempts ? y : x;
      return { ...c, passedAt: c.passedAt || x.passedAt || y.passedAt };
    }),
    srs: mergeRecords(base.srs, other.srs, (x, y) => {
      const hx = x.reps + x.lapses;
      const hy = y.reps + y.lapses;
      return hy > hx || (hy === hx && y.due > x.due) ? y : x;
    }),
    explanations: { ...other.explanations, ...base.explanations },
    badges: mergeRecords(base.badges, other.badges, (x, y) => earlier(x, y)!),
    placement: base.placement?.done ? base.placement : other.placement ?? base.placement,
    lastWarmup: [base.lastWarmup, other.lastWarmup].filter(Boolean).sort().pop(),
    stats,
  };
}

/** Show the "save a copy" reminder: there is progress and no copy (or dismissed reminder) for a week. */
export function backupDue(p: ProgressData, s: Pick<Settings, 'backupAt' | 'backupNudgedAt'>, now = today()): boolean {
  if (!Object.values(p.lessons).some((l) => l.status === 'done')) return false;
  const last = [s.backupAt, s.backupNudgedAt].filter(Boolean).sort().pop();
  return !last || addDays(last, BACKUP_EVERY) <= now;
}

/**
 * Asks the browser not to clear this site's storage on its own (low disk space, Safari's cleanup).
 * Chrome and Safari decide silently; Firefox may ask once — so we ask only when there is progress to keep.
 */
export async function keepStorage() {
  try {
    if (!navigator.storage?.persist || (await navigator.storage.persisted())) return;
    await navigator.storage.persist();
  } catch { /* not supported */ }
}
