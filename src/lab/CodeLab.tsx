// Editor + browser + report: the place where tests are run step by step.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CodeEditor } from '../editor/CodeEditor';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { U, useUiString } from '../components/Bi';
import { BrowserFrame } from './BrowserFrame';
import { TestReport } from './TestReport';
import { useRunner, type RunArgs } from './useRunner';
import { SPEC_FILE, type AppSetup, type RunResult } from '../emulator';
import { useSettings } from '../store/settings';

const SPEC_NAME = SPEC_FILE;

export interface CodeLabProps {
  code: string;
  onCode?: (code: string) => void;
  readOnly?: boolean;
  app?: AppSetup;
  files?: Record<string, string>;
  /** editing of the extra files (page objects, fixtures); without it they are read-only */
  onFiles?: (files: Record<string, string>) => void;
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
  /** show a "Run ×N" button: runs the test N times in a row (flaky tests) */
  repeat?: number;
}

export interface LabHandle {
  run: (args?: Partial<RunArgs>) => Promise<RunResult>;
}

/** Read-only list of extra files shown above a snippet (e.g. a page object the test imports). */
export function FilesView({ files }: { files?: Record<string, string> }) {
  if (!files || !Object.keys(files).length) return null;
  return (
    <div className="files-view">
      {Object.entries(files).map(([name, src]) => (
        <details key={name} className="file-block" open>
          <summary><Icon name="code" size={14} /> {name}</summary>
          <CodeView code={src} />
        </details>
      ))}
    </div>
  );
}

export function CodeLab({ code, onCode, readOnly, app, files, onFiles, mode = 'spec', onResult, onReset, actions, hideRun, browserHeight = 420, labRef, layout = 'split', repeat }: CodeLabProps) {
  const [reps, setReps] = useState<('passed' | 'failed')[] | null>(null);
  const [repBusy, setRepBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [file, setFile] = useState<string>(SPEC_NAME);
  const fileNames = files ? Object.keys(files) : [];
  const onSpec = file === SPEC_NAME || !files || !(file in files);
  const { live, run, stop, next, setStepMode } = useRunner(frame);
  const [tab, setTab] = useState<'code' | 'browser' | 'report'>('code');
  const [jump, setJump] = useState<number | null>(null);
  const s = useUiString();
  const speed = useSettings((x) => x.speed);
  const update = useSettings((x) => x.update);

  const runRepeat = async () => {
    if (!repeat) return;
    setRepBusy(true);
    const out: ('passed' | 'failed')[] = [];
    setReps([]);
    for (let i = 0; i < repeat; i++) {
      const r = await run({ code, app, files, mode, fast: true, silent: i < repeat - 1 });
      if (r.status === 'aborted') break;
      out.push(r.status === 'passed' ? 'passed' : 'failed');
      setReps([...out]);
    }
    setRepBusy(false);
  };

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

  const errInfo = live.result?.error ?? live.result?.tests.find((t) => t.error)?.error;
  const errLine = errInfo && (!errInfo.file || errInfo.file === SPEC_NAME) ? errInfo.line ?? null : null;

  const fileTabs = fileNames.length > 0 && (
    <div className="file-tabs" role="tablist">
      {[SPEC_NAME, ...fileNames].map((f) => (
        <button key={f} type="button" role="tab" aria-selected={file === f} className={file === f ? 'active' : ''} onClick={() => setFile(f)}>{f}</button>
      ))}
    </div>
  );
  const otherReadOnly = readOnly || !onFiles;
  const editor = !onSpec ? (
    otherReadOnly
      ? <CodeView key={file} code={files![file]} className="lab-codeview" />
      : <CodeEditor key={file} value={files![file]} onChange={(v) => onFiles!({ ...files!, [file]: v })} minHeight={240} />
  ) : readOnly ? (
    <CodeView code={code} runLine={live.running ? live.runLine : jump} errorLine={!live.running ? errLine : null} className="lab-codeview" />
  ) : (
    <CodeEditor key={SPEC_NAME} value={code} onChange={onCode} runLine={live.running ? live.runLine : jump} errorLine={!live.running ? errLine : null} minHeight={240} />
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
      {repeat && !live.running && (
        <button className="btn btn-soft" onClick={runRepeat} disabled={repBusy}><Icon name="repeat" size={16} /> <U k="task.runRepeat" vars={{ n: repeat }} stack={false} /></button>
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
        {reps && (
          <div className="repeat-strip" aria-live="polite">
            {reps.map((r, i) => <span key={i} className={`rep rep-${r}`}>{r === 'passed' ? '✓' : '✗'}</span>)}
            {repBusy && <span className="spinner" />}
            {!repBusy && <span className="muted small">{reps.filter((r) => r === 'passed').length}/{reps.length} <U k="report.passed" stack={false} /></span>}
          </div>
        )}
        {fileTabs}
        <div className="lab-editor" onClick={() => setJump(null)}>{editor}</div>
      </div>
      <div className="lab-side">
        <div className="lab-browser">
          <BrowserFrame ref={frame} url={live.url} height={browserHeight} busy={live.running} />
        </div>
        <div className="lab-report">
          <TestReport live={live} code={code} onLine={(n) => { setJump(n); setFile(SPEC_NAME); setTab('code'); }} />
        </div>
      </div>
    </div>
  );
}
