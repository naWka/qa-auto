// Validates all YAML content: schema, ids, term links, key points, pools.
// Run: npm run check:content   (exit code 1 on errors)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { Lesson, Chapter, GlossaryEntry, Phrases, Interview, Task } from '../src/content/schema.ts';

const ROOT = join(import.meta.dirname, '..', 'src', 'content');
const errors: string[] = [];
const warnings: string[] = [];
const err = (file: string, msg: string) => errors.push(`✗ ${file}: ${msg}`);
const warn = (file: string, msg: string) => warnings.push(`! ${file}: ${msg}`);

// Ids that some chapter owns (see docs/CONTENT.md §9). Referencing one that isn't written yet is a warning.
const PLANNED_TERMS = `manual-testing test-automation automated-test test-case test-step expected-result actual-result
regression-testing test-suite spec-file test-runner action assertion locator test-report pass fail precondition test-data
smoke-test timeout bug llm ai-agent prompt context hallucination mcp accessibility-snapshot code-review diff false-positive
false-negative request-changes test-coverage edge-case negative-test code syntax variable constant string number boolean
function arrow-function parameter argument object property method array loop async await promise comment error-message
console dom html element tag attribute devtools inspect css-selector xpath test-id role accessible-name accessibility
fragile-selector resilient-locator strict-mode chaining filter web-first-assertion retry soft-assertion actionability
auto-waiting flaky-test race-condition hard-wait trace-viewer debugging self-healing test-plan planner generator healer
seed-test project-rules test-isolation hook describe-block setup teardown page-object-model class fixture
parameterization data-driven-testing refactoring api-testing endpoint request response status-code http-method payload
json header auth-token ci-cd pipeline codegen html-report headless cross-browser-testing pull-request repository commit
portfolio config-file`.split(/\s+/).filter(Boolean);

function load(file: string): unknown {
  try {
    return YAML.parse(readFileSync(file, 'utf8'), { prettyErrors: true });
  } catch (e) {
    err(rel(file), `YAML parse error: ${(e as Error).message}`);
    return undefined;
  }
}
const rel = (f: string) => relative(join(ROOT, '..', '..'), f);

function zodCheck<T>(schema: { safeParse: (v: unknown) => any }, data: unknown, file: string): T | undefined {
  const r = schema.safeParse(data);
  if (r.success) return r.data as T;
  for (const issue of r.error.issues.slice(0, 15)) {
    err(file, `${issue.path.join('.')}: ${issue.message}`);
  }
  if (r.error.issues.length > 15) err(file, `…and ${r.error.issues.length - 15} more schema issues`);
  return undefined;
}

// ---------- glossary ----------
const glossary = new Map<string, any>();
const glossaryDir = join(ROOT, 'glossary');
if (existsSync(glossaryDir)) {
  for (const f of readdirSync(glossaryDir).filter((f) => f.endsWith('.yaml')).sort()) {
    const file = join(glossaryDir, f);
    const data = load(file);
    if (!Array.isArray(data)) { err(rel(file), 'glossary file must be a list'); continue; }
    data.forEach((entry, i) => {
      const e = zodCheck<any>(GlossaryEntry, entry, `${rel(file)}[${i}]`);
      if (!e) return;
      if (glossary.has(e.id)) err(rel(file), `duplicate glossary id "${e.id}"`);
      glossary.set(e.id, e);
    });
  }
}

function checkTermId(id: string, file: string, where: string) {
  if (glossary.has(id)) return;
  if (PLANNED_TERMS.includes(id)) warn(file, `${where}: term "${id}" not written yet`);
  else err(file, `${where}: unknown term id "${id}" (not in glossary nor in the planned list)`);
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Walk every string in an object, checking term links and gender syntax
function walkStrings(node: unknown, file: string, path: string, lang?: 'en' | 'ru') {
  if (typeof node === 'string') {
    for (const m of node.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const [display, id] = m[1].split('|');
      const termId = id ? id.trim() : slug(display);
      checkTermId(termId, file, `${path} link [[${m[1]}]]`);
    }
    if (lang === 'ru') {
      const opens = (node.match(/\{[^{}]*\|[^{}]*\}/g) || []).length;
      const bad = node.match(/\{[^{}|]*\|[^{}|]*\|[^{}]*\}/g);
      if (bad) err(file, `${path}: gender variant must have exactly 2 forms: ${bad[0]}`);
      void opens;
    }
    if (lang === 'en' && /[а-яё]/i.test(node.replace(/`[^`]*`/g, ''))) warn(file, `${path}: Cyrillic inside "en"`);
    if (lang === 'ru' && node.length > 25 && !/[а-яё]/i.test(node)) warn(file, `${path}: "ru" has no Cyrillic`);
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walkStrings(v, file, `${path}[${i}]`)); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walkStrings(v, file, path ? `${path}.${k}` : k, k === 'en' ? 'en' : k === 'ru' ? 'ru' : undefined);
    }
  }
}

const allTaskIds = new Map<string, string>();

function checkTask(t: any, file: string, where: string, keyPoints: Set<string> | null) {
  if (allTaskIds.has(t.id)) err(file, `${where}: duplicate task id "${t.id}" (also in ${allTaskIds.get(t.id)})`);
  allTaskIds.set(t.id, file);
  if (keyPoints && t.keyPoint && !keyPoints.has(t.keyPoint)) err(file, `${where} ${t.id}: unknown keyPoint "${t.keyPoint}"`);
  switch (t.kind) {
    case 'choice':
    case 'pick-locator': {
      const n = t.options.filter((o: any) => o.correct).length;
      if (n === 0) err(file, `${t.id}: no correct option`);
      if (n > 1 && !t.multi && t.kind === 'choice') err(file, `${t.id}: several correct options but multi is not set`);
      break;
    }
    case 'fill': {
      const gaps = (t.code.match(/___/g) || []).length;
      if (gaps !== t.blanks.length) err(file, `${t.id}: ${gaps} gaps (___) but ${t.blanks.length} blanks`);
      t.blanks.forEach((b: any, i: number) => {
        if (b.options && !b.answers.every((a: string) => b.options.includes(a))) err(file, `${t.id}: blank ${i + 1} answer not among options`);
      });
      break;
    }
    case 'parsons': {
      for (const a of t.alt || []) {
        const sorted = [...a].sort((x: number, y: number) => x - y);
        if (sorted.length !== t.lines.length || sorted.some((v: number, i: number) => v !== i)) err(file, `${t.id}: alt ${JSON.stringify(a)} is not a permutation`);
      }
      break;
    }
    case 'review': {
      const lines = t.code.replace(/\n$/, '').split('\n').length;
      for (const i of t.issues) if (i.line > lines) err(file, `${t.id}: issue line ${i.line} > ${lines} lines`);
      break;
    }
    case 'agent': {
      const ids = new Set(t.blocks.map((b: any) => b.id));
      for (const r of t.responses) for (const id of [...r.when, ...(r.unless || [])]) if (!ids.has(id)) err(file, `${t.id}: response refers to unknown block "${id}"`);
      if (!t.responses.some((r: any) => r.best)) err(file, `${t.id}: no response marked best`);
      if (!t.responses.some((r: any) => r.when.length === 0)) warn(file, `${t.id}: no fallback response with when: []`);
      for (const k of Object.keys(t.missing || {})) if (!ids.has(k)) err(file, `${t.id}: missing.${k} is not a block id`);
      break;
    }
    case 'vocab': {
      if (t.mode === 'cloze') {
        if (!t.sentence || !t.answer || !t.options) err(file, `${t.id}: cloze needs sentence, answer, options`);
        else {
          if (!t.sentence.en.includes('___')) err(file, `${t.id}: cloze sentence.en needs ___`);
          if (!t.options.includes(t.answer)) err(file, `${t.id}: answer not among options`);
        }
      }
      if (t.mode === 'translate') { if (!t.term) err(file, `${t.id}: translate needs term`); else checkTermId(t.term, file, t.id); }
      if (t.mode === 'match') { if (!t.terms || t.terms.length < 3) err(file, `${t.id}: match needs ≥3 terms`); else t.terms.forEach((x: string) => checkTermId(x, file, t.id)); }
      break;
    }
    case 'fix':
    case 'find-bug':
    case 'code':
      if (t.starter.trim() === t.solution.trim() && t.kind === 'fix') err(file, `${t.id}: starter equals solution`);
      if (t.kind === 'find-bug' && t.checks.expect !== 'fail') warn(file, `${t.id}: find-bug usually expects fail on the buggy app`);
      break;
  }
  if (!t.hints?.length && !['vocab'].includes(t.kind)) warn(file, `${t.id}: no hints`);
}

// ---------- chapters & lessons ----------
const chaptersDir = join(ROOT, 'chapters');
const lessonIds = new Set<string>();
let placementCount = 0;
if (existsSync(chaptersDir)) {
  for (const dir of readdirSync(chaptersDir).sort()) {
    const cdir = join(chaptersDir, dir);
    if (!statSync(cdir).isDirectory()) continue;
    const chFile = join(cdir, 'chapter.yaml');
    if (!existsSync(chFile)) { err(rel(cdir), 'missing chapter.yaml'); continue; }
    const ch = zodCheck<any>(Chapter, load(chFile), rel(chFile));
    if (ch) walkStrings(ch, rel(chFile), '');
    const lessonFiles = readdirSync(cdir).filter((f) => /^l\d+.*\.yaml$/.test(f)).sort();
    const found: string[] = [];
    for (const lf of lessonFiles) {
      const file = join(cdir, lf);
      const lesson = zodCheck<any>(Lesson, load(file), rel(file));
      if (!lesson) continue;
      const r = rel(file);
      if (lessonIds.has(lesson.id)) err(r, `duplicate lesson id ${lesson.id}`);
      lessonIds.add(lesson.id);
      found.push(lesson.id);
      if (ch && lesson.chapter !== ch.id) err(r, `lesson.chapter ${lesson.chapter} ≠ ${ch.id}`);
      walkStrings(lesson, r, '');
      lesson.terms.forEach((t: string) => checkTermId(t, r, 'terms'));
      const kps = new Set<string>(lesson.keyPoints.map((k: any) => k.id));
      const kpUse = new Map<string, number>();
      lesson.steps.forEach((s: any, i: number) => {
        if (s.keyPoint && !kps.has(s.keyPoint)) err(r, `steps[${i}]: unknown keyPoint ${s.keyPoint}`);
        if (s.type === 'task') checkTask(s.task, r, `steps[${i}]`, kps);
        if (s.type === 'pretest') s.items.forEach((t: any) => checkTask(t, r, `steps[${i}].pretest`, kps));
      });
      lesson.checkPool.forEach((t: any, i: number) => {
        checkTask(t, r, `checkPool[${i}]`, kps);
        if (!t.keyPoint) err(r, `checkPool[${i}] ${t.id}: keyPoint is required in the pool`);
        else kpUse.set(t.keyPoint, (kpUse.get(t.keyPoint) || 0) + 1);
        if (t.placement) placementCount++;
      });
      if (lesson.checkPool.length < 8) warn(r, `checkPool has ${lesson.checkPool.length} tasks (recommended 8)`);
      for (const kp of kps) if ((kpUse.get(kp) || 0) < 2) warn(r, `key point ${kp} is covered ${kpUse.get(kp) || 0}× in checkPool (need ≥2)`);
      const kinds = new Set(lesson.steps.filter((s: any) => s.type === 'task').map((s: any) => s.task.kind));
      if (!kinds.has('predict')) warn(r, 'no predict task in lesson steps');
      if (!lesson.steps.some((s: any) => s.type === 'explain')) warn(r, 'no explain step');
      if (!lesson.steps.some((s: any) => s.type === 'phrases')) warn(r, 'no phrases step');
    }
    if (ch?.status === 'ready') {
      if (!ch.lessons?.length) err(rel(chFile), 'ready chapter needs lessons');
      for (const id of ch.lessons || []) if (!found.includes(id)) err(rel(chFile), `lesson ${id} listed but no file found`);
      if (!ch.boss) warn(rel(chFile), 'ready chapter has no boss');
      ch.boss?.tasks.forEach((t: any, i: number) => checkTask(t, rel(chFile), `boss.tasks[${i}]`, null));
    }
    if (ch?.status === 'planned' && !ch.plan?.length) warn(rel(chFile), 'planned chapter has no plan');
  }
}

// ---------- phrases, interview ----------
for (const [name, schema] of [['phrases.yaml', Phrases], ['interview.yaml', Interview]] as const) {
  const file = join(ROOT, name);
  if (!existsSync(file)) { warn(name, 'missing'); continue; }
  const data = zodCheck<any>(schema, load(file), rel(file));
  if (data) walkStrings(data, rel(file), '');
}

void Task;
for (const w of warnings) console.log(w);
for (const e of errors) console.log(e);
console.log(`\n${glossary.size} terms · ${lessonIds.size} lessons · ${allTaskIds.size} tasks · ${placementCount} placement items`);
console.log(`${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
