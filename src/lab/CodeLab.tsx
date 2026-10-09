// Editor + browser + report: the place where tests are run step by step.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CodeEditor } from '../editor/CodeEditor';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { U, useUiString } from '../components/Bi';
import { BrowserFrame } from './BrowserFrame';
import { TestReport } from './TestReport';
import { useRunner, type RunArgs } from './useRunner';
import type { AppSetup, RunResult } from '../emulator';
import { useSettings } from '../store/settings';

export interface CodeLabProps {
  code: string;
  onCode?: (code: string) => void;
  readOnly?: boolean;
  app?: AppSetup;
  files?: Record<string, string>;
  mode?: 'spec' | 'script';
  onResult?: (r: RunResult) => void;
  onReset?: () => void;
  /** extra buttons in the toolbar (e.g. "Check my solution") */
  actions?: ReactNode;
  /** hide the run button (when the parent drives runs via ref) */
  hideRun?: boolean;
  browserHeight?: number;
  labRef?: React.MutableRefObject<LabHandle | null>;
  layout?: 'split' | 'stack';
}

export interface LabHandle {
  run: (args?: Partial<RunArgs>) => Promise<RunResult>;
}

export function CodeLab({ code, onCode, readOnly, app, files, mode = 'spec', onResult, onReset, actions, hideRun, browserHeight = 420, labRef, layout = 'split' }: CodeLabProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { live, run, stop, next, setStepMode } = useRunner(frame);
  const [tab, setTab] = useState<'code' | 'browser' | 'report'>('code');
  const [jump, setJump] = useState<number | null>(null);
  const s = useUiString();
  const speed = useSettings((x) => x.speed);
  const update = useSettings((x) => x.update);

  const doRun = async (extra: Partial<RunArgs> = {}) => {
    if (window.innerWidth < 900) setTab('browser');
    const r = await run({ code, app, files, mode, ...extra });
    if (window.innerWidth < 900 && !extra.silent) setTab('report');
    if (!extra.silent) onResult?.(r);
    return r;
  };

  useEffect(() => {
    if (labRef) labRef.current = { run: doRun };
  });

  const errLine = live.result?.error?.line ?? live.result?.tests.find((t) => t.error)?.error?.line ?? null;

  const editor = readOnly ? (
    <CodeView code={code} runLine={live.running ? live.runLine : jump} errorLine={!live.running ? errLine : null} className="lab-codeview" />
  ) : (
    <CodeEditor value={code} onChange={onCode} runLine={live.running ? live.runLine : jump} errorLine={!live.running ? errLine : null} minHeight={240} />
  );

  const toolbar = (
    <div className="lab-toolbar">
      {!hideRun && (live.running ? (
        <button className="btn btn-soft" onClick={stop}><Icon name="stop" size={16} /> <U k="task.stop" stack={false} /></button>
      ) : (
        <button className="btn btn-primary" onClick={() => doRun()}><Icon name="play" size={16} /> <U k="task.run" stack={false} /></button>
      ))}
      {live.running && live.paused && (
        <button className="btn btn-rose" onClick={next}><Icon name="stepFwd" size={16} /> <U k="task.nextStep" stack={false} /></button>
      )}
      {mode === 'spec' && (
        <label className="toggle" title={s('task.stepMode')}>
          <input type="checkbox" checked={live.stepMode} onChange={(e) => setStepMode(e.target.checked)} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <U k="task.stepMode" stack={false} />
        </label>
      )}
      {mode === 'spec' && (
        <label className="speed" title={s('task.speed')}>
          <Icon name="clock" size={15} />
          <input type="range" min={0} max={1000} step={50} value={1000 - speed} onChange={(e) => update({ speed: 1000 - Number(e.target.value) })} aria-label={s('task.speed')} />
        </label>
      )}
      <span className="grow" />
      {onReset && !readOnly && (
        <button className="btn btn-ghost btn-sm" onClick={onReset} title={s('task.resetCode')}><Icon name="reset" size={15} /> <span className="hide-sm"><U k="task.resetCode" stack={false} /></span></button>
      )}
      {actions}
    </div>
  );

  return (
    <div className={`lab lab-${layout} lab-tab-${tab}`}>
      <div className="lab-tabs" role="tablist">
        {(['code', 'browser', 'report'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            <U k={`browser.tab${k[0].toUpperCase()}${k.slice(1)}`} stack={false} />
            {k === 'report' && live.result && <span className={`dot dot-${live.result.status}`} />}
          </button>
        ))}
      </div>
      <div className="lab-code">
        {toolbar}
        <div className="lab-editor" onClick={() => setJump(null)}>{editor}</div>
      </div>
      <div className="lab-side">
        <div className="lab-browser">
          <BrowserFrame ref={frame} url={live.url} height={browserHeight} busy={live.running} />
        </div>
        <div className="lab-report">
          <TestReport live={live} code={code} onLine={(n) => { setJump(n); setTab('code'); }} />
        </div>
      </div>
    </div>
  );
}
