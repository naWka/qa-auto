import { useEffect, useRef, useState } from 'react';
import type { Task } from '../content/schema';
import { Bi, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { CodeLab, type LabHandle } from '../lab/CodeLab';
import type { AppSetup, RunResult } from '../emulator';
import { useProgress } from '../store/progress';
import { gradeCode, type CodeVerdict } from './gradeCode';
import type { KindProps } from './types';

type CodeT = Extract<Task, { kind: 'fix' | 'find-bug' | 'code' }>;

export function CodeTask({ task, register, phase }: KindProps<CodeT>) {
  const [code, setCode] = useState(task.starter);
  const [files, setFiles] = useState(task.files);
  const [verdict, setVerdict] = useState<CodeVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const lab = useRef<LabHandle | null>(null);
  const red = useRef(false);
  const bump = useProgress((s) => s.bumpStat);
  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final';

  useEffect(() => {
    register({
      canCheck: !busy && code.trim().length > 0,
      checkLabel: 'task.submitSolution',
      check: async () => {
        setBusy(true);
        const run = (c: string, app: AppSetup | undefined, silent: boolean) => lab.current!.run({ code: c, app, files, silent, fast: silent });
        const v = await gradeCode(code, task.checks, task.app, run);
        setVerdict(v);
        setBusy(false);
        if (v.ok) {
          if (task.kind === 'find-bug') bump('bugsFound');
          if (v.fragileFree && /getBy(Role|Label|Text|TestId|Placeholder)/.test(code)) bump('noFragile');
        }
        return { correct: v.ok, hadRedRun: red.current };
      },
      reveal: () => { setCode(task.solution); setFiles(task.solutionFiles ?? task.files); setVerdict(null); },
    });
  });

  const onResult = (r: RunResult) => { if (r.status !== 'passed') red.current = true; };

  return (
    <div className="task-code">
      {task.kind === 'find-bug' && <div className="goal-banner find-bug"><Icon name="bug" size={16} /> <U k="task.findBugGoal" stack={false} /></div>}
      {task.kind === 'fix' && <div className="goal-banner fix"><Icon name="target" size={16} /> <U k="task.fixGoal" stack={false} /></div>}
      <CodeLab
        code={code}
        onCode={(c) => { setCode(c); setVerdict(null); }}
        readOnly={locked && phase !== 'correct'}
        app={task.app}
        files={files}
        onFiles={(f) => { setFiles(f); setVerdict(null); }}
        labRef={lab}
        repeat={task.checks.repeat}
        onResult={onResult}
        onReset={() => { setCode(task.starter); setFiles(task.files); setVerdict(null); }}
      />
      {verdict && (
        <div className={`verdict ${verdict.ok ? 'ok' : 'bad'}`}>
          {task.kind === 'find-bug' && verdict.main && (
            <div className="verdict-runs">
              <span className={`chip ${verdict.main.status === 'failed' ? 'chip-mint' : 'chip-coral'}`}><Icon name="bug" size={13} /> <U k="task.runOnBuggy" stack={false} />: {verdict.main.status === 'passed' ? '✓ pass' : '✗ fail'}</span>
              {verdict.also.map((a, i) => (
                <span key={i} className={`chip ${a.ok ? 'chip-mint' : 'chip-coral'}`}><Icon name={a.expect === 'pass' ? 'shield' : 'bug'} size={13} /> <U k={a.expect === 'pass' ? 'task.runOnFixed' : 'task.runOnOther'} stack={false} />: {a.result.status === 'passed' ? '✓ pass' : '✗ fail'}</span>
              ))}
            </div>
          )}
          {verdict.repeats && (
            <div className="repeat-strip" aria-label="repeated runs">
              {verdict.repeats.map((r, i) => <span key={i} className={`rep rep-${r}`}>{r === 'passed' ? '✓' : '✗'}</span>)}
              <span className="muted small">{verdict.repeats.length}/{task.checks.repeat}</span>
            </div>
          )}
          {verdict.ok && task.kind === 'find-bug' && <Bi t={{ en: 'Bug caught: red on the buggy app, green on the fixed one.', ru: 'Баг пойман: красный на версии с багом, зелёный на исправленной.' }} size="sm" />}
          {!verdict.ok && <ul>{verdict.problems.map((p, i) => <li key={i}><Bi t={p} size="sm" /></li>)}</ul>}
        </div>
      )}
    </div>
  );
}
