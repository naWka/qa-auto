// Checks the Python in lessons without a browser: every snippet parses, "what will it print" tasks print
// what the answers say, and no JavaScript leftovers hide in code or prose.
// Run: npm run check:code [-- c3-l2]   (browser behaviour is checked by #/dev/selftest)
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { parseModule } from '../src/emulator/py/parser';
import { PySyntaxError } from '../src/emulator/py/errors';
import { runSpec } from '../src/emulator/runner';
import { RunController } from '../src/emulator/runtime';

const ROOT = join(process.cwd(), 'src', 'content');
const filter = process.argv[2] ?? '';
const errors: string[] = [];
const warnings: string[] = [];
(globalThis as { fetch?: unknown }).fetch = async () => ({ json: async () => JSON.parse(readFileSync(join(process.cwd(), 'public', 'aut', 'data.json'), 'utf8')) });

function dedent(s: string): string {
  const lines = s.replace(/\n$/, '').split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n') + '\n';
}

/** Snippets that are mostly prose or other languages (plans, shell, YAML, rules files). */
function notPython(code: string): boolean {
  const lines = code.split('\n').filter((l) => l.trim());
  if (!lines.length) return true;
  if (/^\s*(\$ |pip |pytest|playwright |npx |npm |git |claude |cd |python )/.test(lines[0])) return true;
  if (/^(name|on|jobs):/m.test(code) && /^\s+- (uses|run|name):/m.test(code)) return true;
  if (/^\[pytest\]/m.test(code)) return true;
  if (/^\s*<[a-zA-Z!]/.test(lines[0])) return true;
  if (/^\s*-\s+\w+.*\[ref=/.test(lines[0]) || /^\s*- (heading|button|link|textbox|navigation|main|list|listitem|article|img|checkbox|combobox|banner|form|paragraph|row|cell|generic|text|table|status|alert|region|spinbutton|searchbox|radio|group|contentinfo)\b/.test(lines[0])) return true;
  // plain prose (review comments, prompts) shown in a code box
  if (!lines.some((l) => /[()=[\]]|^\s*(def|class|import|from|assert|return|@)\b/.test(l))) return true;
  const md = lines.filter((l) => /^\s*(#{1,4} |[-*] |\d+\. |\*\*|>)/.test(l)).length;
  const pyish = lines.filter((l) => /^\s*(def|class|import|from|assert|return|yield|with|for|if|@)\b|[()=]/.test(l)).length;
  if (pyish / lines.length < 0.3 && md) return true;
  return false;
}

function check(code: string, where: string, mustParse: boolean) {
  if (!code || notPython(code)) return;
  try {
    parseModule(dedent(code), 'test_example.py');
  } catch (e) {
    if (e instanceof PySyntaxError) {
      (mustParse ? errors : warnings).push(`${where}: ${e.kind}: ${e.message} (line ${e.line})`);
    } else throw e;
  }
}

const JS_LEFTOVERS: Array<[RegExp, string]> = [
  [/\bawait\s+(page|expect|this|request|[a-z]\w*\.)/, 'await'],
  [/\basync\s*\(\s*\{/, 'async ({ … })'],
  [/=>/, 'arrow function'],
  [/\bgetBy(Role|Label|Text|TestId|Placeholder|AltText|Title)\b/, 'getBy*'],
  [/\.(toBe|toHave|toContain)[A-Z]\w*\(/, 'toBe*/toHave* matcher'],
  [/\b(const|let|var)\s+\w+\s*=/, 'const/let'],
  [/\btest\(\s*['"]/, "test('…')"],
  [/\.spec\.(js|ts)\b/, '.spec.js'],
  [/npx playwright test/, 'npx playwright test'],
  [/\b(selectOption|textContent|innerText|inputValue|getAttribute|isVisible|waitForTimeout|pressSequentially|waitForURL|allTextContents)\b/, 'camelCase Playwright method'],
  [/\{\s*(name|hasText|exact):\s*['"]/, 'JS options object'],
  [/@playwright\/test/, '@playwright/test'],
];

function scanText(s: string, where: string) {
  for (const [re, what] of JS_LEFTOVERS) if (re.test(s)) { warnings.push(`${where}: JS leftover (${what}): ${s.slice(0, 90).replace(/\n/g, '⏎')}`); break; }
}

function walkStrings(node: unknown, where: string) {
  if (typeof node === 'string') { scanText(node, where); return; }
  if (Array.isArray(node)) node.forEach((x, i) => walkStrings(x, `${where}[${i}]`));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walkStrings(v, where ? `${where}.${k}` : k);
}

const scripts: Array<{ id: string; code: string; answers: string[] }> = [];

function checkTask(t: Record<string, any>, file: string) {
  const w = `${file} ${t.id}`;
  switch (t.kind) {
    case 'choice': case 'input':
      if (t.code) check(t.code, `${w} code`, false);
      if (t.run === 'script' && t.code) scripts.push({ id: w, code: t.code, answers: t.kind === 'input' ? t.answers : [] });
      break;
    case 'fill': {
      let i = 0;
      const filled = t.code.replace(/___/g, () => t.blanks[i++]?.answers[0] ?? '___');
      check(filled, `${w} code (blanks filled)`, true);
      break;
    }
    case 'parsons':
      if (t.code !== false) check(t.lines.join('\n'), `${w} lines`, true);
      break;
    case 'predict': case 'trace': case 'review':
      check(t.code, `${w} code`, t.kind === 'trace');
      break;
    case 'fix': case 'find-bug': case 'code':
      check(t.starter, `${w} starter`, false);
      check(t.solution, `${w} solution`, true);
      break;
    case 'agent':
      for (const r of t.responses) check(r.code, `${w} response${r.best ? ' (best)' : ''}`, !!r.best);
      break;
  }
  for (const [name, src] of Object.entries((t.files ?? {}) as Record<string, string>)) if (name.endsWith('.py')) check(src, `${w} files/${name}`, true);
  for (const [name, src] of Object.entries((t.solutionFiles ?? {}) as Record<string, string>)) if (name.endsWith('.py')) check(src, `${w} solutionFiles/${name}`, true);
}

function checkSteps(steps: Record<string, any>[], file: string) {
  steps.forEach((s, i) => {
    const w = `${file} step ${i + 1} (${s.type})`;
    if (s.type === 'theory' && s.code) check(s.code, w, false);
    if (s.type === 'example' || s.type === 'mapping' || s.type === 'trace') check(s.code, w, true);
    if (s.type === 'mistakes') for (const it of s.items) check(it.right, `${w} right`, false);
    if (s.type === 'task') checkTask(s.task, file);
    if (s.type === 'pretest') for (const t of s.items) checkTask(t, file);
    for (const [name, src] of Object.entries((s.files ?? {}) as Record<string, string>)) if (name.endsWith('.py')) check(src, `${w} files/${name}`, true);
  });
}

const chaptersDir = join(ROOT, 'chapters');
for (const dir of readdirSync(chaptersDir).sort()) {
  const cdir = join(chaptersDir, dir);
  if (!statSync(cdir).isDirectory()) continue;
  for (const f of readdirSync(cdir).filter((x) => x.endsWith('.yaml')).sort()) {
    const path = join(cdir, f);
    const rel = relative(process.cwd(), path);
    const data = YAML.parse(readFileSync(path, 'utf8')) as Record<string, any>;
    const id = data.id as string;
    if (filter && (f === 'chapter.yaml' ? !(filter === id || filter === `${id}-boss`) : !id.startsWith(filter))) continue;
    if (f === 'chapter.yaml') {
      for (const t of data.boss?.tasks ?? []) checkTask(t, rel);
      walkStrings({ boss: data.boss, plan: data.plan, intro: data.intro, outro: data.outro, summary: data.summary }, rel);
      continue;
    }
    checkSteps(data.steps ?? [], rel);
    for (const t of data.checkPool ?? []) checkTask(t, rel);
    walkStrings(data, rel);
  }
}
if (!filter) {
  for (const f of readdirSync(join(ROOT, 'glossary'))) walkStrings(YAML.parse(readFileSync(join(ROOT, 'glossary', f), 'utf8')), `glossary/${f}`);
  for (const f of ['interview.yaml', 'phrases.yaml', 'story.yaml', 'ui.yaml', 'errors.yaml']) walkStrings(YAML.parse(readFileSync(join(ROOT, f), 'utf8')), f);
}

for (const s of scripts) {
  const r = await runSpec({ code: s.code, mode: 'script', frame: null, controller: new RunController({ speed: 0, stepMode: false }), autDir: '/' });
  const printed = r.logs.join('\n');
  if (r.status !== 'passed' && !s.answers.length) warnings.push(`${s.id}: script ${r.status}: ${r.error?.message.split('\n')[0] ?? ''}`);
  if (s.answers.length && !s.answers.some((a) => printed.includes(a) || (r.error && r.error.message.includes(a)))) {
    errors.push(`${s.id}: printed ${JSON.stringify(printed.slice(0, 120))}${r.error ? ` (error: ${r.error.message.split('\n')[0]})` : ''}, answers ${JSON.stringify(s.answers)}`);
  }
}

for (const x of warnings) console.log('! ' + x);
for (const x of errors) console.log('✗ ' + x);
console.log(`${errors.length} errors, ${warnings.length} warnings`);
if (process.env.CHECK_CODE_SELF) rmSync(process.env.CHECK_CODE_SELF, { force: true });
process.exit(errors.length ? 1 : 0);
