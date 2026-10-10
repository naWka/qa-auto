// Pre-generated speech for every English text the course reads aloud (see scripts/audio-texts.ts).
// Run: npm run audio              generate what is missing, drop files nothing uses, update src/content/audio.json
//      npm run audio -- --check   only report what is missing
//      npm run audio -- --say "getByRole('button')"   show what the engine is given for a text
// Needs uv (https://docs.astral.sh/uv/): Kokoro runs locally through scripts/tts/synth.py.
// Texts without a file are read by the browser voice, so the site works before the audio is generated.
import { readdirSync, unlinkSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { toSpeech } from '../src/lib/speech-text.ts';
import { AUDIO_DIR, MANIFEST, SPEED, VOICE, audioJobs, hasAudio, pronounce } from './audio-texts.ts';

const args = process.argv.slice(2);

if (args[0] === '--say') {
  console.log(toSpeech(args.slice(1).join(' '), pronounce()));
  process.exit(0);
}

const jobs = audioJobs();
const missing = [...new Map(jobs.filter((j) => !hasAudio(j)).map((j) => [j.file, j])).values()];
console.log(`${jobs.length} texts · ${missing.length} without audio · voice ${VOICE}`);

if (args.includes('--check')) {
  for (const j of missing) console.log(`  ${j.text.slice(0, 90)}`);
  process.exit(0);
}

mkdirSync(AUDIO_DIR, { recursive: true });
if (missing.length) {
  const tmp = mkdtempSync(join(tmpdir(), 'bloomqa-audio-'));
  const jobsFile = join(tmp, 'jobs.json');
  writeFileSync(jobsFile, JSON.stringify(missing.map((j) => ({ file: j.file, text: j.spoken }))));
  const r = spawnSync('uv', ['run', '--quiet', join(import.meta.dirname, 'tts', 'synth.py'), jobsFile, AUDIO_DIR, '--voice', VOICE, '--speed', String(SPEED)], { stdio: 'inherit' });
  rmSync(tmp, { recursive: true, force: true });
  if (r.error) {
    console.error(`✗ couldn't start uv (${r.error.message}). Install it: https://docs.astral.sh/uv/`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Files of texts that changed or were removed.
const used = new Set(jobs.map((j) => `${j.file}.mp3`));
let dropped = 0;
for (const f of readdirSync(AUDIO_DIR)) {
  if (f.endsWith('.mp3') && !used.has(f)) { unlinkSync(join(AUDIO_DIR, f)); dropped++; }
}

const manifest = Object.fromEntries(jobs.filter(hasAudio).map((j) => [j.key, j.file]).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(`✓ ${Object.keys(manifest).length}/${jobs.length} texts have audio${dropped ? ` · ${dropped} unused files removed` : ''}`);
