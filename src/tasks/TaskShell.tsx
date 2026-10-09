// Common frame for every task: prompt, hints ladder, check, mentor feedback, XP, "show answer".
import { useCallback, useRef, useState } from 'react';
import type { Task } from '../content/schema';
import { Bi, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Mentor } from '../components/Mentor';
import { AppNote, KindChip, TestCaseCard } from '../components/Common';
import type { MochiMood } from '../components/Characters';
import { useProgress } from '../store/progress';
import { pickPhrase } from '../engine/phrases';
import { baseXp, earnedXp } from '../engine/xp';
import { sparkles } from '../lib/celebrate';
import type { GradeResult, Phase, Registration } from './types';
import { ChoiceTask } from './ChoiceTask';
import { InputTask } from './InputTask';
import { FillTask } from './FillTask';
import { ParsonsTask } from './ParsonsTask';
import { MatchTask } from './MatchTask';
import { PredictTask } from './PredictTask';
import { PickLocatorTask } from './PickLocatorTask';
import { ReviewTask } from './ReviewTask';
import { AgentTask } from './AgentTask';
import { CodeTask } from './CodeTask';
import { VocabTask } from './VocabTask';
import type { T } from '../content/schema';

export interface TaskOutcome {
  correct: boolean;
  firstTry: boolean;
  hints: number;
  revealed: boolean;
  xp: number;
}

export type ShellMode = 'learn' | 'exam' | 'review';

export function TaskBody({ task, register, phase, exam, last }: { task: Task; register: (r: Registration) => void; phase: Phase; exam: boolean; last: GradeResult | null }) {
  const p = { register, phase, exam, last };
  switch (task.kind) {
    case 'choice': return <ChoiceTask task={task} {...p} />;
    case 'pick-locator': return <PickLocatorTask task={task} {...p} />;
    case 'input': return <InputTask task={task} {...p} />;
    case 'fill': return <FillTask task={task} {...p} />;
    case 'parsons': return <ParsonsTask task={task} {...p} />;
    case 'match': return <MatchTask task={task} {...p} />;
    case 'predict': return <PredictTask task={task} {...p} />;
    case 'review': return <ReviewTask task={task} {...p} />;
    case 'agent': return <AgentTask task={task} {...p} />;
    case 'fix': case 'find-bug': case 'code': return <CodeTask task={task} {...p} />;
    case 'vocab': return <VocabTask task={task} {...p} />;
  }
}

export function TaskShell({ task, mode = 'learn', bonusXp = 0, onDone, onContinue, continueLabel }: {
  task: Task;
  mode?: ShellMode;
  bonusXp?: number;
  onDone?: (o: TaskOutcome) => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  const reg = useRef<Registration | null>(null);
  const [canCheck, setCanCheck] = useState(false);
  const [checkLabel, setCheckLabel] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>('answering');
  const [last, setLast] = useState<GradeResult | null>(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [wrongStreak, setWrongStreak] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [mentor, setMentor] = useState<{ t: T; mood: MochiMood } | null>(null);
  const [xpGained, setXpGained] = useState<number | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const checkBtn = useRef<HTMLButtonElement>(null);
  const progress = useProgress();
  const exam = mode !== 'learn';
  const hints = task.hints || [];
  const done = phase === 'correct' || phase === 'revealed' || phase === 'final';

  const register = useCallback((r: Registration) => {
    reg.current = r;
    setCanCheck(r.canCheck);
    setCheckLabel(r.checkLabel);
  }, []);

  const finish = (o: TaskOutcome) => onDone?.(o);

  const check = async () => {
    if (!reg.current || phase === 'checking') return;
    setPhase('checking');
    setMentor(null);
    const res = await reg.current.check();
    setLast(res);
    const n = attempts + 1;
    setAttempts(n);
    if (mode === 'learn') progress.attempt(task, res.correct);
    if (res.correct) {
      setPhase('correct');
      setWrongStreak(0);
      let xp = 0;
      if (mode === 'learn') {
        xp = progress.solve(task, { bonus: bonusXp });
        if (n === 1 && hintsShown === 0) {
          if (task.kind === 'agent') progress.bumpStat('promptFirstTry');
          if (task.kind === 'review') progress.bumpStat('reviewPerfect');
        }
        if (res.hadRedRun) progress.bumpStat('redToGreen');
      }
      setXpGained(xp || null);
      setMentor({ t: task.praise && Math.random() < 0.75 ? task.praise : pickPhrase('correct'), mood: 'happy' });
      sparkles(checkBtn.current);
      finish({ correct: true, firstTry: n === 1, hints: hintsShown, revealed: false, xp });
    } else if (exam || res.final) {
      setPhase('final');
      setMentor({ t: pickPhrase('wrong'), mood: 'oops' });
      finish({ correct: false, firstTry: false, hints: hintsShown, revealed: false, xp: 0 });
    } else {
      setPhase('wrong');
      const ws = wrongStreak + 1;
      setWrongStreak(ws);
      setMentor({ t: pickPhrase(ws >= 3 ? 'hintOffer' : ws === 2 ? 'wrongAgain' : 'wrong'), mood: ws >= 3 ? 'think' : 'oops' });
    }
  };

  const showHint = () => {
    if (hintsShown >= hints.length) return;
    setHintsShown(hintsShown + 1);
    if (mode === 'learn' && !progress.tasks[task.id]?.solved) progress.useHint(task.id);
  };

  const reveal = () => {
    setConfirmReveal(false);
    reg.current?.reveal?.();
    setPhase('revealed');
    setMentor({ t: { en: 'Here is the answer — read it slowly, then we will come back to this idea later.', ru: 'Вот ответ — прочитай спокойно, а к этой идее мы ещё вернёмся.' }, mood: 'idle' });
    if (mode === 'learn') progress.solve(task, { revealed: true });
    finish({ correct: false, firstTry: false, hints: hintsShown, revealed: true, xp: 0 });
  };

  const tp = progress.tasks[task.id];
  const potential = earnedXp(task, mode === 'learn' ? tp?.hints ?? hintsShown : 0, false) + bonusXp;
  const canReveal = mode === 'learn' && !done && (attempts >= 2 || hintsShown >= hints.length) && !!reg.current?.reveal;

  return (
    <div className={`task task-${task.kind} phase-${phase}`}>
      <div className="task-head">
        <KindChip kind={task.kind} />
        {mode === 'learn' && !tp?.solved && <span className="xp-chip">+{potential || baseXp(task)} XP</span>}
        {mode === 'learn' && tp?.solved && phase === 'answering' && <span className="xp-chip done"><Icon name="check" size={12} /> {tp.xp ?? 0} XP</span>}
      </div>
      {task.context && <div className="task-context"><Bi t={task.context} /></div>}
      {task.testCase && <TestCaseCard tc={task.testCase} />}
      {task.prompt && <div className="task-prompt"><Bi t={task.prompt} size="lg" /></div>}
      <AppNote app={task.app} />
      <div className="task-body">
        <TaskBody task={task} register={register} phase={phase} exam={exam} last={last} />
      </div>

      {hintsShown > 0 && (
        <div className="hints">
          {hints.slice(0, hintsShown).map((h, i) => (
            <div key={i} className={`hint hint-${i + 1}`}>
              <div className="hint-label"><Icon name="bulb" size={14} /> <U k="task.hintOf" stack={false} /> {i + 1}/{hints.length}</div>
              <Bi t={h} size="sm" />
            </div>
          ))}
        </div>
      )}

      {mentor && (
        <div className="task-feedback">
          <Mentor t={mentor.t} mood={mentor.mood} vars={{}}>
            {last?.feedback && phase !== 'correct' && <div className="feedback-detail"><Bi t={last.feedback} size="sm" /></div>}
            {xpGained ? <span className="xp-pop">+{xpGained} XP</span> : null}
          </Mentor>
        </div>
      )}

      {done && task.explain && (
        <div className="explain-box">
          <div className="explain-label"><Icon name="info" size={15} /> <U k="common.why" stack={false} /></div>
          <Bi t={task.explain} />
        </div>
      )}

      {confirmReveal && (
        <div className="confirm-box">
          <Bi t={{ en: 'Show the answer? You won\'t get XP for this task, and we\'ll suggest revisiting it later.', ru: 'Показать ответ? XP за это задание не будет, и мы предложим вернуться к нему позже.' }} size="sm" />
          <div className="row gap">
            <button className="btn btn-soft btn-sm" onClick={() => setConfirmReveal(false)}><U k="common.cancel" stack={false} /></button>
            <button className="btn btn-coral btn-sm" onClick={reveal}><U k="common.showAnswer" stack={false} /></button>
          </div>
        </div>
      )}

      <div className="task-actions">
        {!done && !exam && hints.length > 0 && (
          <button type="button" className={`btn btn-ghost ${wrongStreak >= 3 && hintsShown < hints.length ? 'pulse' : ''}`} onClick={showHint} disabled={hintsShown >= hints.length}>
            <Icon name="bulb" size={16} /> <U k="task.hint" stack={false} /> {hintsShown}/{hints.length}
          </button>
        )}
        {canReveal && !confirmReveal && (
          <button type="button" className="btn btn-ghost subtle" onClick={() => setConfirmReveal(true)}><Icon name="eye" size={16} /> <U k="common.showAnswer" stack={false} /></button>
        )}
        <span className="grow" />
        {!done ? (
          <button ref={checkBtn} type="button" className="btn btn-primary btn-lg" onClick={check} disabled={!canCheck || phase === 'checking'}>
            {phase === 'checking' ? <span className="spinner light" /> : <Icon name={checkLabel === 'task.sendPrompt' ? 'send' : 'check'} size={18} />}
            <U k={checkLabel || 'common.check'} stack={false} />
          </button>
        ) : onContinue ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={onContinue} autoFocus>
            <U k={continueLabel || 'common.continue'} stack={false} /> <Icon name="chevronRight" size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
