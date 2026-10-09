// CodeMirror 6 editor in the pastel theme, with Playwright autocompletion and run/error line marks.
import { useEffect, useRef } from 'react';
import { EditorState, Compartment, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { playwrightCompletions } from './completions';

const pastelHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--tok-keyword)', fontWeight: '500' },
  { tag: [t.string, t.special(t.string)], color: 'var(--tok-string)' },
  { tag: t.regexp, color: 'var(--tok-regexp)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tok-function)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--tok-number)' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--tok-comment)', fontStyle: 'italic' },
  { tag: t.propertyName, color: 'var(--tok-property)' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--tok-punct)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--tok-variable)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--code-bg)', color: 'var(--tok-variable)', fontSize: '14px', borderRadius: 'var(--r-s)', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '10px 0', caretColor: 'var(--lavender-strong)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--code-gutter)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--lavender-strong)' },
  '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--lavender) 35%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--lavender-strong)', borderLeftWidth: '2px' },
  '.cm-run-line': { backgroundColor: 'var(--code-run)', boxShadow: 'inset 3px 0 0 var(--rose-strong)' },
  '.cm-error-line': { backgroundColor: 'var(--code-error)', boxShadow: 'inset 3px 0 0 var(--coral-strong)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '12px', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li': { fontFamily: 'var(--font-mono)', fontSize: '13px', padding: '3px 10px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--lavender-soft)', color: 'var(--ink)' },
  '.cm-completionDetail': { color: 'var(--ink-3)', fontStyle: 'normal', marginLeft: '2px' },
  '.cm-matchingBracket': { backgroundColor: 'var(--lavender-soft)', outline: '1px solid var(--lavender)' },
});

const setMarks = StateEffect.define<{ run: number | null; error: number | null }>();
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue;
      const ranges = [];
      const doc = tr.state.doc;
      if (e.value.error && e.value.error <= doc.lines) ranges.push(Decoration.line({ class: 'cm-error-line' }).range(doc.line(e.value.error).from));
      if (e.value.run && e.value.run <= doc.lines && e.value.run !== e.value.error) ranges.push(Decoration.line({ class: 'cm-run-line' }).range(doc.line(e.value.run).from));
      ranges.sort((a, b) => a.from - b.from);
      deco = Decoration.set(ranges);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface CodeEditorProps {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  runLine?: number | null;
  errorLine?: number | null;
  minHeight?: number;
  ariaLabel?: string;
}

export function CodeEditor({ value, onChange, readOnly = false, runLine = null, errorLine = null, minHeight = 220, ariaLabel = 'Code editor' }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ro = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      javascript(),
      syntaxHighlighting(pastelHighlight),
      autocompletion({ override: [playwrightCompletions], icons: false }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      theme,
      marksField,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      ro.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
      }),
    ];
    view.current = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current! });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setMarks.of({ run: runLine, error: errorLine }) });
    const line = runLine ?? errorLine;
    if (line && line <= v.state.doc.lines) {
      v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(line).from, { y: 'nearest' }) });
    }
  }, [runLine, errorLine]);

  return <div className="code-editor" ref={host} style={{ minHeight }} />;
}
