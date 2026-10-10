// Global term card: hover (desktop) or tap any highlighted term to see pronunciation,
// translation and a real work phrase.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { glossary } from '../content';
import { Bi, U, useLang } from './Bi';
import { Icon } from './Icon';
import { navigate } from '../lib/router';
import { ListenButton } from './Listen';

interface Open { id: string; rect: DOMRect; pinned: boolean }

export function TermLayer() {
  const [open, setOpen] = useState<Open | null>(null);
  const hoverTimer = useRef<number>(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const termOf = (e: Event) => (e.target as Element | null)?.closest?.('.term[data-term]') as HTMLElement | null;
    const onClick = (e: MouseEvent) => {
      const el = termOf(e);
      if (el) {
        e.preventDefault();
        const id = el.dataset.term!;
        setOpen((o) => (o && o.id === id && o.pinned ? null : { id, rect: el.getBoundingClientRect(), pinned: true }));
        return;
      }
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onOver = (e: MouseEvent) => {
      if (!fine) return;
      const el = termOf(e);
      if (!el) return;
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        setOpen((o) => (o?.pinned ? o : { id: el.dataset.term!, rect: el.getBoundingClientRect(), pinned: false }));
      }, 220);
    };
    const onOut = (e: MouseEvent) => {
      if (!fine) return;
      if (!termOf(e)) return;
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => {
        setOpen((o) => (o && !o.pinned && !cardRef.current?.matches(':hover') ? null : o));
      }, 250);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    const onScroll = () => setOpen((o) => (o && !o.pinned ? null : o));
    document.addEventListener('click', onClick);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  if (!open) return null;
  const entry = glossary.get(open.id);
  const mobile = window.innerWidth < 640;
  const width = 340;
  let left = Math.min(Math.max(12, open.rect.left + open.rect.width / 2 - width / 2), window.innerWidth - width - 12);
  let top = open.rect.bottom + 10;
  const below = top + 260 < window.innerHeight;
  if (!below) top = Math.max(12, open.rect.top - 10);
  const style = mobile ? undefined : { left, top, width, transform: below ? undefined : 'translateY(-100%)' };
  void left;

  return createPortal(
    <div className={`term-card ${mobile ? 'term-sheet' : ''}`} style={style} ref={cardRef} role="dialog" aria-label={entry?.en ?? open.id}
      onMouseLeave={() => setOpen((o) => (o && !o.pinned ? null : o))}>
      {!entry ? (
        <div className="term-head"><strong>{open.id}</strong></div>
      ) : (
        <>
          <div className="term-head">
            <div>
              <div className="term-word">{entry.en}</div>
              <div className="term-ipa">{entry.ipa}{entry.pos ? <span className="term-pos"> · {entry.pos}</span> : null}</div>
            </div>
            <ListenButton text={entry.en} />
          </div>
          {lang !== 'en' && <div className="term-ru">{entry.ru}</div>}
          {lang === 'en' && <div className="term-ru term-ru-muted">{entry.ru}</div>}
          <Bi t={entry.def} className="term-def" size="sm" />
          <div className="term-example">
            <div className="term-example-label"><Icon name="chat" size={14} /> <U k="glossary.example" stack={false} /></div>
            <Bi t={entry.example} size="sm" />
            <ListenButton text={entry.example.en} label />
          </div>
          <button className="link-btn" onClick={() => { setOpen(null); navigate(`/glossary?q=${encodeURIComponent(entry.en)}`); }}>
            <U k="glossary.openGlossary" stack={false} /> <Icon name="chevronRight" size={14} />
          </button>
        </>
      )}
      {mobile && <button className="term-sheet-close" onClick={() => setOpen(null)} aria-label="Close"><Icon name="x" /></button>}
    </div>,
    document.body,
  );
}
