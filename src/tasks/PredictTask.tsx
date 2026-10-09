import { useEffect, useRef, useState } from 'react';
import type { Task } from '../content/schema';
import { U } from '../components/Bi';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { CodeLab, type LabHandle } from '../lab/CodeLab';
import type { RunResult } from '../emulator';
import { useProgress } from '../store/progress';
import { OptionList } from './ChoiceTask';
import type { KindProps } from './types';

type Predict = Extract<Task, { kind: 'predict' }>;

export function PredictTask({ task, register, phase }: KindProps<Predict>) {
  const [guess, setGuess] = useState<'pass' | 'fail' | null>(null);
  const [reason, setReason] = useState<Set<number>>(new Set());
  const [real, setReal] = useState<RunResult | null>(null);
  const lab = useRef<LabHandle | null>(null);
  const started = useRef(false);
  const bump = useProgress((s) => s.bumpStat);
  const answered = phase === 'correct' || phase === 'revealed' || phase === 'final' || phase === 'wrong';

  useEffect(() => {
    register({
      canCheck: !!guess && (!task.reasons?.length || reason.size > 0),
      check: () => {
        const outcomeOk = guess === task.outcome;
        const reasonOk = !task.reasons?.length || [...reason].every((i) => task.reasons![i].correct);
        if (outcomeOk && reasonOk) bump('predictCorrect');
        return { correct: outcomeOk && reasonOk, final: true };
      },
      reveal: () => setGuess(task.outcome),
    });
  });

  useEffect(() => {
    if (answered && !started.current) {
      started.current = true;
      setTimeout(() => lab.current?.run(), 250);
    }
  }, [answered]);

  const pseudoTask = task.reasons ? { id: task.id, kind: 'choice' as const, prompt: task.prompt, options: task.reasons } : null;
  const realOutcome = real ? (real.status === 'passed' ? 'pass' : 'fail') : null;

  return (
    <div className="task-predict">
      {!answered && <CodeView code={task.code} />}
      <div className="predict-q">
        <U k="task.predictQuestion" />
        <div className="predict-buttons">
          <button type="button" className={`predict-btn pass ${guess === 'pass' ? 'on' : ''}`} onClick={() => !answered && setGuess('pass')} disabled={answered && guess !== 'pass'}>
            <Icon name="check" size={18} strokeWidth={2.4} /> <U k="task.willPass" stack={false} />
          </button>
          <button type="button" className={`predict-btn fail ${guess === 'fail' ? 'on' : ''}`} onClick={() => !answered && setGuess('fail')} disabled={answered && guess !== 'fail'}>
            <Icon name="x" size={18} strokeWidth={2.4} /> <U k="task.willFail" stack={false} />
          </button>
        </div>
      </div>
      {pseudoTask && (
        <div className="predict-why">
          <div className="task-hint-line"><U k="task.predictWhy" stack={false} /></div>
          <OptionList task={pseudoTask} selected={reason} toggle={(i) => setReason(new Set([i]))} phase={answered ? 'final' : phase} showAll={answered} />
        </div>
      )}
      {answered && (
        <div className="predict-run">
          <div className="predict-compare">
            <U k="task.nowRun" />
            {realOutcome && (
              <span className={`chip ${realOutcome === guess ? 'chip-mint' : 'chip-coral'}`}>
                <U k={realOutcome === guess ? 'task.predictionRight' : 'task.predictionWrong'} stack={false} />
              </span>
            )}
          </div>
          <CodeLab code={task.code} readOnly app={task.app} labRef={lab} onResult={setReal} browserHeight={340} />
        </div>
      )}
    </div>
  );
}
