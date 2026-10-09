import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../content/schema';
import { Bi, BiInline, U } from '../components/Bi';
import { CodeLine, CodeView } from '../components/CodeView';
import { DiffView } from '../components/Common';
import { Icon } from '../components/Icon';
import { ScriptRun } from './ScriptRun';
import { shuffle, type KindProps } from './types';

type Choice = Extract<Task, { kind: 'choice' }> | Extract<Task, { kind: 'pick-locator' }>;

export function OptionList({ task, selected, toggle, phase, showAll }: {
  task: Choice;
  selected: Set<number>;
  toggle: (i: number) => void;
  phase: string;
  showAll: boolean;
}) {
  const order = useMemo(() => shuffle(task.options.map((_, i) => i)), [task.id]);
  const multi = task.kind === 'choice' && task.multi;
  const asCode = task.kind === 'pick-locator' || (task.kind === 'choice' && task.optionsCode);
  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final' || phase === 'checking';
  return (
    <div className={`options ${multi ? 'options-multi' : ''}`} role={multi ? 'group' : 'radiogroup'}>
      {order.map((i) => {
        const o = task.options[i];
        const isSel = selected.has(i);
        let state = '';
        if (showAll && o.correct) state = 'opt-correct';
        else if ((phase === 'wrong' || phase === 'final' || showAll) && isSel && !o.correct) state = 'opt-wrong';
        else if ((phase === 'wrong') && isSel && o.correct && multi) state = '';
        const why = (showAll && (o.correct || isSel)) || (phase === 'wrong' && isSel && !o.correct) ? o.why : undefined;
        return (
          <button
            key={i}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isSel}
            className={`option ${isSel ? 'opt-selected' : ''} ${state}`}
            onClick={() => !locked && toggle(i)}
            disabled={locked && !isSel && !(showAll && o.correct)}
          >
            <span className={`opt-mark ${multi ? 'opt-box' : 'opt-dot'}`}>
              {state === 'opt-correct' ? <Icon name="check" size={14} strokeWidth={2.6} /> : state === 'opt-wrong' ? <Icon name="x" size={14} strokeWidth={2.6} /> : null}
            </span>
            <span className="opt-body">
              {asCode && typeof o.text === 'string' ? <CodeLine code={o.text} /> : <BiInline t={o.text} />}
              {why && <span className="opt-why"><Bi t={why} size="sm" /></span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ChoiceTask({ task, register, phase, exam }: KindProps<Choice>) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const multi = task.kind === 'choice' && task.multi;
  const toggle = (i: number) => {
    setSelected((s) => {
      const n = new Set(multi ? s : []);
      if (multi && s.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  };
  useEffect(() => {
    register({
      canCheck: selected.size > 0,
      check: () => {
        const correct = new Set(task.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0));
        const ok = correct.size === selected.size && [...selected].every((i) => correct.has(i));
        return { correct: ok };
      },
      reveal: () => setRevealed(true),
    });
  });
  const showAll = phase === 'correct' || revealed || phase === 'revealed' || (exam && phase === 'final');
  return (
    <div className="task-choice">
      {task.kind === 'choice' && task.code && <CodeView code={task.code} />}
      {task.kind === 'choice' && task.diff && <DiffView before={task.diff.before} after={task.diff.after} />}
      <div className="task-hint-line"><U k={multi ? 'task.chooseMany' : 'task.chooseOne'} stack={false} /></div>
      <OptionList task={task} selected={selected} toggle={toggle} phase={phase} showAll={showAll} />
      {task.kind === 'choice' && task.run === 'script' && task.code && (phase === 'correct' || phase === 'revealed' || phase === 'final') && <ScriptRun code={task.code} />}
    </div>
  );
}
