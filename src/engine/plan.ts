// Decisions about what to study: next lesson, warm-up queue, checks, placement, weak topics.
import type { Task } from '../content/schema';
import { chapters, glossary, lessons, lessonsOf, studyTerms, type LessonMeta as Lesson } from '../content';
import { chapterMastered, chapterUnlocked, lessonDone, type ProgressData } from '../store/progress';
import { isDue } from './srs';
import { shuffle } from '../tasks/types';
import { today } from '../lib/dates';

export function nextLesson(p: ProgressData): Lesson | null {
  for (const ch of chapters) {
    if (ch.status !== 'ready' || !chapterUnlocked(p, ch.id)) continue;
    for (const l of lessonsOf(ch)) if (!lessonDone(p, l.id)) return l;
  }
  return null;
}

export function nextBoss(p: ProgressData): string | null {
  for (const ch of chapters) {
    if (ch.status !== 'ready' || !chapterUnlocked(p, ch.id) || chapterMastered(p, ch.id)) continue;
    if (lessonsOf(ch).every((l) => lessonDone(p, l.id)) && ch.boss && !p.chapters[ch.id]?.bossDone) return ch.id;
  }
  return null;
}

const QUICK = new Set(['choice', 'input', 'fill', 'parsons', 'match', 'predict', 'pick-locator', 'review', 'vocab', 'inspect']);

export interface WarmItem { cardId: string; task: Task }

/** Due spaced-repetition items: up to 6 terms and 2 topic tasks (~2–3 minutes). */
export function warmupQueue(p: ProgressData, limit = { terms: 6, topics: 2 }): WarmItem[] {
  const t = today();
  const due = Object.entries(p.srs).filter(([, c]) => isDue(c, t)).sort((a, b) => a[1].due.localeCompare(b[1].due));
  const out: WarmItem[] = [];
  let terms = 0;
  let topics = 0;
  for (const [id, card] of due) {
    if (card.kind === 'term' && terms < limit.terms) {
      const termId = id.slice(5);
      const e = glossary.get(termId);
      if (!e) continue;
      terms++;
      out.push({ cardId: id, task: termTask(termId) });
    } else if (card.kind === 'topic' && topics < limit.topics) {
      const lesson = lessons.get(id.slice(6));
      if (!lesson) continue;
      const pool = lesson.checkPool.filter((x) => QUICK.has(x.kind));
      const lastUsed = p.checks[`warm:${lesson.id}`]?.lastItems || [];
      const pick = shuffle(pool.filter((x) => !lastUsed.includes(x.id)))[0] || shuffle(pool)[0];
      if (!pick) continue;
      topics++;
      out.push({ cardId: id, task: pick });
    }
  }
  return shuffle(out);
}

function termTask(termId: string): Task {
  const e = glossary.get(termId)!;
  const r = Math.random();
  const exampleHasTerm = e.example.en.toLowerCase().includes(e.en.toLowerCase());
  if (r < 0.34 && exampleHasTerm) {
    const idx = e.example.en.toLowerCase().indexOf(e.en.toLowerCase());
    const sentence = { en: e.example.en.slice(0, idx) + '___' + e.example.en.slice(idx + e.en.length), ru: e.example.ru };
    const others = shuffle([...glossary.values()].filter((x) => x.id !== e.id && studyTerms.has(x.id) && Math.abs(x.chapter - e.chapter) <= 2)).slice(0, 3).map((x) => x.en);
    return { id: `srs-${termId}`, kind: 'vocab', mode: 'cloze', sentence, answer: e.en, options: [e.en, ...others] } as Task;
  }
  return { id: `srs-${termId}`, kind: 'vocab', mode: 'translate', term: termId, direction: r < 0.67 ? 'en-ru' : 'ru-en' } as Task;
}

export function dueCount(p: ProgressData): number {
  const t = today();
  return Object.values(p.srs).filter((c) => isDue(c, t)).length;
}

/** "I know this" for a lesson: 2–3 practical items on different key points, different from last time. */
export function lessonCheckItems(lesson: Lesson, p: ProgressData, n = 3): Task[] {
  const last = new Set(p.checks[`lesson:${lesson.id}`]?.lastItems || []);
  const pool = shuffle(lesson.checkPool);
  const fresh = pool.filter((t) => !last.has(t.id));
  const source = fresh.length >= n ? fresh : pool;
  const picked: Task[] = [];
  const kps = new Set<string>();
  for (const t of source) {
    if (picked.length >= n) break;
    if (t.keyPoint && kps.has(t.keyPoint) && source.some((x) => x.keyPoint && !kps.has(x.keyPoint) && !picked.includes(x))) continue;
    picked.push(t);
    if (t.keyPoint) kps.add(t.keyPoint);
  }
  for (const t of source) if (picked.length < n && !picked.includes(t)) picked.push(t);
  return picked;
}

/** Chapter check: one practical item per lesson. */
export function chapterCheckItems(chapterId: string, p: ProgressData): { task: Task; lessonId: string }[] {
  const ch = chapters.find((c) => c.id === chapterId);
  if (!ch) return [];
  const last = new Set(p.checks[`chapter:${chapterId}`]?.lastItems || []);
  return lessonsOf(ch).map((l) => {
    const pool = shuffle(l.checkPool);
    const t = pool.find((x) => !last.has(x.id)) || pool[0];
    return { task: t, lessonId: l.id };
  });
}

/** The entry check covers the foundations only: later chapters build on them and are learned, not skipped. */
export const PLACEMENT_CHAPTERS = 4;

export function placementVars() {
  const items = placementItems();
  const last = Math.max(1, ...items.map((x) => chapters.find((c) => c.id === x.chapterId)?.number ?? 1));
  return { n: items.length, last, min: Math.max(5, Math.round(items.length * 0.8)) };
}

/** Entry check: one quick item per lesson of the first ready chapters. */
export function placementItems(): { task: Task; lessonId: string; chapterId: string }[] {
  const out: { task: Task; lessonId: string; chapterId: string }[] = [];
  for (const ch of chapters) {
    if (ch.status !== 'ready' || ch.number > PLACEMENT_CHAPTERS) continue;
    for (const l of lessonsOf(ch)) {
      const pool = l.checkPool.filter((t) => t.placement);
      const quick = l.checkPool.filter((t) => QUICK.has(t.kind) && t.kind !== 'review');
      const t = shuffle(pool.length ? pool : quick)[0];
      if (t) out.push({ task: t, lessonId: l.id, chapterId: ch.id });
    }
  }
  return out;
}

export interface WeakTopic { lesson: Lesson; kps: { id: string; title: { en: string; ru: string } }[] }

export function weakTopics(p: ProgressData): WeakTopic[] {
  const out: WeakTopic[] = [];
  for (const ch of chapters) {
    for (const l of lessonsOf(ch)) {
      const weak = l.keyPoints.filter((k) => {
        const s = p.kp[k.id];
        if (!s) return false;
        return s.bad >= 2 && s.bad / (s.ok + s.bad) >= 0.4;
      });
      if (weak.length && p.lessons[l.id]) out.push({ lesson: l, kps: weak });
    }
  }
  return out.slice(0, 3);
}

export function lessonProgressRatio(ch: { id: string }, p: ProgressData) {
  const c = chapters.find((x) => x.id === ch.id);
  if (!c) return 0;
  const ls = lessonsOf(c);
  if (!ls.length) return 0;
  const done = ls.filter((l) => lessonDone(p, l.id)).length + (p.chapters[c.id]?.bossDone || p.chapters[c.id]?.checkPassed ? 1 : 0);
  return done / (ls.length + (c.boss ? 1 : 0));
}
