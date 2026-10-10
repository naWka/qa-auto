// Per-test runtime: step recording, pacing (speed / step-by-step), await tracking.
import { ClosedError, EmuError, callerLocation } from './errors';
import type { ErrorInfo, RunEvent, StepCategory, StepRecord } from './types';

export interface Pacing {
  /** Delay (ms) after highlighting an element, before acting on it. */
  speed: number;
  stepMode: boolean;
}

/** Shared between all tests of one run; owned by the UI. */
export class RunController {
  pacing: Pacing;
  aborted = false;
  /** Trace recording: the page marks the element each action targets and emits 'highlight'. */
  trace = false;
  private waiters: Array<() => void> = [];
  private emitFn: (e: RunEvent) => void;

  constructor(pacing: Pacing, emit: (e: RunEvent) => void = () => {}) {
    this.pacing = pacing;
    this.emitFn = emit;
  }
  emit(e: RunEvent) {
    try { this.emitFn(e); } catch { /* UI errors must not break the run */ }
  }
  /** Resolves the current "Next step" wait in step mode. */
  next() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }
  setStepMode(on: boolean) {
    this.pacing.stepMode = on;
    if (!on) this.next();
  }
  abort() {
    this.aborted = true;
    this.next();
  }
  waitNext(): Promise<void> {
    return new Promise((r) => this.waiters.push(r));
  }
}

interface Tracked {
  title: string;
  line?: number;
  file?: string;
  awaited: boolean;
}

/** A thenable (not a Promise!) so that `await` calls our `then` and we can detect missing awaits. */
export class Pending<T> implements PromiseLike<T> {
  private p: Promise<T>;
  private rec: Tracked;
  constructor(p: Promise<T>, rec: Tracked) {
    this.p = p;
    this.rec = rec;
    p.catch(() => {});
  }
  then<A = T, B = never>(onOk?: ((v: T) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    this.rec.awaited = true;
    return this.p.then(onOk, onErr);
  }
  catch<B = never>(onErr?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<T | B> {
    this.rec.awaited = true;
    return this.p.catch(onErr);
  }
  finally(f?: (() => void) | null): Promise<T> {
    this.rec.awaited = true;
    return this.p.finally(f);
  }
  get [Symbol.toStringTag]() {
    return 'Promise';
  }
}

let stepIds = 0;

export class TestRuntime {
  ctl: RunController;
  steps: StepRecord[] = [];
  parents: StepRecord[] = [];
  tracked: Tracked[] = [];
  closed = false;
  softErrors: ErrorInfo[] = [];
  logs: string[] = [];
  readonly actionTimeout = 5000;
  readonly expectTimeout = 5000;
  readonly navigationTimeout = 10000;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private sleepers = new Set<(e: Error) => void>();

  constructor(ctl: RunController) {
    this.ctl = ctl;
  }

  checkAlive() {
    if (this.closed || this.ctl.aborted) throw new ClosedError();
  }

  sleep(ms: number): Promise<void> {
    this.checkAlive();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.sleepers.delete(reject);
        resolve();
      }, ms);
      this.timers.add(t);
      this.sleepers.add(reject);
    });
  }

  close() {
    this.closed = true;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    const err = new ClosedError();
    this.sleepers.forEach((r) => r(err));
    this.sleepers.clear();
  }

  /** Pause between steps: speed delay and "Next step" gate. */
  async pace(title: string, line?: number) {
    this.checkAlive();
    if (this.ctl.pacing.stepMode) {
      this.ctl.emit({ type: 'paused', title, line });
      await this.ctl.waitNext();
      this.checkAlive();
    } else if (this.ctl.pacing.speed > 0) {
      await this.sleep(this.ctl.pacing.speed);
    }
  }

  startStep(title: string, category: StepCategory, line?: number, file?: string, specLine?: number): StepRecord {
    const step: StepRecord = { id: ++stepIds, title, category, line, file, status: 'running', duration: 0, children: [] };
    const parent = this.parents[this.parents.length - 1];
    (parent ? parent.children : this.steps).push(step);
    const highlight = specLine ?? (file ? undefined : line);
    if (highlight !== undefined) this.ctl.emit({ type: 'line', line: highlight });
    this.ctl.emit({ type: 'step-start', step });
    return step;
  }

  endStep(step: StepRecord, started: number, error?: unknown) {
    step.duration = Math.round(performance.now() - started);
    step.status = error ? 'failed' : 'passed';
    if (error) step.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
    this.ctl.emit({ type: 'step-end', step });
  }

  /** Runs an API call as a recorded step and returns a tracked thenable. */
  api<T>(title: string, category: StepCategory, loc: { line: number; file: string } | undefined, fn: (step: StepRecord) => Promise<T>): Pending<T> {
    const rec: Tracked = { title, line: loc?.line, file: loc?.file, awaited: false };
    this.tracked.push(rec);
    const specLine = loc?.file === SPEC ? loc.line : callerLocation(SPEC)?.line;
    const run = async () => {
      this.checkAlive();
      const started = performance.now();
      const step = this.startStep(title, category, loc?.line, loc && loc.file !== SPEC ? loc.file : undefined, specLine);
      try {
        const v = await fn(step);
        this.endStep(step, started);
        return v;
      } catch (e) {
        this.endStep(step, started, e);
        if (e instanceof EmuError && e.line === undefined && loc) {
          e.line = loc.line;
          e.file = loc.file;
        }
        throw e;
      }
    };
    return new Pending(run(), rec);
  }

  /** Steps that run nested children (test.step, hooks). */
  async group<T>(title: string, category: StepCategory, line: number | undefined, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const step = this.startStep(title, category, line);
    this.parents.push(step);
    try {
      const v = await fn();
      this.parents.pop();
      this.endStep(step, started);
      return v;
    } catch (e) {
      this.parents.pop();
      this.endStep(step, started, e);
      throw e;
    }
  }

  unawaited(): Tracked | undefined {
    return this.tracked.find((t) => !t.awaited);
  }

  log(text: string) {
    this.logs.push(text);
    this.ctl.emit({ type: 'log', text });
  }
}

export const SPEC = 'test_example.py';
