import { useEffect, useMemo, useState } from 'react';
import type { TS } from '../content/schema';
import { BiInline, U } from '../components/Bi';
import { CodeLine } from '../components/CodeView';
import { shuffle, type KindProps, type Registration } from './types';

export interface MatchSpec {
  id: string;
  pairs: { left: TS; right: TS }[];
  leftCode?: boolean;
  rightCode?: boolean;
}

// Pair tints stay clear of red, green and orange: those read as "wrong" or "right". The number tells repeated tints apart.
const COLORS = ['lavender', 'sky', 'butter'];

function Item({ t, code }: { t: TS; code?: boolean }) {
  return code && typeof t === 'string' ? <CodeLine code={t} /> : <BiInline t={t} />;
}

/** Reusable matching board (also used by vocab "match" mode). */
export function MatchBoard({ spec, register, phase }: { spec: MatchSpec; register: (r: Registration) => void; phase: string }) {
  const rightOrder = useMemo(() => shuffle(spec.pairs.map((_, i) => i)), [spec.id]);
  const [pick, setPick] = useState<number | null>(null);
  const [links, setLinks] = useState<Record<number, number>>({}); // left → right
  const [bad, setBad] = useState<Set<number>>(new Set());
  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final';

  useEffect(() => {
    register({
      canCheck: Object.keys(links).length === spec.pairs.length,
      check: () => {
        const wrong = new Set(Object.entries(links).filter(([l, r]) => Number(l) !== r).map(([l]) => Number(l)));
        setBad(wrong);
        return { correct: wrong.size === 0 };
      },
      reveal: () => {
        setLinks(Object.fromEntries(spec.pairs.map((_, i) => [i, i])));
        setBad(new Set());
      },
    });
  });

  const rightOwner = (r: number) => Number(Object.keys(links).find((l) => links[Number(l)] === r) ?? -1);
  const colorOf = (l: number) => {
    const linked = Object.keys(links).map(Number).sort((a, b) => a - b);
    return COLORS[linked.indexOf(l) % COLORS.length];
  };

  const clickLeft = (l: number) => {
    if (locked) return;
    if (links[l] !== undefined) {
      const n = { ...links };
      delete n[l];
      setLinks(n);
      setBad(new Set());
      setPick(l);
      return;
    }
    setPick(pick === l ? null : l);
  };
  const clickRight = (r: number) => {
    if (locked || pick === null) return;
    const n = { ...links };
    const owner = rightOwner(r);
    if (owner >= 0) delete n[owner];
    n[pick] = r;
    setLinks(n);
    setBad(new Set());
    setPick(null);
  };

  return (
    <div className="match">
      <div className="task-hint-line"><U k="task.matchHint" stack={false} /></div>
      <div className="match-cols">
        <div className="match-col">
          {spec.pairs.map((p, l) => {
            const linked = links[l] !== undefined;
            return (
              <button key={l} type="button" className={`match-item ${pick === l ? 'picked' : ''} ${linked ? `linked c-${colorOf(l)}` : ''} ${bad.has(l) && !locked ? 'bad' : ''} ${locked ? 'ok' : ''}`} onClick={() => clickLeft(l)} disabled={locked}>
                {linked && <span className="match-n">{l + 1}</span>}
                <Item t={p.left} code={spec.leftCode} />
              </button>
            );
          })}
        </div>
        <div className="match-col">
          {rightOrder.map((r) => {
            const owner = rightOwner(r);
            return (
              <button key={r} type="button" className={`match-item ${owner >= 0 ? `linked c-${colorOf(owner)}` : ''} ${pick !== null && owner < 0 ? 'targetable' : ''} ${owner >= 0 && bad.has(owner) && !locked ? 'bad' : ''} ${locked ? 'ok' : ''}`} onClick={() => clickRight(r)} disabled={locked}>
                {owner >= 0 && <span className="match-n">{owner + 1}</span>}
                <Item t={spec.pairs[r].right} code={spec.rightCode} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MatchTask({ task, register, phase }: KindProps<MatchSpec>) {
  return <MatchBoard spec={task} register={register} phase={phase} />;
}
