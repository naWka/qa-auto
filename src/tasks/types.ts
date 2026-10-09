import type { ReactNode } from 'react';
import type { TS } from '../content/schema';

export interface GradeResult {
  correct: boolean;
  /** specific feedback shown under the mentor reaction */
  feedback?: TS;
  detail?: ReactNode;
  /** a test run failed before this answer turned out correct */
  hadRedRun?: boolean;
  /** no retry: the answer is shown right away (predictions) */
  final?: boolean;
}

export interface Registration {
  canCheck: boolean;
  check: () => GradeResult | Promise<GradeResult>;
  reveal?: () => void;
  checkLabel?: string;
  /** hide the shell's check button (the kind renders its own) */
  hideCheck?: boolean;
}

export type Phase = 'answering' | 'checking' | 'correct' | 'wrong' | 'revealed' | 'final';

export interface KindProps<T> {
  task: T;
  register: (r: Registration) => void;
  phase: Phase;
  exam: boolean;
  last: GradeResult | null;
}

export const normQuotes = (s: string) => s.replace(/[“”«»„]/g, '"').replace(/[‘’`]/g, "'").replace(/"/g, "'");

export function sameAnswer(given: string, answers: string[], caseSensitive = false) {
  const n = (s: string) => {
    let x = normQuotes(s).trim().replace(/\s+/g, ' ').replace(/;$/, '');
    if (!caseSensitive) x = x.toLowerCase();
    return x;
  };
  return answers.some((a) => n(a) === n(given));
}

export function shuffle<T>(arr: T[], seed = Math.random()): T[] {
  const a = [...arr];
  let s = Math.floor(seed * 2 ** 31) || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
