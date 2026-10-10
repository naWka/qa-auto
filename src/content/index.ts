// Loads all YAML content at build time and exposes typed lookups.
import type { Chapter, GlossaryEntry, Lesson, Task, T } from './schema';
import uiData from './ui.yaml';
import storyData from './story.yaml';
import phrasesData from './phrases.yaml';
import errorsData from './errors.yaml';
import interviewData from './interview.yaml';

const chapterFiles = import.meta.glob('./chapters/*/chapter.yaml', { eager: true, import: 'default' }) as Record<string, Chapter>;
const lessonFiles = import.meta.glob('./chapters/*/l*.yaml', { eager: true, import: 'default' }) as Record<string, Lesson>;
const glossaryFiles = import.meta.glob('./glossary/*.yaml', { eager: true, import: 'default' }) as Record<string, GlossaryEntry[]>;

export const chapters: Chapter[] = Object.values(chapterFiles).sort((a, b) => a.number - b.number);

export const lessons = new Map<string, Lesson>();
for (const l of Object.values(lessonFiles)) if (l?.id) lessons.set(l.id, l);

export const glossary = new Map<string, GlossaryEntry>();
for (const list of Object.values(glossaryFiles)) for (const e of list || []) glossary.set(e.id, e);

export function chapterById(id: string) {
  return chapters.find((c) => c.id === id);
}

export function lessonsOf(ch: Chapter): Lesson[] {
  return (ch.lessons || []).map((id) => lessons.get(id)).filter(Boolean) as Lesson[];
}

/** Every task in the course, with where it lives. */
export interface TaskRef { task: Task; lessonId?: string; chapterId: string; where: 'step' | 'pretest' | 'pool' | 'boss' }
export const allTasks: TaskRef[] = [];
for (const ch of chapters) {
  for (const l of lessonsOf(ch)) {
    for (const s of l.steps) {
      if (s.type === 'task') allTasks.push({ task: s.task, lessonId: l.id, chapterId: ch.id, where: 'step' });
      if (s.type === 'pretest') for (const t of s.items) allTasks.push({ task: t, lessonId: l.id, chapterId: ch.id, where: 'pretest' });
    }
    for (const t of l.checkPool) allTasks.push({ task: t, lessonId: l.id, chapterId: ch.id, where: 'pool' });
  }
  for (const t of ch.boss?.tasks || []) allTasks.push({ task: t, chapterId: ch.id, where: 'boss' });
}
export const taskById = new Map(allTasks.map((r) => [r.task.id, r]));

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
