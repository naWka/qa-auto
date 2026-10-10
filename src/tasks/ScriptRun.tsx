import { useState } from 'react';
import { RunController, runSpec, type RunResult } from '../emulator';
import { AUT_DIR } from '../lab/useRunner';
import { Icon } from '../components/Icon';
import { U } from '../components/Bi';
import { ErrorBlock } from '../lab/TestReport';

/** Runs plain Python (no browser) and shows print() output — for "what will it print" tasks. */
export function ScriptRun({ code }: { code: string }) {
  const [res, setRes] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await runSpec({ code, mode: 'script', frame: null, controller: new RunController({ speed: 0, stepMode: false }), autDir: AUT_DIR });
    setRes(r);
    setBusy(false);
  };
  return (
    <div className="script-run">
      <button className="btn btn-soft btn-sm" onClick={go} disabled={busy}><Icon name="play" size={15} /> <U k="task.run" stack={false} /></button>
      {res && (
        <div className="script-out">
          <div className="report-sub"><Icon name="terminal" size={14} /> print()</div>
          <pre>{res.logs.join('\n') || '—'}</pre>
          {res.error && <ErrorBlock error={res.error} code={code} />}
        </div>
      )}
    </div>
  );
}
