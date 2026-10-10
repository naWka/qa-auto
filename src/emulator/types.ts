export const SPEC_FILE = 'example.spec.js';

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
  emulatorNote?: boolean;
}

export interface TestResult {
  title: string;
  titlePath: string[];
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration: number;
  steps: StepRecord[];
  error?: ErrorInfo;
  softErrors: ErrorInfo[];
  logs: string[];
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
