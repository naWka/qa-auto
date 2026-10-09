import { useEffect, useMemo, useState } from 'react';
import type { IssueType, Task } from '../content/schema';
import { Bi, BiInline, U, usePrimary } from '../components/Bi';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { uiText } from '../content';
import type { KindProps } from './types';

type Review = Extract<Task, { kind: 'review' }>;

const ALL_TYPES: IssueType[] = ['fragile-locator', 'no-assertion', 'weak-assertion', 'wrong-assertion', 'hard-wait', 'missing-await', 'hallucination', 'wrong-data', 'test-dependency', 'wrong-step'];
const TEST_LEVEL_DEFAULT: IssueType[] = ['no-assertion', 'wrong-assertion', 'wrong-step', 'test-dependency'];

export function ReviewTask({ task, register, phase }: KindProps<Review>) {
  const [flags, setFlags] = useState<Record<number, IssueType>>({});
  const [testLevel, setTestLevel] = useState<Set<IssueType>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<{ missed: number; extra: Set<number>; wrongType: Set<number>; tlWrong: boolean } | null>(null);
  const primary = usePrimary();
  const types = task.types?.length ? task.types : ALL_TYPES;
  const lineIssues = useMemo(() => new Map(task.issues.filter((i) => i.line > 0).map((i) => [i.line, i])), [task.id]);
  const tlExpected = useMemo(() => new Set(task.issues.filter((i) => i.line === 0).map((i) => i.type)), [task.id]);
  const tlOptions = useMemo(() => {
    const base = TEST_LEVEL_DEFAULT.filter((t) => !task.types?.length || task.types.includes(t));
    return Array.from(new Set([...base, ...tlExpected]));
  }, [task.id]);
  const locked = phase === 'correct' || phase === 'revealed' || phase === 'final';
  const showNotes = locked;

  useEffect(() => {
    register({
      canCheck: Object.keys(flags).length > 0 || testLevel.size > 0,
      check: () => {
        const extra = new Set<number>();
        const wrongType = new Set<number>();
        let found = 0;
        for (const [l, t] of Object.entries(flags)) {
          const issue = lineIssues.get(Number(l));
          if (!issue) extra.add(Number(l));
          else if (issue.type !== t) wrongType.add(Number(l));
          else found++;
        }
        const missed = lineIssues.size - found - wrongType.size;
        const tlWrong = tlExpected.size !== testLevel.size || [...tlExpected].some((t) => !testLevel.has(t));
        const ok = missed === 0 && extra.size === 0 && wrongType.size === 0 && !tlWrong;
        setVerdict({ missed, extra, wrongType, tlWrong });
        const total = lineIssues.size + tlExpected.size;
        const got = found + (tlWrong ? 0 : tlExpected.size);
        return {
          correct: ok,
          feedback: ok ? undefined : {
            en: `Found ${got} of ${total} problems.${extra.size ? ` ${extra.size} flagged line(s) are actually fine.` : ''}${wrongType.size ? ` ${wrongType.size} line(s): right line, different problem.` : ''}${tlWrong ? ' Check the whole-test problems too.' : ''}`,
            ru: `Найдено проблем: ${got} из ${total}.${extra.size ? ` Отмеченных строк без проблем: ${extra.size}.` : ''}${wrongType.size ? ` Строк, где проблема названа неверно: ${wrongType.size}.` : ''}${tlWrong ? ' Проверь и проблемы всего теста.' : ''}`,
          },
        };
      },
      reveal: () => {
        setFlags(Object.fromEntries([...lineIssues.values()].map((i) => [i.line, i.type])));
        setTestLevel(new Set(tlExpected));
        setVerdict(null);
      },
    });
  });

  const pickType = (line: number, t: IssueType | null) => {
    setFlags((f) => {
      const n = { ...f };
      if (t) n[line] = t;
      else delete n[line];
      return n;
    });
    setEditing(null);
    setVerdict(null);
  };

  const lineClass = (n: number) => {
    const cls: string[] = [];
    if (flags[n]) cls.push('cv-flagged');
    if (editing === n) cls.push('cv-editing');
    if (verdict?.extra.has(n)) cls.push('cv-extra-flag');
    if (verdict?.wrongType.has(n)) cls.push('cv-wrong-type');
    if (showNotes && lineIssues.has(n)) cls.push('cv-issue');
    return cls.join(' ');
  };

  return (
    <div className="task-review">
      <div className="task-hint-line"><Icon name="eye" size={15} /> <U k="task.reviewHint" stack={false} /></div>
      <CodeView
        code={task.code}
        onLineClick={locked ? undefined : (n) => setEditing(editing === n ? null : n)}
        lineClass={lineClass}
        lineExtra={(n) => flags[n] ? <span className={`flag-chip ${showNotes && lineIssues.get(n)?.type === flags[n] ? 'ok' : ''}`}><Icon name="flag" size={12} /> {primary(uiText(`issue.${flags[n]}`))}</span> : null}
      />
      {editing !== null && !locked && (
        <div className="issue-picker">
          <div className="issue-picker-title"><U k="task.pickType" stack={false} /> <code>#{editing}</code></div>
          <div className="issue-chips">
            {types.map((t) => (
              <button key={t} type="button" className={`chip-btn ${flags[editing] === t ? 'on' : ''}`} onClick={() => pickType(editing, t)}>
                <BiInline t={uiText(`issue.${t}`)} stack={false} />
              </button>
            ))}
            {flags[editing] && <button type="button" className="chip-btn ghost" onClick={() => pickType(editing, null)}><U k="task.noProblem" stack={false} /></button>}
          </div>
        </div>
      )}
      <div className="test-level">
        <div className="test-level-title"><U k="task.testLevel" stack={false} /></div>
        <div className="issue-chips">
          {tlOptions.map((t) => (
            <label key={t} className={`chip-check ${testLevel.has(t) ? 'on' : ''} ${showNotes && tlExpected.has(t) ? 'ok' : ''}`}>
              <input type="checkbox" checked={testLevel.has(t)} disabled={locked} onChange={(e) => {
                setTestLevel((s) => { const n = new Set(s); if (e.target.checked) n.add(t); else n.delete(t); return n; });
                setVerdict(null);
              }} />
              <BiInline t={uiText(`issue.${t}`)} stack={false} />
            </label>
          ))}
        </div>
      </div>
      {showNotes && (
        <ul className="issue-notes">
          {task.issues.map((i, k) => (
            <li key={k}>
              <span className="issue-where">{i.line ? `#${i.line}` : <Icon name="flag" size={13} />}</span>
              <strong><BiInline t={uiText(`issue.${i.type}`)} stack={false} /></strong>
              <Bi t={i.note} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
