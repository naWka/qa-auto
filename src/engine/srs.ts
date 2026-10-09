// SM-2 spaced repetition (as in Anki/SuperMemo 2), with "retirement" for well-known items.
import { addDays } from '../lib/dates';

export interface Card {
  kind: 'term' | 'topic';
  ef: number;
  interval: number;
  reps: number;
  due: string;
  lapses: number;
  retired?: boolean;
}

const RETIRE_AFTER = { term: 180, topic: 90 };

export function newCard(kind: Card['kind'], today: string, confident = false): Card {
  // Topics counted via "I know this" start with a long interval and high ease: rare reviews.
  if (confident) return { kind, ef: 2.8, interval: 7, reps: 2, due: addDays(today, 7), lapses: 0 };
  return { kind, ef: 2.5, interval: 1, reps: 0, due: addDays(today, 1), lapses: 0 };
}

/** quality: 0–5 (≥3 = remembered). */
export function review(card: Card, quality: number, today: string): Card {
  const q = Math.max(0, Math.min(5, quality));
  let { ef, interval, reps, lapses } = card;
  if (q < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ef);
  }
  ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const retired = q >= 3 && interval > RETIRE_AFTER[card.kind];
  return { ...card, ef, interval, reps, lapses, due: addDays(today, interval), retired };
}

export function isDue(card: Card, today: string): boolean {
  return !card.retired && card.due <= today;
}
