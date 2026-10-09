import { useState, type ReactNode } from 'react';
import type { Task } from '../content/schema';
import { Icon } from '../components/Icon';
import { U } from '../components/Bi';
import { TaskShell, type ShellMode, type TaskOutcome } from '../tasks/TaskShell';

/** Runs tasks one after another and reports all outcomes at the end. */
export function TaskSequence({ tasks, mode, title, onFinish, onExit, bonusXp = 0, intro }: {
  tasks: Task[];
  mode: ShellMode;
  title: ReactNode;
  onFinish: (outcomes: TaskOutcome[]) => void;
  onExit: () => void;
  bonusXp?: number;
  intro?: ReactNode;
}) {
  const [i, setI] = useState(0);
  const [outcomes, setOutcomes] = useState<TaskOutcome[]>([]);
  const [started, setStarted] = useState(!intro);
  const task = tasks[i];
  const wide = !task ? '' : ['fix', 'find-bug', 'code'].includes(task.kind) ? 'lesson-wide' : ['predict', 'agent'].includes(task.kind) ? 'lesson-mid' : '';

  if (!started) {
    return (
      <div className="page page-narrow">
        {intro}
        <div className="row center"><button className="btn btn-primary btn-lg" onClick={() => setStarted(true)}><U k="common.letsGo" stack={false} /> <Icon name="chevronRight" size={18} /></button></div>
      </div>
    );
  }
  if (!task) return null;
  return (
    <div className={`page lesson ${wide}`}>
      <div className="lesson-top">
        <button className="icon-btn" onClick={onExit} aria-label="exit"><Icon name="x" /></button>
        <div className="lesson-progress">
          {tasks.map((_, k) => <span key={k} className={`seg ${k < i ? (outcomes[k]?.correct ? 'done' : 'missed') : k === i ? 'current' : ''}`} />)}
        </div>
        <span className="lesson-count">{i + 1}/{tasks.length}</span>
      </div>
      <div className="lesson-title-row"><span className="lesson-title">{title}</span></div>
      <div className="lesson-step" key={task.id + i}>
        <TaskShell
          task={task}
          mode={mode}
          bonusXp={bonusXp}
          onDone={(o) => setOutcomes((arr) => { const n = [...arr]; n[i] = o; return n; })}
          onContinue={() => {
            if (i + 1 < tasks.length) setI(i + 1);
            else onFinish(outcomes);
          }}
        />
      </div>
    </div>
  );
}
