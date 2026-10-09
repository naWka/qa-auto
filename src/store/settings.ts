import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LangMode = 'both' | 'en' | 'ru';
export type Gender = 'f' | 'm';
export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  lang: LangMode;
  gender: Gender;
  theme: Theme;
  /** ms pause on each highlighted step during a test run */
  speed: number;
  celebrations: boolean;
  onboarded: boolean;
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const defaultSettings: Settings = {
  lang: 'both',
  gender: 'f',
  theme: 'auto',
  speed: 350,
  celebrations: true,
  onboarded: false,
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      update: (patch) => set(patch),
    }),
    { name: 'bloomqa-settings', version: 1 },
  ),
);

export function settingsSnapshot(): Settings {
  const s = useSettings.getState();
  return { lang: s.lang, gender: s.gender, theme: s.theme, speed: s.speed, celebrations: s.celebrations, onboarded: s.onboarded };
}
