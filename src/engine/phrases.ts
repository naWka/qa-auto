// Picks mentor phrases without repeating recent ones.
import { phrases } from '../content';
import type { T } from '../content/schema';

const recent: Record<string, number[]> = {};

export function pickPhrase(situation: string): T {
  const pool = phrases[situation] || phrases.correct || [{ en: '…', ru: '…' }];
  const used = (recent[situation] ||= []);
  const free = pool.map((_, i) => i).filter((i) => !used.includes(i));
  const idx = free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * pool.length);
  used.push(idx);
  if (used.length > Math.min(pool.length - 1, 20)) used.shift();
  return pool[idx];
}
