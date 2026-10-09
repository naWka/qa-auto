// Tiny event bus for celebrations (level up, badges, streaks) triggered by progress changes.
export type AppEvent =
  | { type: 'xp'; amount: number }
  | { type: 'levelUp'; index: number }
  | { type: 'badge'; id: string }
  | { type: 'streak'; days: number }
  | { type: 'welcomeBack'; days: number }
  | { type: 'chapterDone'; id: string };

const listeners = new Set<(e: AppEvent) => void>();

export function emit(e: AppEvent) {
  listeners.forEach((l) => l(e));
}

export function onEvent(fn: (e: AppEvent) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
