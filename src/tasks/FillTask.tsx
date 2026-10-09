import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Task } from '../content/schema';
import { highlightLines } from '../components/CodeView';
import { RunCompleted } from './RunCompleted';
import { normQuotes, type KindProps } from './types';

type Fill = Extract<Task, { kind: 'fill' }>;

const MARK = (i: number) => `__BLANK${i}__`;

export function fillCode(code: string, values: string[]) {
  let i = 0;
  return code.replace(/___/g, () => values[i++] ?? '');
}

export function FillTask({ task, register, phase, exam }: KindProps<Fill>) {
  const [values, setValues] = useState<string[]>(() => task.blanks.map(() => ''));
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const marked = useMemo(() => {
    let i = 0;
    return task.code.replace(/\n$/, '').replace(/___/g, () => MARK(i++));
  }, [task.code]);
  const lines = useMemo(() => highlightLines(marked), [marked]);

  const isRight = (i: number, v: string) => task.blanks[i].answers.some((a) => normQuotes(a.trim()) === normQuotes(v.trim()));

  useEffect(() => {
    register({
      canCheck: values.every((v) => v.trim()),
      check: () => {
        const bad = new Set(values.map((v, i) => (isRight(i, v) ? -1 : i)).filter((i) => i >= 0));
        setWrong(bad);
        return { correct: bad.size === 0 };
      },
      reveal: () => {
        setValues(task.blanks.map((b) => b.answers[0]));
        setWrong(new Set());
      },
    });
  });

  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final';
  const setV = (i: number, v: string) => {
    setValues((vs) => vs.map((x, j) => (j === i ? v : x)));
    setWrong((w) => { const n = new Set(w); n.delete(i); return n; });
  };

  const renderBlank = (i: number) => {
    const b = task.blanks[i];
    const cls = `blank ${wrong.has(i) && !locked ? 'blank-wrong' : ''} ${locked && (phase !== 'final' || isRight(i, values[i])) ? 'blank-ok' : ''} ${phase === 'final' && !isRight(i, values[i]) ? 'blank-wrong' : ''}`;
    const width = Math.max(4, ...b.answers.map((a) => a.length), ...(b.options || []).map((o) => o.length)) + 1;
    if (b.options) {
      return (
        <select key={`b${i}`} className={cls} value={values[i]} onChange={(e) => setV(i, e.target.value)} disabled={locked} aria-label={`gap ${i + 1}`} style={{ minWidth: `${width + 2}ch` }}>
          <option value="">…</option>
          {b.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    return <input key={`b${i}`} className={cls} value={values[i]} onChange={(e) => setV(i, e.target.value)} disabled={locked} aria-label={`gap ${i + 1}`} spellCheck={false} autoCapitalize="off" autoComplete="off" style={{ width: `${width}ch` }} />;
  };

  return (
    <div className="task-fill">
      <div className="codeview fill-code">
        <pre>
          {lines.map((toks, li) => (
            <div className="cv-line" key={li}>
              <span className="cv-num">{li + 1}</span>
              <span className="cv-code">
                {toks.map((t, ti) => {
                  const parts = t.text.split(/(__BLANK\d+__)/);
                  return (
                    <Fragment key={ti}>
                      {parts.map((p, pi) => {
                        const m = p.match(/^__BLANK(\d+)__$/);
                        if (m) return renderBlank(Number(m[1]));
                        return p ? <span key={pi} className={t.cls}>{p}</span> : null;
                      })}
                    </Fragment>
                  );
                })}
                {toks.length === 0 && '​'}
              </span>
            </div>
          ))}
        </pre>
      </div>
      {task.checks && (phase === 'correct' || phase === 'revealed') && !exam && (
        <RunCompleted code={fillCode(task.code, values)} app={task.app} />
      )}
    </div>
  );
}
