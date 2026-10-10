export const SPEC_FILE = 'test_example.py';

export type StepCategory = 'pw:api' | 'expect' | 'test.step' | 'hook' | 'fixture';

export interface StepRecord {
  id: number;
  title: string;
  category: StepCategory;
  line?: number;
  file?: string;
  status: 'running' | 'passed' | 'failed';
  duration: number;
  error?: string;
  children: StepRecord[];
}

/** Error shown in the report. `message` mimics Playwright output; `code` keys the bilingual explanation. */
export interface ErrorInfo {
  code: string;
  message: string;
  data: Record<string, string | number>;
  line?: number;
  file?: string;
  /** when the error happened in another file: the line of the test file that led there */
  specLine?: number;
  emulatorNote?: boolean;
}

export interface TestResult {
  title: string;
  /** [file, Class?, test name] */
  titlePath: string[];
  /** pytest node id: test_example.py::TestLogin::test_ok[anna] */
  nodeid: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration: number;
  steps: StepRecord[];
  error?: ErrorInfo;
  softErrors: ErrorInfo[];
  logs: string[];
  /** pytest outcome label when it differs from status: XFAIL, XPASS, ERROR (setup/teardown) */
  label?: string;
  skipReason?: string;
  phase?: 'setup' | 'teardown';
}

export interface StaticFinding {
  rule: string;
  line?: number;
  data?: Record<string, string | number>;
}

export interface RunResult {
  status: 'passed' | 'failed' | 'error' | 'aborted';
  tests: TestResult[];
  duration: number;
  /** File-level error (syntax error, error while collecting tests). */
  error?: ErrorInfo;
  logs: string[];
  findings: StaticFinding[];
  mode: 'spec' | 'script';
}

export type RunEvent =
  | { type: 'test-start'; title: string; index: number; total: number }
  | { type: 'step-start'; step: StepRecord }
  | { type: 'step-end'; step: StepRecord }
  | { type: 'line'; line: number | null }
  | { type: 'navigate'; url: string }
  | { type: 'highlight'; label: string }
  | { type: 'log'; text: string }
  | { type: 'paused'; title: string; line?: number }
  | { type: 'test-end'; result: TestResult }
  | { type: 'done'; result: RunResult };
