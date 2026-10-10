// Text processing for bilingual content: gender variants, placeholders, term links, markdown.
import { marked } from 'marked';
import type { T, TS } from '../content/schema';
import type { Gender } from '../store/settings';

marked.setOptions({ gfm: true, breaks: false });
// External links (docs) open in a new tab so the lesson stays where it was; downloads stay in place.
marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const ext = /^https?:\/\//.test(href);
      return `<a href="${href}"${title ? ` title="${title}"` : ''}${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}${/\.zip$/.test(href) ? ' download' : ''}>${text}</a>`;
    },
  },
});

const GENDER_RE = /\{([^{}|]*)\|([^{}|]*)\}/g;

export function applyGender(s: string, g: Gender): string {
  return s.replace(GENDER_RE, (_m, f, m) => (g === 'f' ? f : m));
}

export function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** [[display|id]] → interactive term chip (skipping inline code). */
export function linkTerms(s: string): string {
  return s
    .split(/(`[^`]*`)/g)
    .map((part) => (part.startsWith('`') ? part : part.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
      const [display, id] = inner.split('|');
      const termId = id ? id.trim() : slug(display);
      return `<button type="button" class="term" data-term="${escapeHtml(termId)}">${escapeHtml(display.trim())}</button>`;
    })))
    .join('');
}

export function stripTerms(s: string): string {
  return s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');
}

export function mdBlock(s: string): string {
  return marked.parse(linkTerms(s), { async: false }) as string;
}

export function mdInline(s: string): string {
  return marked.parseInline(linkTerms(s), { async: false }) as string;
}

export function isT(v: unknown): v is T {
  return !!v && typeof v === 'object' && typeof (v as T).en === 'string' && typeof (v as T).ru === 'string';
}

export function toT(v: TS | undefined): T {
  if (v === undefined) return { en: '', ru: '' };
  return typeof v === 'string' ? { en: v, ru: v } : v;
}

/** Resolved plain strings for a bilingual value under current gender (no markdown). */
export function resolve(v: TS, g: Gender, vars?: Record<string, string | number>): { en: string; ru: string } {
  const t = toT(v);
  return {
    en: stripTerms(interpolate(applyGender(t.en, g), vars)),
    ru: stripTerms(interpolate(applyGender(t.ru, g), vars)),
  };
}
