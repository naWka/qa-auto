// Dev page: runs every reference solution / prediction / best agent response through the emulator.
import { useEffect, useRef, useState } from 'react';
import { chapters, loadAllTasks, loadLesson, lessonsOf } from '../content';
import type { Checks, Task } from '../content/schema';
import { RunController, openPreview, runSpec, type AppSetup, type RunResult, type StepRecord } from '../emulator';
import { AUT_DIR } from '../lab/useRunner';
import { gradeCode } from '../tasks/gradeCode';
import { fillCode } from '../tasks/FillTask';

interface Row { id: string; kind: string; status: 'ok' | 'fail' | 'warn' | 'info'; note: string }

declare global {
  interface Window {
    __selftest?: { done: boolean; rows: Row[] };
    /** dev hook for scripts: run a snippet in the emulator and get a compact summary */
    __bloomqa?: { run: (code: string, app?: AppSetup, files?: Record<string, string>) => Promise<unknown> };
  }
}

export function SelfTestPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const run = (code: string, app: AppSetup | undefined, files?: Record<string, string>): Promise<RunResult> =>
    runSpec({ code, app, files, frame: frame.current, controller: new RunController({ speed: 0, stepMode: false }), autDir: AUT_DIR });
  useEffect(() => {
    window.__bloomqa = {
      run: async (code, app, files) => {
        const r = await run(code, app, files);
        const flat = (steps: StepRecord[], d = 0): string[] => steps.flatMap((x) => [`${'  '.repeat(d)}${x.status === 'failed' ? '✗' : '✓'} ${x.title}${x.line ? ` :${x.file ? x.file + ':' : ''}${x.line}` : ''}`, ...flat(x.children, d + 1)]);
        return { status: r.status, error: r.error && `${r.error.code} | ${r.error.message} | line ${r.error.line ?? '?'}`, logs: r.logs, findings: r.findings.map((f) => `${f.rule}@${f.line}`), tests: r.tests.map((t) => ({ id: t.nodeid, status: t.status, label: t.label, error: t.error && `${t.error.code} | ${t.error.message} | line ${t.error.line ?? '?'}${t.error.file ? ' in ' + t.error.file : ''}`, steps: flat(t.steps) })) };
      },
    };
  }, []);
  const lines = (steps: StepRecord[]): number[] => steps.flatMap((s) => [...(s.line && !s.file ? [s.line] : []), ...lines(s.children)]);

  const go = async () => {
    setBusy(true);
    const out: Row[] = [];
    window.__selftest = { done: false, rows: out };
    const push = (r: Row) => { out.push(r); setRows([...out]); };
    const summarize = (r: RunResult) => r.status === 'error' ? `error: ${r.error?.message.split('\n')[0]}` : r.tests.map((t) => `${t.status}${t.error ? ` (${t.error.code}: ${t.error.message.split('\n')[0].slice(0, 120)})` : ''}`).join('; ');
    const tasks = (await loadAllTasks()).filter((r) => !filter || r.task.id.startsWith(filter));
    for (const { task } of tasks) {
      const t = task as Task;
      const app = (t as { app?: AppSetup }).app;
      try {
        if (t.kind === 'fix' || t.kind === 'find-bug' || t.kind === 'code') {
          const v = await gradeCode(t.solution, t.checks, app, (c, a) => run(c, a, t.solutionFiles ?? t.files));
          push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'solution ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
          if (t.kind !== 'code') {
            const s = await gradeCode(t.starter, t.checks, app, (c, a) => run(c, a, t.files));
            if (s.ok) push({ id: t.id, kind: t.kind, status: 'warn', note: 'starter already satisfies checks' });
          }
        } else if (t.kind === 'predict') {
          const r = await run(t.code, app, t.files);
          const real = r.status === 'passed' ? 'pass' : 'fail';
          push({ id: t.id, kind: t.kind, status: real === t.outcome ? 'ok' : 'fail', note: `expected ${t.outcome}, real ${real} · ${summarize(r)}` });
        } else if (t.kind === 'agent') {
          const best = t.responses.find((x) => x.best)!;
          if (t.checks) {
            const v = await gradeCode(best.code, t.checks as Checks, app, (c, a) => run(c, a, best.files ?? t.files));
            push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'best response ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
          } else {
            const r = await run(best.code, app, best.files ?? t.files);
            push({ id: t.id, kind: t.kind, status: r.status === 'passed' ? 'ok' : 'warn', note: `best: ${summarize(r)}` });
          }
          for (const resp of t.responses.filter((x) => !x.best)) {
            const r = await run(resp.code, app, resp.files ?? t.files);
            if (r.status === 'error') push({ id: t.id, kind: 'agent-alt', status: 'warn', note: `response [${resp.when.join(',')}] has a code error: ${summarize(r)}` });
          }
        } else if (t.kind === 'fill' && t.checks) {
          const code = fillCode(t.code, t.blanks.map((b) => b.answers[0]));
          const v = await gradeCode(code, t.checks, app, (c, a) => run(c, a, t.files));
          push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'filled code ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
        } else if (t.kind === 'parsons' && t.checks && t.code !== false) {
          const v = await gradeCode(t.lines.join('\n'), t.checks, app, (c, a) => run(c, a, t.files));
          push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'assembled ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
        } else if (t.kind === 'pick-locator') {
          const correct = t.options.find((o) => o.correct);
          const text = typeof correct?.text === 'string' ? correct.text.trim().replace(/;$/, '') : '';
          if (text && /^(page\.)?(get_by|locator)/.test(text)) {
            const expr = text.startsWith('page.') ? text : `page.${text}`;
            const code = `from playwright.sync_api import Page, expect\n\n\ndef test_locator(page: Page):\n    page.goto(${JSON.stringify((app as { route?: string } | undefined)?.route || '/')})\n    expect(${expr}).to_have_count(1)\n`;
            const r = await run(code, app);
            push({ id: t.id, kind: t.kind, status: r.status === 'passed' ? 'ok' : 'fail', note: `${expr} → ${summarize(r)}` });
          }
        } else if (t.kind === 'inspect') {
          const doc = await openPreview(frame.current!, AUT_DIR, { ...(app as object), route: (app as { route?: string } | undefined)?.route || '/' });
          await new Promise((r) => setTimeout(r, 700));
          const n = doc ? doc.querySelectorAll(t.target).length : -1;
          push({ id: t.id, kind: t.kind, status: n >= 1 ? 'ok' : 'fail', note: `${t.target} → ${n} element(s)` });
        } else if (t.kind === 'trace') {
          const r = await run(t.code, app, t.files);
          const real = r.status === 'passed' ? 'pass' : 'fail';
          const all = r.tests.flatMap((x) => lines(x.steps));
          const want = Array.isArray(t.answer) ? t.answer : [t.answer];
          const lineOk = want.every((l) => all.includes(l));
          const outOk = !t.outcome || t.outcome === real;
          push({ id: t.id, kind: t.kind, status: lineOk && outOk ? 'ok' : 'fail', note: `answer lines ${want.join(',')} ${lineOk ? 'found' : 'NOT among steps ' + [...new Set(all)].join(',')} · expected ${t.outcome ?? '-'}, real ${real} · ${summarize(r)}` });
        } else if (t.kind === 'input' && t.run === 'script' && t.code) {
          const r = await runSpec({ code: t.code, mode: 'script', frame: null, controller: new RunController({ speed: 0, stepMode: false }), autDir: AUT_DIR });
          const printed = r.logs.join('\n');
          const ok = t.answers.some((a) => printed.includes(a) || !!r.error?.message.includes(a));
          push({ id: t.id, kind: t.kind, status: ok ? 'ok' : 'warn', note: `printed: ${printed.slice(0, 120)} · answers: ${t.answers.join(' / ')}` });
        }
      } catch (e) {
        push({ id: t.id, kind: t.kind, status: 'fail', note: `crash: ${(e as Error).message}` });
      }
    }
    // runnable examples
    for (const ch of chapters) for (const meta of lessonsOf(ch)) for (const s of (await loadLesson(meta.id))?.steps ?? []) {
      const l = meta;
      if (s.type === 'trace' && (!filter || l.id.startsWith(filter))) {
        const r = await run(s.code, s.app as AppSetup, s.files);
        push({ id: `${l.id} trace`, kind: 'trace-step', status: r.status === 'error' ? 'fail' : 'info', note: summarize(r) });
      }
      if (s.type === 'inspect' && s.focus && (!filter || l.id.startsWith(filter))) {
        const doc = await openPreview(frame.current!, AUT_DIR, { ...(s.app as object), route: s.app?.route || '/' });
        await new Promise((r) => setTimeout(r, 700));
        const n = doc ? doc.querySelectorAll(s.focus).length : -1;
        push({ id: `${l.id} inspect`, kind: 'inspect-step', status: n === 1 ? 'info' : 'fail', note: `focus ${s.focus} → ${n}` });
      }
      if (s.type === 'example' && s.runnable && (!filter || l.id.startsWith(filter))) {
        const r = await run(s.code, s.app as AppSetup, s.files);
        push({ id: `${l.id} example`, kind: 'example', status: r.status === 'error' ? 'fail' : 'info', note: summarize(r) });
      }
    }
    window.__selftest = { done: true, rows: out };
    setBusy(false);
  };

  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  return (
    <div className="page page-wide selftest">
      <h1 className="page-title">Self-test</h1>
      <div className="row gap">
        <input className="text-input" placeholder="filter by id prefix, e.g. c1-l2" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? 'Running…' : 'Run all'}</button>
        <span>{Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>
      </div>
      <iframe ref={frame} title="selftest" style={{ width: 900, height: 500, border: '1px solid var(--line)', borderRadius: 12, marginTop: 12 }} />
      <table className="st-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`st-${r.status}`}><td>{r.status}</td><td><code>{r.id}</code></td><td>{r.kind}</td><td>{r.note}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
