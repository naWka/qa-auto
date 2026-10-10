// Read English text aloud. Course texts have pre-generated audio (npm run audio → public/audio, content/audio.json);
// anything else falls back to the browser's speech synthesis.
import { useSyncExternalStore } from 'react';
import audioFiles from '../content/audio.json';
import pronounce from '../content/pronounce.yaml';
import { useSettings } from '../store/settings';
import { textKey, toSpeech } from './speech-text';

// Browser voices vary wildly by device: macOS lists robotic Eloquence voices (Eddy, Flo…) and novelty ones
// (Zarvox, Bubbles…) first, and their names are localized ("Плохие новости"). So voices are ranked:
// neural/premium and well-known natural voices first, the robotic and novelty ones last.

const GOOD_QUALITY = /natural|neural|premium|enhanced|online|улучш|высш/i;
const NATURAL = /\b(Samantha|Ava|Zoe|Allison|Evan|Nathan|Susan|Tom|Daniel|Karen|Moira|Tessa|Serena|Kate|Oliver|Aria|Jenny|Andrew|Emma|Brian|Guy|Michelle|Libby|Sonia|Ryan)\b|Саманта|Эва|Зои|Дэниэл|Карен|Мойра|Тесса|Серена/i;
const ROBOTIC = /^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b|^(Альберт|Бах|Виолончель|Воббл|Джуниор|Зарвокс|Колокольчик|Кэти|Орган|Плохие новости|Прыг-скок|Пузырьки|Ральф|Суперзвезда|Триноид|Фред|Хорошие новости|Шепот|Шёпот|Шутник)$/i;

function score(v: SpeechSynthesisVoice): number {
  if (!v.lang.toLowerCase().startsWith('en')) return -Infinity;
  let s = 0;
  if (ROBOTIC.test(v.name)) s -= 100;
  if (GOOD_QUALITY.test(v.name)) s += 50;
  if (/google/i.test(v.name)) s += 40;
  if (NATURAL.test(v.name)) s += 30;
  if (/^en[-_]US/i.test(v.lang)) s += 5;
  else if (/^en[-_]GB/i.test(v.lang)) s += 3;
  return s;
}

let best: SpeechSynthesisVoice | null | undefined;

function pickVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (best !== undefined) return best;
  const voices = synth.getVoices();
  // Chrome fills the list asynchronously: an empty list now is not the final answer.
  if (!voices.length) return null;
  best = voices.reduce<SpeechSynthesisVoice | null>((top, v) => (score(v) > (top ? score(top) : -Infinity) ? v : top), null);
  return best;
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.addEventListener?.('voiceschanged', () => { best = undefined; });
}

// ---------- what is playing now (for the listen buttons) ----------

let current: { text: string; stop: () => void } | null = null;
const listeners = new Set<() => void>();
const setCurrent = (next: typeof current) => { current = next; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** True while this text is being read. */
export function useSpeaking(text: string): boolean {
  return useSyncExternalStore(subscribe, () => current?.text === text);
}

export function stopSpeaking() {
  const was = current;
  setCurrent(null);
  was?.stop();
}

// Leaving the page stops the reading.
if (typeof window !== 'undefined') window.addEventListener('hashchange', stopSpeaking);

function speakWithBrowser(text: string, rate: number, done: () => void): (() => void) | null {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voice = pickVoice(synth);
  // One utterance per sentence: Chrome stops long utterances after ~15 s.
  const sentences = toSpeech(text, pronounce).split(/(?<=[.!?])\s+/);
  sentences.forEach((sentence, i) => {
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = voice?.lang ?? 'en-US';
    if (voice) u.voice = voice;
    u.rate = rate;
    if (i === sentences.length - 1) { u.onend = done; u.onerror = done; }
    synth.speak(u);
  });
  return () => synth.cancel();
}

export function speak(text: string) {
  try {
    stopSpeaking();
    const rate = useSettings.getState().speechRate;
    const me = { text, stop: () => {} };
    const done = () => { if (current === me) setCurrent(null); };
    const file = (audioFiles as Record<string, string>)[textKey(text)];
    if (file) {
      const audio = new Audio(`${import.meta.env.BASE_URL}audio/${file}.mp3`);
      audio.playbackRate = rate;
      audio.onended = done;
      me.stop = () => audio.pause();
      audio.play().catch(() => {
        // Missing file or blocked playback: the browser voice still reads it.
        if (current === me) me.stop = speakWithBrowser(text, rate, done) ?? (() => {});
      });
    } else {
      const stop = speakWithBrowser(text, rate, done);
      if (!stop) return;
      me.stop = stop;
    }
    setCurrent(me);
  } catch {
    /* speech is optional */
  }
}

/** Listen button behaviour: a second press stops the reading. */
export function toggleSpeak(text: string) {
  if (current?.text === text) stopSpeaking();
  else speak(text);
}
