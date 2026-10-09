// Read-only code with syntax highlighting, line numbers and per-line decorations.
import { Fragment, useMemo, type ReactNode } from 'react';
import { parser } from '@lezer/javascript';
import { classHighlighter, highlightTree } from '@lezer/highlight';

type Tok = { text: string; cls: string };

export function highlightLines(code: string): Tok[][] {
  const tree = parser.parse(code);
  const marks: { from: number; to: number; cls: string }[] = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => marks.push({ from, to, cls: classes }));
  const toks: Tok[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.from > pos) toks.push({ text: code.slice(pos, m.from), cls: '' });
    toks.push({ text: code.slice(m.from, m.to), cls: m.cls });
    pos = m.to;
  }
  if (pos < code.length) toks.push({ text: code.slice(pos), cls: '' });
  const lines: Tok[][] = [[]];
  for (const t of toks) {
    const parts = t.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ text: p, cls: t.cls });
    });
  }
  return lines;
}

export function CodeLine({ code }: { code: string }) {
  const toks = useMemo(() => highlightLines(code)[0] || [], [code]);
  return <code className="code-inline-line">{toks.map((t, i) => <span key={i} className={t.cls}>{t.text}</span>)}</code>;
}

export interface CodeViewProps {
  code: string;
  highlight?: number[];
  runLine?: number | null;
  errorLine?: number | null;
  onLineClick?: (line: number) => void;
  lineClass?: (line: number) => string;
  lineExtra?: (line: number) => ReactNode;
  numbers?: boolean;
  className?: string;
  label?: string;
}

export function CodeView({ code, highlight, runLine, errorLine, onLineClick, lineClass, lineExtra, numbers = true, className = '', label }: CodeViewProps) {
  const text = code.replace(/\n$/, '');
  const lines = useMemo(() => highlightLines(text), [text]);
  const hl = new Set(highlight || []);
  return (
    <div className={`codeview ${onLineClick ? 'codeview-clickable' : ''} ${className}`} aria-label={label}>
      {label && <div className="codeview-label">{label}</div>}
      <pre>
        {lines.map((toks, i) => {
          const n = i + 1;
          const cls = [
            'cv-line',
            hl.has(n) ? 'cv-hl' : '',
            runLine === n ? 'cv-run' : '',
            errorLine === n ? 'cv-err' : '',
            lineClass ? lineClass(n) : '',
          ].filter(Boolean).join(' ');
          const content = (
            <>
              {numbers && <span className="cv-num">{n}</span>}
              <span className="cv-code">{toks.length ? toks.map((t, j) => <span key={j} className={t.cls}>{t.text}</span>) : '​'}</span>
              {lineExtra && <span className="cv-extra">{lineExtra(n)}</span>}
            </>
          );
          return onLineClick ? (
            <button type="button" key={n} className={cls} onClick={() => onLineClick(n)}>{content}</button>
          ) : (
            <Fragment key={n}><div className={cls}>{content}</div></Fragment>
          );
        })}
      </pre>
    </div>
  );
}
