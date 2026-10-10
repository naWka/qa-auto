// Small shared pieces: test case card, app state note, diff view, chips.
import type { AppConfig, TestCase } from '../content/schema';
import { U } from './Bi';
import { Icon } from './Icon';
import { CodeView } from './CodeView';

export function TestCaseCard({ tc, active, onHover }: { tc: TestCase; active?: string | null; onHover?: (key: string | null) => void }) {
  return (
    <div className="testcase">
      <div className="testcase-head">
        <span className="testcase-id">{tc.id}</span>
        <span className="testcase-title">{tc.title}</span>
        <span className="chip chip-lavender"><U k="task.testCase" stack={false} /></span>
      </div>
      {tc.preconditions?.length ? (
        <div className="testcase-pre"><strong><U k="task.preconditions" stack={false} />:</strong> {tc.preconditions.join(' · ')}</div>
      ) : null}
      <ol className="testcase-steps">
        {tc.steps.map((s, i) => (
          <li key={i}>
            <button type="button" className={`tc-action ${active === `s${i + 1}` ? 'active' : ''}`} onMouseEnter={() => onHover?.(`s${i + 1}`)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(`s${i + 1}`)} onClick={() => onHover?.(`s${i + 1}`)} disabled={!onHover}>
              {s.action}{s.data ? <span className="tc-data"> — {s.data}</span> : null}
            </button>
            {s.expected && (
              <button type="button" className={`tc-expected ${active === `e${i + 1}` ? 'active' : ''}`} onMouseEnter={() => onHover?.(`e${i + 1}`)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(`e${i + 1}`)} onClick={() => onHover?.(`e${i + 1}`)} disabled={!onHover}>
                <Icon name="target" size={14} /> {s.expected}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

const USERS: Record<string, string> = { 'anna@bloomly.app': 'Anna', 'tom@bloomly.app': 'Tom', 'maya@bloomly.app': 'Maya' };

/** What the app looks like when the task starts (never reveals switched-on bugs). */
export function AppNote({ app }: { app?: AppConfig }) {
  const st = app?.state;
  if (!st?.user && !st?.cart?.length) return null;
  return (
    <div className="app-note">
      <Icon name="info" size={15} />
      <U k="task.appNote" stack={false} />:
      {st.user && <span className="chip chip-mint"><U k="task.loggedInAs" stack={false} /> {USERS[st.user] || st.user}</span>}
      {st.cart?.length ? <span className="chip chip-peach"><U k="task.cartPreset" stack={false} />: {st.cart.map((c) => `${c.id} ×${c.qty}`).join(', ')}</span> : null}
    </div>
  );
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  const removed = new Set<number>();
  const added = new Set<number>();
  const setB = new Set(b);
  const setA = new Set(a);
  a.forEach((l, i) => { if (!setB.has(l)) removed.add(i + 1); });
  b.forEach((l, i) => { if (!setA.has(l)) added.add(i + 1); });
  return (
    <div className="diff">
      <CodeView code={before} label="before" lineClass={(n) => (removed.has(n) ? 'cv-removed' : '')} />
      <CodeView code={after} label="after" lineClass={(n) => (added.has(n) ? 'cv-added' : '')} />
    </div>
  );
}

export function KindChip({ kind }: { kind: string }) {
  const icons: Record<string, string> = {
    choice: 'check', input: 'chat', fill: 'code', parsons: 'menu', match: 'repeat', predict: 'crystal', 'pick-locator': 'target',
    review: 'eye', agent: 'sparkle', fix: 'bug', 'find-bug': 'bug', code: 'code', vocab: 'book', inspect: 'inspect', trace: 'clock',
  };
  return <span className={`kind-chip kind-${kind}`}><Icon name={icons[kind] || 'sparkle'} size={14} /> <U k={`task.kind.${kind}`} stack={false} /></span>;
}
