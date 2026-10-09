// Dev page: runs every reference solution / prediction / best agent response through the emulator.
import { useRef, useState } from 'react';
import { allTasks, chapters, lessonsOf } from '../content';
import type { Checks, Task } from '../content/schema';
import { RunController, runSpec, type AppSetup, type RunResult } from '../emulator';
import { AUT_DIR } from '../lab/useRunner';
import { gradeCode } from '../tasks/gradeCode';
import { fillCode } from '../tasks/FillTask';

interface Row { id: string; kind: string; status: 'ok' | 'fail' | 'warn' | 'info'; note: string }

declare global {
  interface Window { __selftest?: { done: boolean; rows: Row[] } }
}

export function SelfTestPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const run = (code: string, app: AppSetup | undefined): Promise<RunResult> =>
    runSpec({ code, app, frame: frame.current, controller: new RunController({ speed: 0, stepMode: false }), autDir: AUT_DIR });

  const go = async () => {
    setBusy(true);
    const out: Row[] = [];
    window.__selftest = { done: false, rows: out };
    const push = (r: Row) => { out.push(r); setRows([...out]); };
    const summarize = (r: RunResult) => r.status === 'error' ? `error: ${r.error?.message.split('\n')[0]}` : r.tests.map((t) => `${t.status}${t.error ? ` (${t.error.code}: ${t.error.message.split('\n')[0].slice(0, 120)})` : ''}`).join('; ');
    const tasks = allTasks.filter((r) => !filter || r.task.id.startsWith(filter));
    for (const { task } of tasks) {
      const t = task as Task;
      const app = (t as { app?: AppSetup }).app;
      try {
        if (t.kind === 'fix' || t.kind === 'find-bug' || t.kind === 'code') {
          const v = await gradeCode(t.solution, t.checks, app, (c, a) => run(c, a));
          push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'solution ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
          if (t.kind !== 'code') {
            const s = await gradeCode(t.starter, t.checks, app, (c, a) => run(c, a));
            if (s.ok) push({ id: t.id, kind: t.kind, status: 'warn', note: 'starter already satisfies checks' });
          }
        } else if (t.kind === 'predict') {
          const r = await run(t.code, app);
          const real = r.status === 'passed' ? 'pass' : 'fail';
          push({ id: t.id, kind: t.kind, status: real === t.outcome ? 'ok' : 'fail', note: `expected ${t.outcome}, real ${real} · ${summarize(r)}` });
        } else if (t.kind === 'agent') {
          const best = t.responses.find((x) => x.best)!;
          if (t.checks) {
            const v = await gradeCode(best.code, t.checks as Checks, app, (c, a) => run(c, a));
            push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'best response ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
          } else {
            const r = await run(best.code, app);
            push({ id: t.id, kind: t.kind, status: r.status === 'passed' ? 'ok' : 'warn', note: `best: ${summarize(r)}` });
          }
          for (const resp of t.responses.filter((x) => !x.best)) {
            const r = await run(resp.code, app);
            if (r.status === 'error') push({ id: t.id, kind: 'agent-alt', status: 'warn', note: `response [${resp.when.join(',')}] has a code error: ${summarize(r)}` });
          }
        } else if (t.kind === 'fill' && t.checks) {
          const code = fillCode(t.code, t.blanks.map((b) => b.answers[0]));
          const v = await gradeCode(code, t.checks, app, (c, a) => run(c, a));
          push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'filled code ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
        } else if (t.kind === 'parsons' && t.checks && t.code !== false) {
          const v = await gradeCode(t.lines.join('\n'), t.checks, app, (c, a) => run(c, a));
          push({ id: t.id, kind: t.kind, status: v.ok ? 'ok' : 'fail', note: v.ok ? 'assembled ok' : v.problems.map((p) => p.en).join(' | ') + ' · ' + (v.main ? summarize(v.main) : '') });
        } else if (t.kind === 'pick-locator') {
          const correct = t.options.find((o) => o.correct);
          const text = typeof correct?.text === 'string' ? correct.text.trim().replace(/;$/, '') : '';
          if (text && /^(page\.)?(getBy|locator)/.test(text)) {
            const expr = text.startsWith('page.') ? text : `page.${text}`;
            const code = `test('locator', async ({ page }) => {\n  await page.goto(${JSON.stringify((app as { route?: string } | undefined)?.route || '/')});\n  await expect(${expr}).toHaveCount(1);\n});`;
            const r = await run(code, app);
            push({ id: t.id, kind: t.kind, status: r.status === 'passed' ? 'ok' : 'fail', note: `${expr} → ${summarize(r)}` });
          }
        } else if (t.kind === 'input' && t.run === 'script' && t.code) {
          const r = await runSpec({ code: t.code, mode: 'script', frame: null, controller: new RunController({ speed: 0, stepMode: false }), autDir: AUT_DIR });
          const printed = r.logs.join('\n');
          const ok = t.answers.some((a) => printed.includes(a));
          push({ id: t.id, kind: t.kind, status: ok ? 'ok' : 'warn', note: `printed: ${printed.slice(0, 120)} · answers: ${t.answers.join(' / ')}` });
        }
      } catch (e) {
        push({ id: t.id, kind: t.kind, status: 'fail', note: `crash: ${(e as Error).message}` });
      }
    }
    // runnable examples
    for (const ch of chapters) for (const l of lessonsOf(ch)) for (const s of l.steps) {
      if (s.type === 'example' && s.runnable && (!filter || l.id.startsWith(filter))) {
        const r = await run(s.code, s.app as AppSetup);
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
