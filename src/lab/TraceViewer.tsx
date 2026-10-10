// A simplified Playwright trace viewer: runs the test once while recording DOM snapshots
// before and after every action, then lets you walk through the actions.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppConfig, Files } from '../content/schema';
import { BiInline, U } from '../components/Bi';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { RunController, runSpec, type RunResult, type StepRecord, type TestResult } from '../emulator';
import { AUT_DIR } from './useRunner';
import { ErrorBlock } from './TestReport';

interface Snap { html: string; url: string }
export interface TraceEntry {
  id: number;
  title: string;
  category: StepRecord['category'];
  line?: number;
  file?: string;
  depth: number;
  status: StepRecord['status'];
  duration: number;
  error?: string;
  before?: Snap;
  after?: Snap;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function captureDoc(frame: HTMLIFrameElement | null, url: string): Snap | undefined {
  let doc: Document | null = null;
  try { doc = frame?.contentDocument ?? null; } catch { doc = null; }
  if (!doc || !doc.body || url === 'about:blank') return undefined;
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;
  // keep what the user typed / ticked: values live in properties, not in attributes
  const live = doc.querySelectorAll('input, textarea, select');
  const copies = clone.querySelectorAll('input, textarea, select');
  live.forEach((el, i) => {
    const c = copies[i];
    if (!c) return;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
      else c.setAttribute('value', el.value);
    } else if (el instanceof HTMLTextAreaElement) c.textContent = el.value;
    else if (el instanceof HTMLSelectElement) {
      Array.from(c.querySelectorAll('option')).forEach((o, k) => { if (k === el.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    }
  });
  clone.querySelectorAll('script, [data-emulator-overlay], [data-preview-outline], [data-inspector-overlay]').forEach((n) => n.remove());
  const head = clone.querySelector('head');
  const base = new URL(AUT_DIR, window.location.href).href;
  head?.insertAdjacentHTML('afterbegin', `<base href="${base}"><style>[data-trace-target]{outline:3px solid #d9668f!important;outline-offset:2px;box-shadow:0 0 0 6px rgba(217,102,143,.22)!important;border-radius:4px}html{pointer-events:none}</style>`);
  return { html: `<!doctype html>${clone.outerHTML}`, url };
}

function flatten(steps: StepRecord[], snaps: Map<number, { before?: Snap; after?: Snap }>, depth = 0, out: TraceEntry[] = []): TraceEntry[] {
  for (const s of steps) {
    if (s.category === 'fixture') continue;
    const sn = snaps.get(s.id) || {};
    out.push({ id: s.id, title: s.title, category: s.category, line: s.line, file: s.file, depth, status: s.status, duration: s.duration, error: s.error, before: sn.before, after: sn.after });
    flatten(s.children, snaps, depth + 1, out);
  }
  return out;
}

function Snapshot({ snap }: { snap?: Snap }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const onLoad = () => {
      try { f.contentDocument?.querySelector('[data-trace-target]')?.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }
    };
    f.addEventListener('load', onLoad);
    return () => f.removeEventListener('load', onLoad);
  }, []);
  if (!snap) return <div className="trace-nosnap"><Icon name="globe" size={22} /> <BiInline t={{ en: 'No page yet at this moment', ru: 'В этот момент страницы ещё нет' }} /></div>;
  return (
    <div className="trace-snap">
      <div className="browser-url trace-url"><Icon name="lock" size={13} /> <span>{snap.url}</span></div>
      <iframe ref={ref} title="snapshot" srcDoc={snap.html} sandbox="allow-same-origin" />
    </div>
  );
}

export interface TraceViewerProps {
  code: string;
  app?: AppConfig;
  files?: Files;
  /** task mode: no step preselected, selection reported to the parent */
  onSelect?: (e: TraceEntry | null) => void;
  onResult?: (r: RunResult) => void;
  selectLine?: number | null;
  locked?: boolean;
  autoRun?: boolean;
  taskMode?: boolean;
}

export function TraceViewer({ code, app, files, onSelect, onResult, selectLine, locked, autoRun = true, taskMode }: TraceViewerProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [traces, setTraces] = useState<{ test: TestResult; entries: TraceEntry[] }[]>([]);
  const [testIdx, setTestIdx] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const [moment, setMoment] = useState<'before' | 'after'>('after');
  const [tab, setTab] = useState<'call' | 'error' | 'console' | 'source'>('call');
  const started = useRef(false);

  const record = async () => {
    setBusy(true);
    setSel(null);
    onSelect?.(null);
    const snaps = new Map<number, { before?: Snap; after?: Snap }>();
    let url = 'about:blank';
    let last: number | null = null;
    const get = (id: number) => { if (!snaps.has(id)) snaps.set(id, {}); return snaps.get(id)!; };
    const ctl = new RunController({ speed: 0, stepMode: false }, (e) => {
      if (e.type === 'navigate') url = e.url;
      else if (e.type === 'step-start') {
        if (e.step.category === 'pw:api' || e.step.category === 'expect') { last = e.step.id; get(e.step.id).before = captureDoc(frame.current, url); }
      } else if (e.type === 'highlight') {
        if (last !== null) get(last).before = captureDoc(frame.current, url);
      } else if (e.type === 'step-end') {
        if (e.step.category === 'pw:api' || e.step.category === 'expect') {
          get(e.step.id).after = captureDoc(frame.current, url);
          try { frame.current?.contentDocument?.querySelectorAll('[data-trace-target]').forEach((n) => n.removeAttribute('data-trace-target')); } catch { /* ignore */ }
        }
      }
    });
    ctl.trace = true;
    const r = await runSpec({ code, files, app, frame: frame.current, controller: ctl, autDir: AUT_DIR, onUrl: (u) => { url = u; } });
    const t = r.tests.map((test) => ({ test, entries: flatten(test.steps, snaps) }));
    setTraces(t);
    const firstFailed = Math.max(0, r.tests.findIndex((x) => x.status === 'failed' || x.status === 'timedOut'));
    setTestIdx(firstFailed);
    if (!taskMode) {
      const entries = t[firstFailed]?.entries || [];
      const failed = entries.filter((e) => e.status === 'failed' && (e.category === 'pw:api' || e.category === 'expect'));
      setSel(failed.length ? failed[failed.length - 1].id : entries[entries.length - 1]?.id ?? null);
      if (failed.length) setTab('error');
    }
    setResult(r);
    onResult?.(r);
    setBusy(false);
  };

  useEffect(() => {
    if (autoRun && !started.current) { started.current = true; setTimeout(record, 200); }
  }, []);

  const cur = traces[testIdx];
  const entries = cur?.entries || [];
  const entry = entries.find((e) => e.id === sel) || null;

  useEffect(() => {
    if (selectLine == null || !entries.length) return;
    const e = entries.find((x) => x.line === selectLine && !x.file);
    if (e) setSel(e.id);
  }, [selectLine, entries.length]);

  const choose = (e: TraceEntry) => {
    if (locked) return;
    setSel(e.id);
    onSelect?.(e);
  };

  const snap = entry ? (moment === 'before' ? entry.before ?? entry.after : entry.after ?? entry.before) : undefined;
  const srcLine = entry && !entry.file ? entry.line : undefined;
  const status = result ? (result.status === 'passed' ? 'passed' : result.status === 'error' ? 'error' : 'failed') : null;
  const testError = cur?.test.error;
  const softErrors = cur?.test.softErrors || [];
  const tabs = useMemo(() => ['call', 'error', 'console', 'source'] as const, []);

  return (
    <div className="trace">
      <div className="trace-top">
        <span className="trace-brand"><Icon name="clock" size={15} /> Trace viewer</span>
        {status && <span className={`chip ${status === 'passed' ? 'chip-mint' : 'chip-coral'}`}>{status === 'passed' ? '✓ passed' : status === 'error' ? '✗ error' : '✗ failed'} · {fmtMs(result!.duration)}</span>}
        <span className="grow" />
        <button type="button" className="btn btn-soft btn-sm" onClick={record} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="reset" size={14} />} <BiInline t={busy ? { en: 'Recording…', ru: 'Запись…' } : { en: 'Record again', ru: 'Записать заново' }} stack={false} />
        </button>
      </div>
      {traces.length > 1 && (
        <div className="trace-tests">
          {traces.map((t, i) => (
            <button key={i} type="button" className={`chip-btn ${i === testIdx ? 'on' : ''}`} onClick={() => { setTestIdx(i); setSel(null); }}>
              {t.test.status === 'passed' ? '✓' : '✗'} {t.test.title}
            </button>
          ))}
        </div>
      )}
      <div className="trace-main">
        <div className="trace-actions">
          <div className="trace-sub"><BiInline t={{ en: 'Actions', ru: 'Действия' }} stack={false} /></div>
          {busy && <div className="trace-row muted"><span className="spinner" /></div>}
          {!busy && entries.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`trace-row cat-${e.category.replace(/[^a-z]/g, '')} ${e.status} ${e.id === sel ? 'sel' : ''}`}
              style={{ paddingLeft: 8 + e.depth * 14 }}
              onClick={() => choose(e)}
              disabled={locked && e.id !== sel}
            >
              <span className="trace-ico">{e.status === 'failed' ? <Icon name="x" size={13} strokeWidth={2.6} /> : <Icon name="check" size={13} strokeWidth={2.6} />}</span>
              <span className="trace-title">{e.title}</span>
              {e.line && !e.file && <span className="trace-line">:{e.line}</span>}
              <span className="trace-dur">{fmtMs(e.duration)}</span>
            </button>
          ))}
        </div>
        <div className="trace-view">
          <div className="trace-moments" role="tablist">
            {(['before', 'after'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={moment === m} className={moment === m ? 'active' : ''} onClick={() => setMoment(m)}>
                {m === 'before' ? 'Before' : 'After'}
              </button>
            ))}
          </div>
          {entry ? <Snapshot key={`${entry.id}-${moment}`} snap={snap} /> : <div className="trace-nosnap"><Icon name="target" size={20} /> <BiInline t={{ en: 'Select an action on the left', ru: 'Выбери действие слева' }} /></div>}
        </div>
      </div>
      <div className="trace-bottom">
        <div className="trace-tabs" role="tablist">
          {tabs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {k === 'call' ? 'Call' : k === 'error' ? 'Errors' : k === 'console' ? 'Console' : 'Source'}
              {k === 'error' && (testError || softErrors.length > 0) && <span className="dot dot-failed" />}
            </button>
          ))}
        </div>
        <div className="trace-panel">
          {tab === 'call' && (entry ? (
            <dl className="trace-call">
              <dt>action</dt><dd><code>{entry.title}</code></dd>
              {entry.line && <><dt>source</dt><dd><code>{entry.file || 'example.spec.js'}:{entry.line}</code></dd></>}
              <dt>duration</dt><dd>{fmtMs(entry.duration)}</dd>
              <dt>status</dt><dd className={entry.status}>{entry.status}</dd>
              {entry.error && <><dt>error</dt><dd><code className="trace-err">{entry.error}</code></dd></>}
            </dl>
          ) : <span className="muted"><U k="report.noRun" stack={false} /></span>)}
          {tab === 'error' && (testError ? <ErrorBlock error={testError} code={code} /> : softErrors.length ? softErrors.map((e, i) => <ErrorBlock key={i} error={e} code={code} />) : <span className="muted">—</span>)}
          {tab === 'console' && <pre className="trace-console">{cur?.test.logs.join('\n') || '—'}</pre>}
          {tab === 'source' && <CodeView code={code} highlight={srcLine ? [srcLine] : []} />}
        </div>
      </div>
      <div className="trace-hidden-browser" aria-hidden="true">
        <iframe ref={frame} title="trace recorder" src="about:blank" tabIndex={-1} />
      </div>
    </div>
  );
}
