// Content schema. All learning content lives in YAML files under src/content
// and is validated against these schemas by scripts/check-content.ts.
import { z } from 'zod';

/** Bilingual text. `ru` may contain gender variants `{f|m}` and term links `[[display|id]]`. */
export const T = z.object({ en: z.string().min(1), ru: z.string().min(1) }).strict();
export type T = z.infer<typeof T>;

/** Same text for both languages (code, names) or bilingual. */
export const TS = z.union([z.string(), T]);
export type TS = z.infer<typeof TS>;

export const Speaker = z.enum(['maya', 'mochi', 'petal', 'leo', 'sofia', 'kai', 'you']);
export const Line = z.object({ who: Speaker, text: T, mood: z.string().optional() }).strict();
export type Line = z.infer<typeof Line>;

export const AppState = z.object({
  user: z.string().optional(),
  cart: z.array(z.object({ id: z.string(), qty: z.number().int().min(1) }).strict()).optional(),
  promo: z.string().optional(),
}).strict();

export const AppConfig = z.object({
  route: z.string().optional(),
  bugs: z.array(z.string()).optional(),
  latency: z.record(z.string(), z.union([z.number(), z.tuple([z.number(), z.number()])])).optional(),
  state: AppState.optional(),
  cookieBanner: z.boolean().optional(),
  /** 'redesign': generated CSS class names and extra wrappers; same texts, roles, labels, test ids */
  variant: z.enum(['redesign', 'sign-in']).optional(),
}).strict();
export type AppConfig = z.infer<typeof AppConfig>;

export const StaticRule = z.union([
  z.enum(['hasAssertion', 'noHardWait', 'noFragile', 'awaitsActions']),
  z.object({
    rule: z.enum(['uses', 'notUses', 'regex', 'notRegex', 'minExpects']),
    value: z.union([z.string(), z.number()]),
    message: T.optional(),
  }).strict(),
]);
export type StaticRule = z.infer<typeof StaticRule>;

export const Checks = z.object({
  expect: z.enum(['pass', 'fail']).default('pass'),
  also: z.array(z.object({ app: AppConfig, expect: z.enum(['pass', 'fail']) }).strict()).optional(),
  static: z.array(StaticRule).optional(),
  minTests: z.number().int().optional(),
  /** flaky-test fixes: the main run must give the expected outcome N times in a row (random latency) */
  repeat: z.number().int().min(2).max(20).optional(),
}).strict();
export type Checks = z.infer<typeof Checks>;

export const Option = z.object({ text: TS, correct: z.boolean().optional(), why: T.optional() }).strict();

/** Extra virtual files next to the spec, e.g. { 'pages/LoginPage.js': '…' } — imported as './pages/LoginPage'. */
export const Files = z.record(z.string().regex(/^[\w./-]+\.(js|ts|json)$/), z.string());
export type Files = z.infer<typeof Files>;
export type Option = z.infer<typeof Option>;

export const TestCase = z.object({
  id: z.string(),
  title: z.string(),
  preconditions: z.array(z.string()).optional(),
  steps: z.array(z.object({ action: z.string(), data: z.string().optional(), expected: z.string().optional() }).strict()),
}).strict();
export type TestCase = z.infer<typeof TestCase>;

const taskBase = {
  id: z.string().regex(/^c\d+-(l\d+|boss|place)-[a-z]+\d+$/),
  keyPoint: z.string().optional(),
  prompt: T,
  context: T.optional(),
  testCase: TestCase.optional(),
  hints: z.array(T).max(3).optional(),
  praise: T.optional(),
  explain: T.optional(),
  xp: z.number().optional(),
  app: AppConfig.optional(),
  placement: z.boolean().optional(),
};

export const ChoiceTask = z.object({
  ...taskBase,
  kind: z.literal('choice'),
  code: z.string().optional(),
  diff: z.object({ before: z.string(), after: z.string() }).strict().optional(),
  options: z.array(Option).min(2),
  multi: z.boolean().optional(),
  optionsCode: z.boolean().optional(),
  run: z.enum(['script']).optional(),
}).strict();

export const InputTask = z.object({
  ...taskBase,
  kind: z.literal('input'),
  code: z.string().optional(),
  answers: z.array(z.string()).min(1),
  caseSensitive: z.boolean().optional(),
  placeholder: z.string().optional(),
  run: z.enum(['script']).optional(),
}).strict();

export const FillTask = z.object({
  ...taskBase,
  kind: z.literal('fill'),
  code: z.string(),
  blanks: z.array(z.object({ answers: z.array(z.string()).min(1), options: z.array(z.string()).optional() }).strict()).min(1),
  checks: Checks.optional(),
  files: Files.optional(),
}).strict();

export const ParsonsTask = z.object({
  ...taskBase,
  kind: z.literal('parsons'),
  lines: z.array(z.string()).min(3),
  distractors: z.array(z.string()).optional(),
  alt: z.array(z.array(z.number().int())).optional(),
  code: z.boolean().optional(),
  checks: Checks.optional(),
  files: Files.optional(),
}).strict();

export const MatchTask = z.object({
  ...taskBase,
  kind: z.literal('match'),
  pairs: z.array(z.object({ left: TS, right: TS }).strict()).min(3),
  leftCode: z.boolean().optional(),
  rightCode: z.boolean().optional(),
}).strict();

export const PredictTask = z.object({
  ...taskBase,
  kind: z.literal('predict'),
  code: z.string(),
  files: Files.optional(),
  outcome: z.enum(['pass', 'fail']),
  reasons: z.array(Option).optional(),
}).strict();

export const PickLocatorTask = z.object({
  ...taskBase,
  kind: z.literal('pick-locator'),
  target: z.string().optional(),
  options: z.array(Option).min(2),
}).strict();

export const IssueType = z.enum([
  'fragile-locator', 'no-assertion', 'weak-assertion', 'wrong-assertion', 'hard-wait',
  'missing-await', 'hallucination', 'wrong-data', 'test-dependency', 'wrong-step',
]);
export type IssueType = z.infer<typeof IssueType>;

export const ReviewTask = z.object({
  ...taskBase,
  kind: z.literal('review'),
  code: z.string(),
  issues: z.array(z.object({ line: z.number().int().min(0), type: IssueType, note: T }).strict()).min(1),
  types: z.array(IssueType).optional(),
}).strict();

export const AgentTask = z.object({
  ...taskBase,
  kind: z.literal('agent'),
  blocks: z.array(z.object({
    id: z.string(),
    text: z.string(),
    ru: z.string(),
    locked: z.boolean().optional(),
  }).strict()).min(2),
  responses: z.array(z.object({
    when: z.array(z.string()),
    unless: z.array(z.string()).optional(),
    best: z.boolean().optional(),
    message: T,
    code: z.string(),
    files: Files.optional(),
  }).strict()).min(2),
  missing: z.record(z.string(), T).optional(),
  checks: Checks.optional(),
  files: Files.optional(),
}).strict();

export const CodeTask = z.object({
  ...taskBase,
  kind: z.enum(['fix', 'find-bug', 'code']),
  starter: z.string(),
  solution: z.string(),
  checks: Checks,
  /** virtual files the student sees (and may edit) next to the spec */
  files: Files.optional(),
  /** the same files in the reference solution (defaults to `files`) */
  solutionFiles: Files.optional(),
}).strict();

/** What the inspector panel reveals about the selected element (fading support). */
export const InspectShow = z.enum(['attributes', 'role', 'name', 'locator']);
export const InspectView = z.enum(['dom', 'aria', 'both']);

/** Pick an element in the live page / DOM tree / accessibility snapshot. */
export const InspectTask = z.object({
  ...taskBase,
  kind: z.literal('inspect'),
  /** CSS selector of the element(s) that count as the right answer */
  target: z.string(),
  view: InspectView.optional(),
  show: z.array(InspectShow).optional(),
}).strict();

/** Read a recorded run in a simplified trace viewer and point to the action where it went wrong. */
export const TraceTask = z.object({
  ...taskBase,
  kind: z.literal('trace'),
  code: z.string(),
  files: Files.optional(),
  /** code line(s) of the action the student should select */
  answer: z.union([z.number().int().min(1), z.array(z.number().int().min(1)).min(1)]),
  /** real outcome of the run (self-test verifies it) */
  outcome: z.enum(['pass', 'fail']).optional(),
  /** optional follow-up diagnosis question */
  options: z.array(Option).optional(),
}).strict();

export const VocabTask = z.object({
  ...taskBase,
  kind: z.literal('vocab'),
  prompt: T.optional(),
  mode: z.enum(['cloze', 'translate', 'match']),
  sentence: T.optional(),
  answer: z.string().optional(),
  options: z.array(z.string()).optional(),
  term: z.string().optional(),
  direction: z.enum(['en-ru', 'ru-en']).optional(),
  terms: z.array(z.string()).optional(),
}).strict();

export const Task = z.discriminatedUnion('kind', [
  ChoiceTask, InputTask, FillTask, ParsonsTask, MatchTask, PredictTask,
  PickLocatorTask, ReviewTask, AgentTask, CodeTask, VocabTask, InspectTask, TraceTask,
]);
export type Task = z.infer<typeof Task>;
export type TaskKind = Task['kind'];

export const Figure = z.enum([
  'agent-loop', 'test-anatomy', 'manual-vs-auto', 'dom-tree', 'review-checklist', 'red-green',
  'locator-priority', 'actionability', 'flaky-causes', 'test-agents', 'page-object', 'fixture-lifecycle',
  'http-exchange', 'ui-vs-api', 'ci-pipeline', 'review-gates',
]);

export const Step = z.discriminatedUnion('type', [
  z.object({ type: z.literal('story'), lines: z.array(Line).min(1) }).strict(),
  z.object({ type: z.literal('pretest'), intro: T.optional(), items: z.array(Task).min(1).max(3) }).strict(),
  z.object({
    type: z.literal('theory'),
    keyPoint: z.string().optional(),
    title: T.optional(),
    body: z.array(T).min(1),
    code: z.string().optional(),
    figure: Figure.optional(),
    mentor: T.optional(),
  }).strict(),
  z.object({
    type: z.literal('example'),
    keyPoint: z.string().optional(),
    title: T.optional(),
    intro: T.optional(),
    code: z.string(),
    notes: z.array(z.object({ lines: z.union([z.number().int(), z.array(z.number().int())]), text: T }).strict()).min(1),
    app: AppConfig.optional(),
    files: Files.optional(),
    runnable: z.boolean().optional(),
    /** with runnable: also offer "Run ×N" (to show a flaky test) */
    repeat: z.number().int().min(2).max(20).optional(),
  }).strict(),
  z.object({
    type: z.literal('inspect'),
    keyPoint: z.string().optional(),
    title: T.optional(),
    intro: T.optional(),
    app: AppConfig.optional(),
    /** CSS selector of the element selected at start */
    focus: z.string().optional(),
    view: InspectView.optional(),
    mentor: T.optional(),
  }).strict(),
  z.object({
    type: z.literal('trace'),
    keyPoint: z.string().optional(),
    title: T.optional(),
    intro: T.optional(),
    code: z.string(),
    app: AppConfig.optional(),
    files: Files.optional(),
    mentor: T.optional(),
  }).strict(),
  z.object({
    type: z.literal('mapping'),
    keyPoint: z.string().optional(),
    title: T.optional(),
    intro: T.optional(),
    testCase: TestCase,
    code: z.string(),
    links: z.array(z.object({ from: z.string().regex(/^[se]\d+$/), lines: z.array(z.number().int()) }).strict()).min(1),
  }).strict(),
  z.object({ type: z.literal('task'), task: Task }).strict(),
  z.object({
    type: z.literal('mistakes'),
    keyPoint: z.string().optional(),
    title: T.optional(),
    items: z.array(z.object({ wrong: z.string(), right: z.string(), why: T }).strict()).min(1),
  }).strict(),
  z.object({ type: z.literal('explain'), keyPoint: z.string().optional(), prompt: T, model: T }).strict(),
  z.object({
    type: z.literal('phrases'),
    items: z.array(z.object({
      context: z.enum(['standup', 'code-review', 'bug-report', 'chat', 'meeting', 'prompt']),
      en: z.string(),
      ru: z.string(),
      note: T.optional(),
    }).strict()).min(3),
  }).strict(),
]);
export type Step = z.infer<typeof Step>;

export const Lesson = z.object({
  id: z.string().regex(/^c\d+-l\d+$/),
  chapter: z.string().regex(/^c\d+$/),
  title: T,
  goal: T,
  minutes: z.number().int().min(3).max(15),
  keyPoints: z.array(z.object({ id: z.string().regex(/^kp-[a-z0-9-]+$/), title: T }).strict()).min(1).max(5),
  terms: z.array(z.string()).min(3).max(12),
  steps: z.array(Step).min(5),
  checkPool: z.array(Task).min(6),
}).strict();
export type Lesson = z.infer<typeof Lesson>;

export const Chapter = z.object({
  id: z.string().regex(/^c\d+$/),
  number: z.number().int(),
  status: z.enum(['ready', 'planned']),
  title: T,
  department: T,
  summary: T,
  color: z.enum(['lavender', 'rose', 'peach', 'mint', 'sky', 'butter']),
  intro: z.array(Line).optional(),
  outro: z.array(Line).optional(),
  lessons: z.array(z.string()).optional(),
  boss: z.object({ id: z.string(), title: T, story: z.array(Line), tasks: z.array(Task).min(1).max(4) }).strict().optional(),
  plan: z.array(z.object({ title: T, goal: T, keyPoints: z.array(T) }).strict()).optional(),
}).strict();
export type Chapter = z.infer<typeof Chapter>;

export const GlossaryEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  en: z.string(),
  ipa: z.string(),
  ru: z.string(),
  pos: z.string().optional(),
  def: T,
  example: T,
  context: z.enum(['standup', 'code-review', 'bug-report', 'chat', 'meeting', 'prompt', 'general']).optional(),
  chapter: z.number().int(),
}).strict();
export type GlossaryEntry = z.infer<typeof GlossaryEntry>;

export const PhraseSituations = [
  'greeting', 'welcomeBack', 'pretestIntro', 'correct', 'wrong', 'wrongAgain', 'hintOffer',
  'testGreen', 'testRed', 'lessonDone', 'chapterDone', 'levelUp', 'streak', 'badge',
  'checkPassed', 'checkFailed', 'warmupStart', 'progress', 'bossIntro',
] as const;
export type PhraseSituation = (typeof PhraseSituations)[number];
export const Phrases = z.object(
  Object.fromEntries(PhraseSituations.map((s) => [s, z.array(T).min(30)])) as Record<PhraseSituation, z.ZodArray<typeof T>>,
).strict();

export const Interview = z.object({
  questions: z.array(z.object({
    id: z.string(),
    topic: z.enum(['basics', 'playwright', 'locators', 'assertions', 'flaky', 'architecture', 'api', 'ai', 'ci', 'behavioral']),
    q: T,
    a: T,
    tip: T.optional(),
  }).strict()).min(10),
}).strict();
