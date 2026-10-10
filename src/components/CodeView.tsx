// Read-only code with syntax highlighting, line numbers and per-line decorations.
import { Fragment, useMemo, type ReactNode } from 'react';
import { parser } from '@lezer/python';
import { classHighlighter, highlightTree } from '@lezer/highlight';

type Tok = { text: string; cls: string };

/** Plain-text snippets (Markdown plans, rules files, YAML workflows, shell commands, ini files) get a light highlighter. */
export function detectLang(code: string): 'py' | 'md' | 'yaml' | 'shell' | 'html' {
  const lines = code.split('\n').filter((l) => l.trim());
  if (!lines.length) return 'py';
  if (/^\s*<[a-zA-Z!]/.test(lines[0]) && lines.every((l) => !/\b(def|import|assert|expect\()/.test(l))) return 'html';
  const pyish = lines.filter((l) => /^\s*(def|class|import|from|assert|return|yield|with|for|if|elif|else|try|except|@)\b|[()[\]=]|:\s*$/.test(l)).length;
  if (lines.every((l) => /^\s*(\$ |npx |npm |pip |pip3 |python |python3 |pytest|playwright |git |cd |code |claude |playwright-cli |node |mkdir |source |\.venv|#)/.test(l)) && lines.some((l) => !/^\s*#/.test(l))) return 'shell';
  if (/^(name|on|jobs|steps|runs-on):/m.test(code) && /^\s+- (uses|run|name):/m.test(code)) return 'yaml';
  if (/^\[(pytest|tool:pytest|tool\.pytest\.ini_options)\]/m.test(code)) return 'yaml';
  if (pyish / lines.length < 0.25 && lines.some((l) => /^\s*(#{1,4} |[-*] |\d+\. |\*\*)/.test(l))) return 'md';
  return 'py';
}

function simpleTokens(line: string, lang: 'md' | 'yaml' | 'shell' | 'html'): Tok[] {
  const out: Tok[] = [];
  const push = (text: string, cls = '') => { if (text) out.push({ text, cls }); };
  if (lang === 'html') {
    for (const part of line.split(/(<!--.*?-->|<\/?[a-zA-Z][^>]*>)/)) {
      if (/^<!--/.test(part)) { push(part, 'tok-comment'); continue; }
      const m = part.match(/^(<\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?>)$/);
      if (!m) { push(part); continue; }
      push(m[1], 'tok-punctuation'); push(m[2], 'tok-typeName');
      for (const a of m[3].split(/(\s[\w:-]+(?:="[^"]*")?)/)) {
        const am = a.match(/^(\s[\w:-]+)(=)?("[^"]*")?$/);
        if (am) { push(am[1], 'tok-propertyName'); push(am[2] || '', 'tok-punctuation'); push(am[3] || '', 'tok-string'); } else push(a);
      }
      push(m[4], 'tok-punctuation');
    }
    return out;
  }
  if (lang === 'md') {
    const h = line.match(/^(\s*#{1,4} )(.*)$/);
    if (h) { push(h[1], 'tok-keyword'); push(h[2], 'tok-heading'); return out; }
    const m = line.match(/^(\s*(?:[-*]|\d+\.) )?(.*)$/)!;
    push(m[1] || '', 'tok-punctuation');
    for (const part of (m[2] || '').split(/(\*\*[^*]+\*\*|`[^`]+`|"[^"]*")/)) {
      if (/^\*\*/.test(part)) push(part, 'tok-heading');
      else if (/^`/.test(part)) push(part, 'tok-propertyName');
      else if (/^"/.test(part)) push(part, 'tok-string');
      else push(part);
    }
    return out;
  }
  if (lang === 'yaml') {
    const m = line.match(/^(\s*-?\s*)([\w.-]+:)?(.*)$/)!;
    push(m[1]); push(m[2] || '', 'tok-propertyName');
    const rest = m[3] || '';
    const c = rest.indexOf(' #');
    if (c >= 0) { push(rest.slice(0, c), 'tok-string'); push(rest.slice(c), 'tok-comment'); } else push(rest, rest.trim() ? 'tok-string' : '');
    return out;
  }
  if (/^\s*#/.test(line)) { push(line, 'tok-comment'); return out; }
  const m = line.match(/^(\s*\$?\s*)(\S+)(.*)$/);
  if (!m) { push(line); return out; }
  push(m[1]); push(m[2], 'tok-keyword');
  for (const part of m[3].split(/(\s--?[\w-]+(?:=\S+)?)/)) push(part, /^\s--?/.test(part) ? 'tok-propertyName' : '');
  return out;
}

export function highlightLines(code: string): Tok[][] {
  const lang = detectLang(code);
  if (lang !== 'py') return code.split('\n').map((l) => simpleTokens(l, lang));
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
    <div className={`codeview ${onLineClick ? 'codeview-clickable' : ''} ${numbers ? '' : 'codeview-plain'} ${className}`} aria-label={label}>
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
