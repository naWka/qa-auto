// Bilingual rendering: EN main + RU translation (or one language), per the user's mode.
import type { ReactNode } from 'react';
import type { TS } from '../content/schema';
import { uiText } from '../content';
import { useSettings, type LangMode } from '../store/settings';
import { applyGender, interpolate, mdBlock, mdInline, resolve, toT } from '../lib/text';

export function useLang() {
  const lang = useSettings((s) => s.lang);
  const gender = useSettings((s) => s.gender);
  return { lang, gender };
}

type Vars = Record<string, string | number>;

const FENCE = /```[\s\S]*?```/g;

function prepared(t: TS, gender: 'f' | 'm', vars?: Vars) {
  const v = toT(t);
  const en = interpolate(applyGender(v.en, gender), vars);
  let ru = interpolate(applyGender(v.ru, gender), vars);
  // Code blocks are the same in both languages: don't print them twice.
  const enBlocks = new Set((en.match(FENCE) || []).map((b) => b.trim()));
  if (enBlocks.size) ru = ru.replace(FENCE, (b) => (enBlocks.has(b.trim()) ? '' : b)).replace(/\n{3,}/g, '\n\n').trim();
  return { en, ru };
}

/** Block text (markdown). One paragraph pair; EN first, RU under it. */
export function Bi({ t, vars, className = '', size }: { t: TS; vars?: Vars; className?: string; size?: 'lg' | 'sm' }) {
  const { lang, gender } = useLang();
  const p = prepared(t, gender, vars);
  const cls = `bi ${size ? `bi-${size}` : ''} ${className}`;
  if (lang === 'en' || p.en === p.ru) return <div className={`${cls} bi-single`} dangerouslySetInnerHTML={{ __html: mdBlock(p.en) }} />;
  if (lang === 'ru') return <div className={`${cls} bi-single`} lang="ru" dangerouslySetInnerHTML={{ __html: mdBlock(p.ru) }} />;
  return (
    <div className={cls}>
      <div className="bi-en" lang="en" dangerouslySetInnerHTML={{ __html: mdBlock(p.en) }} />
      <div className="bi-ru" lang="ru" dangerouslySetInnerHTML={{ __html: mdBlock(p.ru) }} />
    </div>
  );
}

/** Several aligned paragraphs. */
export function BiParas({ items, className = '' }: { items: TS[]; className?: string }) {
  return (
    <div className={`bi-paras ${className}`}>
      {items.map((t, i) => <Bi key={i} t={t} />)}
    </div>
  );
}

/** Inline text (titles, labels): "EN · RU" stacked compactly. */
export function BiInline({ t, vars, className = '', stack = true }: { t: TS; vars?: Vars; className?: string; stack?: boolean }) {
  const { lang, gender } = useLang();
  const p = prepared(t, gender, vars);
  if (lang === 'en' || p.en === p.ru) return <span className={`bil ${className}`} dangerouslySetInnerHTML={{ __html: mdInline(p.en) }} />;
  if (lang === 'ru') return <span className={`bil ${className}`} lang="ru" dangerouslySetInnerHTML={{ __html: mdInline(p.ru) }} />;
  return (
    <span className={`bil bil-both ${stack ? 'bil-stack' : ''} ${className}`}>
      <span className="bil-en" lang="en" dangerouslySetInnerHTML={{ __html: mdInline(p.en) }} />
      <span className="bil-ru" lang="ru" dangerouslySetInnerHTML={{ __html: mdInline(p.ru) }} />
    </span>
  );
}

/** Interface string by key. */
export function U({ k, vars, stack, className }: { k: string; vars?: Vars; stack?: boolean; className?: string }) {
  return <BiInline t={uiText(k)} vars={vars} stack={stack} className={className} />;
}

/** Interface string in the primary language only (compact navigation, chips). */
export function P({ k }: { k: string }) {
  const primary = usePrimary();
  return <>{primary(uiText(k))}</>;
}

/** Plain string of an interface key, for attributes (placeholder, title, aria-label). */
export function useUiString() {
  const { lang, gender } = useLang();
  return (key: string, vars?: Vars) => plain(uiText(key), lang, gender, vars);
}

/** Plain string of any bilingual value. */
export function usePlain() {
  const { lang, gender } = useLang();
  return (t: TS, vars?: Vars) => plain(t, lang, gender, vars);
}

export function plain(t: TS, lang: LangMode, gender: 'f' | 'm', vars?: Vars): string {
  const r = resolve(t, gender, vars);
  if (lang === 'en') return r.en;
  if (lang === 'ru') return r.ru;
  return r.en === r.ru ? r.en : `${r.en} · ${r.ru}`;
}

/** Primary-language string only (for compact chips): EN unless RU-only mode. */
export function usePrimary() {
  const { lang, gender } = useLang();
  return (t: TS, vars?: Vars) => {
    const r = resolve(t, gender, vars);
    return lang === 'ru' ? r.ru : r.en;
  };
}

export function Section({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}
