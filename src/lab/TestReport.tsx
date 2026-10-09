// Playwright-style report: summary, steps, error with code frame, mentor explanation, lint notes.
import { useState } from 'react';
import type { ErrorInfo, RunResult, StaticFinding, StepRecord, TestResult } from '../emulator';
import { errorTexts } from '../content';
import { Bi, BiInline, U, useLang } from '../components/Bi';
import { Icon } from '../components/Icon';
import { closestMethod } from '../editor/completions';
import { applyGender, interpolate } from '../lib/text';
import type { LiveState } from './useRunner';

function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ErrorExplain({ error }: { error: ErrorInfo }) {
  const { gender } = useLang();
  const entry = errorTexts.errors[error.code] ?? errorTexts.errors.unknown;
  const vars: Record<string, string | number> = { ...error.data, line: error.line ?? error.data.line ?? '?' };
  let sugEn = '';
  let sugRu = '';
  if (error.code === 'not-a-function') {
    const s = closestMethod(String(error.data.method || ''));
    if (s && s !== error.data.method) {
      sugEn = ` Did you mean \`${s}\`?`;
      sugRu = ` Возможно, \`${s}\`?`;
    }
  }
  const en = interpolate(entry.explain.en, { ...vars, suggestion: sugEn });
  const ru = interpolate(applyGender(entry.explain.ru, gender), { ...vars, suggestion: sugRu });
  return (
    <div className="err-explain">
      <div className="err-explain-head">
        <Icon name="bulb" size={18} />
        <BiInline t={entry.title} vars={vars} className="err-title" />
        {error.emulatorNote && <span className="chip chip-sky"><U k="report.emulatorNote" stack={false} /></span>}
      </div>
      <Bi t={{ en, ru }} />
    </div>
  );
}

export function CodeFrame({ code, line }: { code: string; line: number }) {
  const lines = code.replace(/\n$/, '').split('\n');
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 2);
  const width = String(to).length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${i === line ? '>' : ' '} ${String(i).padStart(width)} | ${lines[i - 1] ?? ''}`);
  return <pre className="code-frame">{out.join('\n')}</pre>;
}

function StepTree({ steps, onLine, depth = 0 }: { steps: StepRecord[]; onLine?: (n: number) => void; depth?: number }) {
  return (
    <ul className="steps" style={{ marginLeft: depth ? 14 : 0 }}>
      {steps.map((s) => (
        <li key={s.id} className={`step step-${s.status}`}>
          <div className="step-row">
            <span className="step-icon">{s.status === 'passed' ? <Icon name="check" size={14} /> : s.status === 'failed' ? <Icon name="x" size={14} /> : <span className="spinner-dot" />}</span>
            <span className="step-name">{s.title}</span>
            {s.line && (
              <button type="button" className="step-line" onClick={() => onLine?.(s.line!)} title={s.file || 'example.spec.js'}>
                {s.file ? `${s.file.split('/').pop()}:` : ''}{s.line}
              </button>
            )}
            <span className="step-dur">{fmtMs(s.duration)}</span>
          </div>
          {s.children.length > 0 && <StepTree steps={s.children} onLine={onLine} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function TestBlock({ t, code, onLine, open: initiallyOpen }: { t: TestResult; code: string; onLine?: (n: number) => void; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const ok = t.status === 'passed';
  const icon = ok ? 'check' : t.status === 'skipped' ? 'chevronRight' : 'x';
  return (
    <div className={`report-test report-${t.status}`}>
      <button type="button" className="report-test-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="report-status-icon"><Icon name={icon} size={16} strokeWidth={2.4} /></span>
        <span className="report-test-title">{t.titlePath.join(' › ')}</span>
        <span className="report-dur">{fmtMs(t.duration)}</span>
        <Icon name="chevronDown" size={16} className={open ? 'rot180' : ''} />
      </button>
      {open && (
        <div className="report-test-body">
          {t.steps.length > 0 && <StepTree steps={t.steps} onLine={onLine} />}
          {t.error && <ErrorBlock error={t.error} code={code} />}
          {t.softErrors.slice(t.error ? 1 : 0).map((e, i) => <ErrorBlock key={i} error={e} code={code} />)}
          {t.logs.length > 0 && (
            <div className="report-console">
              <div className="report-sub"><Icon name="terminal" size={14} /> <U k="report.console" stack={false} /></div>
              <pre>{t.logs.join('\n')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ErrorBlock({ error, code }: { error: ErrorInfo; code: string }) {
  return (
    <div className="report-error">
      <pre className="report-error-msg">{error.message}</pre>
      {error.line && (!error.file || error.file === 'example.spec.js') && <CodeFrame code={code} line={error.line} />}
      {error.file && error.file !== 'example.spec.js' && <div className="report-file">at {error.file}:{error.line}</div>}
      <ErrorExplain error={error} />
    </div>
  );
}

export function Findings({ findings }: { findings: StaticFinding[] }) {
  const { gender } = useLang();
  if (!findings.length) return null;
  return (
    <div className="report-notes">
      <div className="report-sub"><Icon name="eye" size={14} /> <U k="report.notes" stack={false} /></div>
      <ul>
        {findings.map((f, i) => {
          const t = errorTexts.lint[f.rule];
          if (!t) return null;
          const vars = { ...(f.data || {}), line: f.line ?? '?' };
          return <li key={i}><Bi t={{ en: interpolate(t.en, vars), ru: interpolate(applyGender(t.ru, gender), vars) }} size="sm" /></li>;
        })}
      </ul>
    </div>
  );
}

export function TestReport({ live, code, onLine, compact }: { live: LiveState; code: string; onLine?: (n: number) => void; compact?: boolean }) {
  const r: RunResult | null = live.result;
  if (live.running) {
    return (
      <div className="report report-live" aria-live="polite">
        <div className="report-head">
          <span className="spinner" />
          <span><U k="report.running" stack={false} />{live.testTitle ? ` · ${live.testTitle}` : ''}{live.testTotal && live.testTotal > 1 ? ` (${(live.testIndex ?? 0) + 1}/${live.testTotal})` : ''}</span>
        </div>
        {live.paused && (
          <div className="report-paused"><Icon name="pause" size={14} /> <U k="report.paused" stack={false} />: <code>{live.paused.title}</code></div>
        )}
        <StepTree steps={live.steps.filter((s) => s.category !== 'fixture')} onLine={onLine} />
      </div>
    );
  }
  if (!r) return <div className="report report-empty"><Icon name="play" size={18} /> <U k="report.noRun" /></div>;
  const passed = r.tests.filter((t) => t.status === 'passed').length;
  const failed = r.tests.filter((t) => t.status === 'failed' || t.status === 'timedOut').length;
  const skipped = r.tests.filter((t) => t.status === 'skipped').length;
  return (
    <div className={`report report-done ${compact ? 'report-compact' : ''}`} aria-live="polite">
      <div className={`report-head report-head-${r.status}`}>
        {r.mode === 'script' ? (
          <span className="report-summary"><Icon name="terminal" size={16} /> <U k="report.output" stack={false} /></span>
        ) : r.status === 'error' ? (
          <span className="report-summary fail"><Icon name="x" size={16} strokeWidth={2.4} /> <U k="report.error" stack={false} /></span>
        ) : (
          <span className="report-summary">
            {passed > 0 && <span className="pass"><Icon name="check" size={16} strokeWidth={2.4} /> {passed} <U k="report.passed" stack={false} /></span>}
            {failed > 0 && <span className="fail"><Icon name="x" size={16} strokeWidth={2.4} /> {failed} <U k="report.failed" stack={false} /></span>}
            {skipped > 0 && <span className="skip">{skipped} <U k="report.skipped" stack={false} /></span>}
          </span>
        )}
        <span className="report-dur">{fmtMs(r.duration)}</span>
      </div>
      {r.error && <ErrorBlock error={r.error} code={code} />}
      {r.mode === 'script' ? (
        <pre className="report-console-out">{r.logs.join('\n') || '—'}</pre>
      ) : (
        r.tests.map((t, i) => <TestBlock key={i} t={t} code={code} onLine={onLine} open={t.status !== 'passed' || r.tests.length === 1} />)
      )}
      <Findings findings={r.findings} />
    </div>
  );
}
