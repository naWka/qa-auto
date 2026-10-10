// Loads all YAML content at build time and exposes typed lookups.
import type { Chapter, GlossaryEntry, Lesson, Playground, Step, Task, T } from './schema';
import uiData from './ui.yaml';
import storyData from './story.yaml';
import phrasesData from './phrases.yaml';
import errorsData from './errors.yaml';
import interviewData from './interview.yaml';
import playgroundData from './playground.yaml';

const chapterFiles = import.meta.glob('./chapters/*/chapter.yaml', { eager: true, import: 'default' }) as Record<string, Chapter>;
/** A lesson without its steps (they load on demand), plus a summary of its step tasks for XP. */
export type LessonMeta = Omit<Lesson, 'steps'> & { stepTasks: { id: string; kind: Task['kind']; xp?: number }[] };
const lessonFiles = import.meta.glob('./chapters/*/l*.yaml', { eager: true, import: 'default', query: '?meta' }) as Record<string, LessonMeta | null>;
const stepFiles = import.meta.glob('./chapters/*/l*.yaml', { import: 'default', query: '?steps' }) as Record<string, () => Promise<Step[] | null>>;
const glossaryFiles = import.meta.glob('./glossary/*.yaml', { eager: true, import: 'default' }) as Record<string, GlossaryEntry[]>;

export const chapters: Chapter[] = Object.values(chapterFiles).sort((a, b) => a.number - b.number);

export const lessons = new Map<string, LessonMeta>();
const lessonPath = new Map<string, string>();
for (const [path, l] of Object.entries(lessonFiles)) if (l?.id) { lessons.set(l.id, l); lessonPath.set(l.id, path); }

const loaded = new Map<string, Lesson>();
const loading = new Map<string, Promise<Lesson | undefined>>();
/** The full lesson (with steps), if it's already loaded. */
export function loadedLesson(id: string): Lesson | undefined {
  return loaded.get(id);
}
/** Loads a lesson's steps (a separate chunk per lesson). */
export function loadLesson(id: string): Promise<Lesson | undefined> {
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (!loading.has(id)) {
    const meta = lessons.get(id);
    const path = lessonPath.get(id);
    if (!meta || !path || !stepFiles[path]) return Promise.resolve(undefined);
    loading.set(id, stepFiles[path]().then((steps) => {
      const full = { ...meta, steps: steps || [] } as Lesson & LessonMeta;
      loaded.set(id, full);
      return full;
    }));
  }
  return loading.get(id)!;
}

export const glossary = new Map<string, GlossaryEntry>();
for (const list of Object.values(glossaryFiles)) for (const e of list || []) glossary.set(e.id, e);

/** Glossary ids that some lesson teaches as vocabulary (flashcards, "words learned"). The rest are reference only. */
export const studyTerms = new Set([...lessons.values()].flatMap((l) => l.terms));

export function chapterById(id: string) {
  return chapters.find((c) => c.id === id);
}

export function lessonsOf(ch: Chapter): LessonMeta[] {
  return (ch.lessons || []).map((id) => lessons.get(id)).filter(Boolean) as LessonMeta[];
}

/** Every task in the course, with where it lives. */
export interface TaskRef { task: Task; lessonId?: string; chapterId: string; where: 'step' | 'pretest' | 'pool' | 'boss' }
/** Pool and boss tasks (always loaded). */
export const allTasks: TaskRef[] = [];
for (const ch of chapters) {
  for (const l of lessonsOf(ch)) {
    for (const t of l.checkPool) allTasks.push({ task: t, lessonId: l.id, chapterId: ch.id, where: 'pool' });
  }
  for (const t of ch.boss?.tasks || []) allTasks.push({ task: t, chapterId: ch.id, where: 'boss' });
}
export const taskById = new Map(allTasks.map((r) => [r.task.id, r]));

/** Every task including lesson steps and pretests (loads all lessons — for dev pages). */
export async function loadAllTasks(): Promise<TaskRef[]> {
  const out: TaskRef[] = [];
  for (const ch of chapters) {
    for (const meta of lessonsOf(ch)) {
      const l = await loadLesson(meta.id);
      if (!l) continue;
      for (const s of l.steps) {
        if (s.type === 'task') out.push({ task: s.task, lessonId: l.id, chapterId: ch.id, where: 'step' });
        if (s.type === 'pretest') for (const t of s.items) out.push({ task: t, lessonId: l.id, chapterId: ch.id, where: 'pretest' });
      }
      for (const t of l.checkPool) out.push({ task: t, lessonId: l.id, chapterId: ch.id, where: 'pool' });
    }
    for (const t of ch.boss?.tasks || []) out.push({ task: t, chapterId: ch.id, where: 'boss' });
  }
  return out;
}

type UiTree = { [k: string]: UiTree | T };
export const ui = uiData as UiTree;

export function uiText(key: string): T {
  let node: UiTree | T | undefined = ui;
  for (const part of key.split('.')) node = (node as UiTree | undefined)?.[part];
  if (node && typeof (node as T).en === 'string') return node as T;
  return { en: key, ru: key };
}

export interface Level { xp: number; en: string; ru: string }
export interface Badge { id: string; icon: string; color: string; title: T; desc: T }
export interface Character { name: string | T; role: T }
export const story = storyData as { characters: Record<string, Character>; levels: Level[]; badges: Badge[] };

export const phrases = phrasesData as Record<string, T[]>;

export const errorTexts = errorsData as {
  errors: Record<string, { title: T; explain: T }>;
  lint: Record<string, T>;
  rules: Record<string, T>;
};

export interface InterviewQ { id: string; topic: string; q: T; a: T; tip?: T }
export const interview = (interviewData as { questions: InterviewQ[] }).questions;

export const playground = playgroundData as Playground;
