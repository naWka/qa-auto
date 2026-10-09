// Learning progress, persisted in localStorage. Mutations go through actions that also
// detect level-ups and new badges and emit celebration events.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task } from '../content/schema';
import { chapters, lessons, lessonsOf, story } from '../content';
import { addDays, diffDays, today } from '../lib/dates';
import { newCard, review, type Card } from '../engine/srs';
import { BOSS_BONUS, LESSON_BONUS, baseXp, earnedXp, levelFor } from '../engine/xp';
import { emit, type AppEvent } from '../engine/events';

export interface TaskProgress { solved: boolean; attempts: number; hints: number; revealed?: boolean; at?: string; xp?: number }
export interface LessonProgress { status: 'in-progress' | 'done'; via?: 'lesson' | 'check' | 'placement'; step?: number; at?: string; hints?: number }
export interface ChapterProgress { bossDone?: boolean; checkPassed?: boolean; doneAt?: string }
export interface CheckProgress { lastItems: string[]; attempts: number; passedAt?: string; failedKps?: string[] }

export interface Stats {
  runs: number; green: number; red: number; redToGreen: number; bugsFound: number; promptFirstTry: number;
  reviewPerfect: number; noFragile: number; predictCorrect: number; lessonNoHints: number; night: number; early: number;
  tasksSolved: number; vocabCorrect: number;
}

export interface ProgressData {
  v: 1;
  startedAt: string;
  xp: number;
  days: string[];
  bestStreak: number;
  tasks: Record<string, TaskProgress>;
  lessons: Record<string, LessonProgress>;
  chapters: Record<string, ChapterProgress>;
  kp: Record<string, { ok: number; bad: number }>;
  checks: Record<string, CheckProgress>;
  srs: Record<string, Card>;
  explanations: Record<string, string>;
  badges: Record<string, string>;
  placement?: { done: boolean; skipped?: boolean; at?: string };
  lastWarmup?: string;
  stats: Stats;
}

const emptyStats: Stats = {
  runs: 0, green: 0, red: 0, redToGreen: 0, bugsFound: 0, promptFirstTry: 0, reviewPerfect: 0, noFragile: 0,
  predictCorrect: 0, lessonNoHints: 0, night: 0, early: 0, tasksSolved: 0, vocabCorrect: 0,
};

export function emptyProgress(): ProgressData {
  return {
    v: 1, startedAt: today(), xp: 0, days: [], bestStreak: 0, tasks: {}, lessons: {}, chapters: {}, kp: {}, checks: {},
    srs: {}, explanations: {}, badges: {}, stats: { ...emptyStats },
  };
}

export function currentStreak(days: string[], now = today()): number {
  const set = new Set(days);
  let d = set.has(now) ? now : addDays(now, -1);
  if (!set.has(d)) return 0;
  let n = 0;
  while (set.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export function lessonDone(p: ProgressData, id: string) {
  return p.lessons[id]?.status === 'done';
}

export function chapterMastered(p: ProgressData, chapterId: string): boolean {
  const ch = chapters.find((c) => c.id === chapterId);
  if (!ch || ch.status !== 'ready') return false;
  const cp = p.chapters[chapterId];
  if (cp?.checkPassed) return true;
  return lessonsOf(ch).every((l) => lessonDone(p, l.id)) && !!cp?.bossDone;
}

export function chapterUnlocked(p: ProgressData, chapterId: string): boolean {
  const idx = chapters.findIndex((c) => c.id === chapterId);
  if (idx <= 0) return true;
  return chapterMastered(p, chapters[idx - 1].id);
}

export function termsLearned(p: ProgressData): number {
  return Object.keys(p.srs).filter((k) => k.startsWith('term:')).length;
}

function evaluateBadges(p: ProgressData): string[] {
  const s = p.stats;
  const have = (id: string) => !!p.badges[id];
  const terms = termsLearned(p);
  const rules: Record<string, boolean> = {
    'first-run': s.runs >= 1,
    'first-green': s.green >= 1,
    'red-is-info': s.redToGreen >= 1,
    'bug-hunter': s.bugsFound >= 1,
    'prompt-crafter': s.promptFirstTry >= 1,
    'sharp-eye': s.reviewPerfect >= 1,
    'no-fragile': s.noFragile >= 1,
    'knows-it': Object.values(p.checks).some((c) => !!c.passedAt),
    boss: Object.values(p.chapters).some((c) => c.bossDone),
    chapter: chapters.some((c) => chapterMastered(p, c.id)),
    'vocab-10': terms >= 10,
    'vocab-25': terms >= 25,
    'vocab-50': terms >= 50,
    'streak-3': p.bestStreak >= 3,
    'streak-7': p.bestStreak >= 7,
    'streak-30': p.bestStreak >= 30,
    'on-my-own': s.lessonNoHints >= 1,
    explainer: Object.keys(p.explanations).length >= 5,
    predictor: s.predictCorrect >= 5,
    'night-owl': s.night >= 1,
    'early-bird': s.early >= 1,
  };
  return story.badges.map((b) => b.id).filter((id) => !have(id) && rules[id]);
}

interface Actions {
  touchDay: () => void;
  attempt: (task: Task, correct: boolean) => void;
  useHint: (taskId: string) => void;
  solve: (task: Task, opts: { revealed?: boolean; bonus?: number }) => number;
  bumpStat: (key: keyof Stats, n?: number) => void;
  setLessonStep: (lessonId: string, step: number) => void;
  completeLesson: (lessonId: string, via: 'lesson' | 'check' | 'placement', hintsUsed?: number) => number;
  completeBoss: (chapterId: string) => number;
  recordCheck: (scope: string, items: string[], passed: boolean, failedKps?: string[]) => void;
  passChapterCheck: (chapterId: string) => number;
  reviewCard: (cardId: string, quality: number) => void;
  addTopicCard: (lessonId: string, confident: boolean) => void;
  saveExplanation: (lessonId: string, text: string) => void;
  setPlacement: (v: { done: boolean; skipped?: boolean }) => void;
  setWarmupDone: () => void;
  replaceAll: (data: ProgressData) => void;
  reset: () => void;
}

export type ProgressStore = ProgressData & Actions;

const DATA_KEYS = [...Object.keys(emptyProgress()), 'placement', 'lastWarmup'] as (keyof ProgressData)[];

function dataOf(s: ProgressStore): ProgressData {
  const out: Partial<Record<keyof ProgressData, unknown>> = {};
  for (const k of DATA_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as ProgressData;
}

export const useProgress = create<ProgressStore>()(
  persist(
    (set, get) => {
      /** Applies a change, then awards badges and emits level/badge events. */
      const commit = (mutate: (d: ProgressData) => void, events: AppEvent[] = []) => {
        const prev = dataOf(get());
        const next: ProgressData = structuredClone(prev);
        mutate(next);
        const newBadges = evaluateBadges(next);
        for (const id of newBadges) next.badges[id] = today();
        set(next);
        const before = levelFor(prev.xp).index;
        const after = levelFor(next.xp).index;
        if (next.xp > prev.xp) events.push({ type: 'xp', amount: next.xp - prev.xp });
        if (after > before) events.push({ type: 'levelUp', index: after });
        for (const id of newBadges) events.push({ type: 'badge', id });
        events.forEach(emit);
      };

      const stamp = (d: ProgressData) => {
        const h = new Date().getHours();
        if (h >= 22) d.stats.night++;
        if (h < 8) d.stats.early++;
      };

      return {
        ...emptyProgress(),

        touchDay: () => {
          const t = today();
          const p = get();
          if (p.days.includes(t)) return;
          const last = p.days[p.days.length - 1];
          const events: AppEvent[] = [];
          commit((d) => {
            d.days.push(t);
            if (d.days.length > 400) d.days = d.days.slice(-400);
            const streak = currentStreak(d.days, t);
            d.bestStreak = Math.max(d.bestStreak, streak);
            if (last && diffDays(last, t) >= 3) {
              events.push({ type: 'welcomeBack', days: diffDays(last, t) });
              d.badges.comeback = d.badges.comeback || t;
            }
            if ([3, 7, 14, 30, 50, 100].includes(streak)) events.push({ type: 'streak', days: streak });
          }, events);
        },

        attempt: (task, correct) => commit((d) => {
          const tp = (d.tasks[task.id] ||= { solved: false, attempts: 0, hints: 0 });
          tp.attempts++;
          if (task.keyPoint) {
            const k = (d.kp[task.keyPoint] ||= { ok: 0, bad: 0 });
            if (correct) k.ok++;
            else k.bad++;
          }
        }),

        useHint: (taskId) => commit((d) => {
          const tp = (d.tasks[taskId] ||= { solved: false, attempts: 0, hints: 0 });
          tp.hints++;
        }),

        solve: (task, { revealed, bonus = 0 }) => {
          const p = get();
          const tp = p.tasks[task.id];
          if (tp?.solved) return 0;
          const xp = earnedXp(task, tp?.hints ?? 0, !!revealed) + (revealed ? 0 : bonus);
          commit((d) => {
            const t = (d.tasks[task.id] ||= { solved: false, attempts: 0, hints: 0 });
            t.solved = true;
            t.revealed = revealed;
            t.at = today();
            t.xp = xp;
            d.xp += xp;
            d.stats.tasksSolved++;
            if (revealed && task.keyPoint) (d.kp[task.keyPoint] ||= { ok: 0, bad: 0 }).bad += 2;
            stamp(d);
          });
          return xp;
        },

        bumpStat: (key, n = 1) => commit((d) => { d.stats[key] += n; }),

        setLessonStep: (lessonId, step) => {
          const lp = get().lessons[lessonId];
          if (lp?.status === 'done') return;
          set((s) => ({ lessons: { ...s.lessons, [lessonId]: { ...(s.lessons[lessonId] || { status: 'in-progress' }), status: 'in-progress', step } } }));
        },

        completeLesson: (lessonId, via, hintsUsed = 0) => {
          const p = get();
          const lesson = lessons.get(lessonId);
          if (!lesson) return 0;
          const already = p.lessons[lessonId]?.status === 'done';
          let xp = 0;
          if (!already) {
            xp = LESSON_BONUS;
            if (via !== 'lesson') {
              // Counted by a check: award what the lesson's tasks would have given.
              for (const s of lesson.steps) if (s.type === 'task' && !p.tasks[s.task.id]?.solved) xp += baseXp(s.task);
            }
          }
          const t = today();
          const events: AppEvent[] = [];
          const wasMastered = chapterMastered(p, lesson.chapter);
          commit((d) => {
            if (!already) {
              d.lessons[lessonId] = { status: 'done', via, at: t, hints: hintsUsed };
              d.xp += xp;
              if (via === 'lesson' && hintsUsed === 0) d.stats.lessonNoHints++;
            }
            for (const term of lesson.terms) if (!d.srs[`term:${term}`]) d.srs[`term:${term}`] = newCard('term', t);
            if (!d.srs[`topic:${lessonId}`]) d.srs[`topic:${lessonId}`] = newCard('topic', t, via !== 'lesson');
            stamp(d);
            if (!wasMastered && chapterMastered(d, lesson.chapter)) {
              d.chapters[lesson.chapter] = { ...(d.chapters[lesson.chapter] || {}), doneAt: t };
              events.push({ type: 'chapterDone', id: lesson.chapter });
            }
          }, events);
          return xp;
        },

        completeBoss: (chapterId) => {
          const p = get();
          if (p.chapters[chapterId]?.bossDone) return 0;
          const events: AppEvent[] = [];
          const wasMastered = chapterMastered(p, chapterId);
          commit((d) => {
            d.chapters[chapterId] = { ...(d.chapters[chapterId] || {}), bossDone: true };
            d.xp += BOSS_BONUS;
            if (!wasMastered && chapterMastered(d, chapterId)) {
              d.chapters[chapterId].doneAt = today();
              events.push({ type: 'chapterDone', id: chapterId });
            }
          }, events);
          return BOSS_BONUS;
        },

        recordCheck: (scope, items, passed, failedKps) => commit((d) => {
          const c = (d.checks[scope] ||= { lastItems: [], attempts: 0 });
          c.lastItems = items;
          c.attempts++;
          if (passed) c.passedAt = today();
          c.failedKps = failedKps;
        }),

        passChapterCheck: (chapterId) => {
          const ch = chapters.find((c) => c.id === chapterId);
          if (!ch) return 0;
          let xp = 0;
          for (const l of lessonsOf(ch)) xp += get().completeLesson(l.id, 'check');
          const events: AppEvent[] = [];
          const wasMastered = chapterMastered(get(), chapterId);
          commit((d) => {
            d.chapters[chapterId] = { ...(d.chapters[chapterId] || {}), checkPassed: true };
            if (!wasMastered) {
              d.chapters[chapterId].doneAt = today();
              d.xp += BOSS_BONUS;
              events.push({ type: 'chapterDone', id: chapterId });
            }
          }, events);
          return xp + (wasMastered ? 0 : BOSS_BONUS);
        },

        reviewCard: (cardId, quality) => commit((d) => {
          const card = d.srs[cardId];
          if (!card) return;
          d.srs[cardId] = review(card, quality, today());
          if (cardId.startsWith('term:') && quality >= 3) d.stats.vocabCorrect++;
        }),

        addTopicCard: (lessonId, confident) => commit((d) => {
          if (!d.srs[`topic:${lessonId}`]) d.srs[`topic:${lessonId}`] = newCard('topic', today(), confident);
        }),

        saveExplanation: (lessonId, text) => commit((d) => { d.explanations[lessonId] = text; }),

        setPlacement: (v) => commit((d) => { d.placement = { ...v, at: today() }; }),

        setWarmupDone: () => set({ lastWarmup: today() }),

        replaceAll: (data) => set({ ...emptyProgress(), ...data }),

        reset: () => set(emptyProgress()),
      };
    },
    {
      name: 'bloomqa-progress',
      version: 1,
      partialize: (s) => dataOf(s as ProgressStore),
    },
  ),
);

export function progressSnapshot(): ProgressData {
  return dataOf(useProgress.getState());
}
