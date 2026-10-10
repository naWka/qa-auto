// Course text → text a speech engine reads naturally: inline code, camelCase names, emails, case ids.
// Shared by the audio generator (scripts/audio.ts) and the browser voice fallback (lib/speech.ts),
// so it must stay free of imports. Word-level fixes live in content/pronounce.yaml.

export type Pronounce = Record<string, string>;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** getByTestId → get by test ID, toHaveURL → to have URL; acronyms and single capitals stay as they are. */
function splitIdentifier(word: string): string {
  if (!/[a-z][A-Z]|[A-Z]{2}[a-z]/.test(word) || /^[A-Z]{2,}s$/.test(word)) return word;
  return word
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .map((w) => (w === 'Id' ? 'ID' : /^[A-Z]+$/.test(w) ? w : w.toLowerCase()))
    .join(' ');
}

/** What a developer says reading a code span aloud: page.get_by_role("button") → page dot get by role button. */
function speakCode(code: string): string {
  return code
    .replace(/\.py\b/g, ' dot pie')
    .replace(/\.(ts|js|md|ini|toml|txt|yml|yaml)\b/g, (_m, ext: string) => ` dot ${ext.toUpperCase()}`)
    .replace(/(^|\s)@(?=\w)/g, '$1at ')
    .replace(/_+/g, ' ')
    .replace(/(\d)\/(\d)/g, '$1 of $2')
    .replace(/=>/g, ' ')
    .replace(/(^|\s)--?(?=\w)/g, '$1')
    .replace(/\//g, ' slash ')
    .replace(/[`'"(){}[\]<>;!]+/g, ' ')
    .replace(/[=:]/g, ' ')
    .replace(/\.(?=[A-Za-z_])/g, ' dot ')
    .replace(/\b[A-Za-z]+[A-Z]\w*\b/g, splitIdentifier);
}

export function toSpeech(text: string, pronounce: Pronounce = {}): string {
  let t = text
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/([\w.+-]+)@(\w+)\.(\w+)/g, '$1 at $2 dot $3')
    .replace(/`([^`]+)`/g, (_m, code: string) => speakCode(code))
    .replace(/`/g, '')
    // Outside code only camelCase: product names like JavaScript or GitHub are read fine as they are.
    .replace(/\b[a-z]+[A-Z]\w*\b/g, splitIdentifier)
    // …and Python names: test_signup.py → test signup dot pie
    .replace(/\b([\w/]+)\.py\b/g, '$1 dot pie')
    .replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, (m) => m.replace(/_/g, ' '))
    .replace(/\b([A-Z]{2,})-(\d+)\b/g, '$1 $2');
  for (const [word, say] of Object.entries(pronounce)) {
    t = t.replace(new RegExp(`(?<!\\w)${esc(word)}(?!\\w)`, 'g'), say);
  }
  return t.replace(/\s+([,.!?:;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** Short stable id of a text (cyrb53): the key of an audio file in content/audio.json. */
export function textKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
