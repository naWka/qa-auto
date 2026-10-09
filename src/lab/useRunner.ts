import { useCallback, useEffect, useRef, useState } from 'react';
import { RunController, runSpec, type AppSetup, type RunResult, type StepRecord } from '../emulator';
import { useSettings } from '../store/settings';
import { useProgress } from '../store/progress';

export const AUT_DIR = `${import.meta.env.BASE_URL}aut/`;

export interface LiveState {
  running: boolean;
  testTitle?: string;
  testIndex?: number;
  testTotal?: number;
  steps: StepRecord[];
  paused: { title: string; line?: number } | null;
  runLine: number | null;
  url: string;
  result: RunResult | null;
  stepMode: boolean;
}

export interface RunArgs {
  code: string;
  app?: AppSetup;
  files?: Record<string, string>;
  mode?: 'spec' | 'script';
  /** silent runs (grading against a second app version) don't count as user runs */
  silent?: boolean;
  fast?: boolean;
}

export function useRunner(frame: React.RefObject<HTMLIFrameElement | null>) {
  const speed = useSettings((s) => s.speed);
  const bumpStat = useProgress((s) => s.bumpStat);
  const ctlRef = useRef<RunController | null>(null);
  const [stepMode, setStepModeState] = useState(false);
  const [live, setLive] = useState<LiveState>({ running: false, steps: [], paused: null, runLine: null, url: 'about:blank', result: null, stepMode: false });

  const run = useCallback(async (args: RunArgs): Promise<RunResult> => {
    ctlRef.current?.abort();
    const ctl = new RunController({ speed: args.fast ? 0 : speed, stepMode: args.fast ? false : stepMode }, (e) => {
      switch (e.type) {
        case 'test-start': setLive((s) => ({ ...s, testTitle: e.title, testIndex: e.index, testTotal: e.total, steps: [], paused: null })); break;
        case 'step-start': setLive((s) => ({ ...s, paused: null, steps: [...s.steps.filter((x) => x.id !== e.step.id), { ...e.step }] })); break;
        case 'step-end': setLive((s) => ({ ...s, steps: s.steps.map((x) => (x.id === e.step.id ? { ...e.step } : x)) })); break;
        case 'line': setLive((s) => ({ ...s, runLine: e.line })); break;
        case 'navigate': setLive((s) => ({ ...s, url: e.url })); break;
        case 'paused': setLive((s) => ({ ...s, paused: { title: e.title, line: e.line }, runLine: e.line ?? s.runLine })); break;
      }
    });
    ctlRef.current = ctl;
    setLive((s) => ({ ...s, running: true, steps: [], paused: null, result: null, runLine: null, testTitle: undefined }));
    const result = await runSpec({
      code: args.code,
      files: args.files,
      mode: args.mode,
      app: args.app,
      frame: frame.current,
      controller: ctl,
      autDir: AUT_DIR,
      onUrl: (url) => setLive((s) => ({ ...s, url })),
    });
    if (ctlRef.current === ctl) {
      ctlRef.current = null;
      setLive((s) => ({ ...s, running: false, paused: null, runLine: null, result }));
    }
    if (!args.silent && result.status !== 'aborted') {
      bumpStat('runs');
      if (result.status === 'passed') bumpStat('green');
      else bumpStat('red');
    }
    return result;
  }, [frame, speed, stepMode, bumpStat]);

  const stop = useCallback(() => ctlRef.current?.abort(), []);
  const next = useCallback(() => ctlRef.current?.next(), []);
  const setStepMode = useCallback((on: boolean) => {
    setStepModeState(on);
    ctlRef.current?.setStepMode(on);
    setLive((s) => ({ ...s, stepMode: on }));
  }, []);
  const clear = useCallback(() => setLive((s) => ({ ...s, result: null, steps: [], runLine: null })), []);

  useEffect(() => {
    if (ctlRef.current) ctlRef.current.pacing.speed = speed;
  }, [speed]);
  useEffect(() => () => ctlRef.current?.abort(), []);

  return { live: { ...live, stepMode }, run, stop, next, setStepMode, clear };
}
