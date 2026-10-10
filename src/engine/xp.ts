import type { Task } from '../content/schema';
import { story, type Level } from '../content';

const BASE: Record<Task['kind'], number> = {
  choice: 5, input: 6, vocab: 4, match: 6, fill: 8, parsons: 8, predict: 8, 'pick-locator': 8,
  review: 12, agent: 12, fix: 15, 'find-bug': 20, code: 20, inspect: 8, trace: 10,
};

export const LESSON_BONUS = 15;
export const BOSS_BONUS = 50;

export function baseXp(task: Pick<Task, 'kind' | 'xp'>): number {
  return task.xp ?? BASE[task.kind];
}

/** Reward after hints: each hint −25%, minimum 25%; revealed answer = 0. */
export function earnedXp(task: Pick<Task, 'kind' | 'xp'>, hints: number, revealed: boolean): number {
  if (revealed) return 0;
  return Math.max(1, Math.round(baseXp(task) * Math.max(0.25, 1 - 0.25 * hints)));
}

export function levelFor(xp: number): { index: number; level: Level; next?: Level; progress: number } {
  const levels = story.levels;
  let index = 0;
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i].xp) index = i;
  const level = levels[index];
  const next = levels[index + 1];
  const progress = next ? (xp - level.xp) / (next.xp - level.xp) : 1;
  return { index, level, next, progress };
}
