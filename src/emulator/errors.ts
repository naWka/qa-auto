import type { ErrorInfo } from './types';

/** An error raised by the emulator. Message text follows Playwright's wording. */
export class EmuError extends Error {
  code: string;
  data: Record<string, string | number>;
  line?: number;
  file?: string;
  emulatorNote?: boolean;

  constructor(code: string, message: string, data: Record<string, string | number> = {}, opts: { line?: number; file?: string; emulatorNote?: boolean } = {}) {
    super(message);
    this.name = 'Error';
    this.code = code;
    this.data = data;
    this.line = opts.line;
    this.file = opts.file;
    this.emulatorNote = opts.emulatorNote;
  }
}

/** Thrown into pending operations when a test finishes or the run is aborted. */
export class ClosedError extends EmuError {
  constructor() {
    super('closed', 'Target page, context or browser has been closed', {});
  }
}

export function toErrorInfo(e: unknown, fallbackLine?: number): ErrorInfo {
  if (e instanceof EmuError) {
    return { code: e.code, message: e.message, data: e.data, line: e.line ?? fallbackLine, file: e.file, emulatorNote: e.emulatorNote };
  }
  if (e instanceof Error) {
    const loc = locationFromStack(e.stack || '');
    const line = loc?.line ?? fallbackLine;
    if (e.name === 'ReferenceError') {
      const m = e.message.match(/^(?:Can't find variable: )?([\w$]+)(?: is not defined)?$/);
      return { code: 'reference', message: `ReferenceError: ${e.message}`, data: { name: m ? m[1] : e.message }, line, file: loc?.file };
    }
    if (e.name === 'TypeError') {
      const m = e.message.match(/([\w$.()'\s]+?)\.([\w$]+) is not a function/);
      if (m) return { code: 'not-a-function', message: `TypeError: ${e.message}`, data: { target: m[1].trim(), method: m[2] }, line, file: loc?.file };
      const u = e.message.match(/Cannot read properties of (undefined|null) \(reading '([^']+)'\)|(\w+) is undefined|undefined is not an object/);
      if (u) return { code: 'read-undefined', message: `TypeError: ${e.message}`, data: { prop: u[2] || '' }, line, file: loc?.file };
      return { code: 'type-error', message: `TypeError: ${e.message}`, data: {}, line, file: loc?.file };
    }
    return { code: 'unknown', message: `${e.name}: ${e.message}`, data: { stack: (e.stack || '').split('\n').slice(0, 12).join('\n') }, line, file: loc?.file };
  }
  return { code: 'unknown', message: `Error: ${String(e)}`, data: {}, line: fallbackLine };
}

// Line offset added by the wrapper that evaluates student code (see runner.ts).
export const WRAPPER_LINES = 1;
let knownFiles: string[] = [];
export function setKnownFiles(files: string[]) {
  knownFiles = files;
}

/** Finds the first frame in a stack that belongs to student files (sourceURL). */
export function locationFromStack(stack: string, onlyFile?: string): { file: string; line: number; col: number } | undefined {
  const files = onlyFile ? [onlyFile] : knownFiles;
  let best: { file: string; line: number; col: number; idx: number } | undefined;
  for (const f of files) {
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ':(\\d+):(\\d+)');
    const m = re.exec(stack);
    if (m && (!best || m.index < best.idx)) best = { file: f, line: Number(m[1]) - WRAPPER_LINES, col: Number(m[2]), idx: m.index };
  }
  return best && { file: best.file, line: best.line, col: best.col };
}

/** Location of the student's code that called the current API method. */
export function callerLocation(onlyFile?: string) {
  return locationFromStack(new Error().stack || '', onlyFile);
}
