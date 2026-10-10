// Every English text the course reads aloud, and where its audio lives.
// Shared by scripts/audio.ts (generates the files) and scripts/check-content.ts (reports missing ones).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { toSpeech, textKey, type Pronounce } from '../src/lib/speech-text.ts';

export const VOICE = 'am_michael';
export const SPEED = 1.0;

const ROOT = join(import.meta.dirname, '..');
export const CONTENT = join(ROOT, 'src', 'content');
export const AUDIO_DIR = join(ROOT, 'public', 'audio');
export const MANIFEST = join(CONTENT, 'audio.json');

const read = (file: string): any => {
  try {
    return YAML.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // check-content reports broken files
  }
};

/** What speak() gets called with: glossary terms and examples, lesson work phrases, interview questions and answers. */
export function spokenTexts(): string[] {
  const texts = new Set<string>();
  const add = (s: unknown) => typeof s === 'string' && s.trim() && texts.add(s);
  const glossaryDir = join(CONTENT, 'glossary');
  for (const f of readdirSync(glossaryDir).filter((f) => f.endsWith('.yaml')).sort()) {
    for (const e of read(join(glossaryDir, f)) || []) { add(e.en); add(e.example?.en); }
  }
  const chaptersDir = join(CONTENT, 'chapters');
  for (const dir of readdirSync(chaptersDir).sort()) {
    if (!existsSync(join(chaptersDir, dir, 'chapter.yaml'))) continue;
    for (const f of readdirSync(join(chaptersDir, dir)).filter((f) => /^l\d+.*\.yaml$/.test(f)).sort()) {
      for (const s of read(join(chaptersDir, dir, f))?.steps || []) if (s.type === 'phrases') for (const p of s.items || []) add(p.en);
    }
  }
  for (const q of read(join(CONTENT, 'interview.yaml'))?.questions || []) { add(q.q?.en); add(q.a?.en); }
  return [...texts];
}

export const pronounce = (): Pronounce => read(join(CONTENT, 'pronounce.yaml')) || {};

export interface AudioJob { key: string; file: string; text: string; spoken: string }

/** One job per text: key = id of the displayed text, file = id of what is said and by which voice. */
export function audioJobs(): AudioJob[] {
  const dict = pronounce();
  return spokenTexts().map((text) => {
    const spoken = toSpeech(text, dict);
    return { key: textKey(text), file: textKey(`${VOICE}@${SPEED}\n${spoken}`), text, spoken };
  });
}

export const hasAudio = (job: AudioJob) => existsSync(join(AUDIO_DIR, `${job.file}.mp3`));
