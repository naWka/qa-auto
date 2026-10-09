// Renderers for non-task lesson steps.
import { useState } from 'react';
import type { Step, Lesson } from '../content/schema';
import { glossary, uiText } from '../content';
import { Bi, BiInline, BiParas, U, useUiString } from '../components/Bi';
import { CodeView } from '../components/CodeView';
import { Dialogue, Mentor } from '../components/Mentor';
import { TestCaseCard } from '../components/Common';
import { Icon } from '../components/Icon';
import { speak } from '../components/TermLayer';
import { RunCompleted } from '../tasks/RunCompleted';
import { useProgress } from '../store/progress';
import { Figure } from './Figures';

type S<K extends Step['type']> = Extract<Step, { type: K }>;

export function StepLabel({ k, icon }: { k: string; icon: string }) {
  return <div className="step-label"><Icon name={icon} size={15} /> <U k={k} stack={false} /></div>;
}

export function StoryStep({ step }: { step: S<'story'> }) {
  return (
    <div className="step-story">
      <StepLabel k="lesson.story" icon="chat" />
      <Dialogue lines={step.lines} />
    </div>
  );
}

export function TheoryStep({ step }: { step: S<'theory'> }) {
  return (
    <div className="step-theory">
      {step.title && <h2 className="step-title"><BiInline t={step.title} /></h2>}
      <BiParas items={step.body} />
      {step.figure && <Figure id={step.figure} />}
      {step.code && <CodeView code={step.code} />}
      {step.mentor && <Mentor t={step.mentor} mood="idle" compact />}
    </div>
  );
}

export function ExampleStep({ step }: { step: S<'example'> }) {
  const [active, setActive] = useState(0);
  const note = step.notes[active];
  const lines = note ? (Array.isArray(note.lines) ? note.lines : [note.lines]) : [];
  return (
    <div className="step-example">
      <StepLabel k="lesson.example" icon="book" />
      {step.title && <h2 className="step-title"><BiInline t={step.title} /></h2>}
      {step.intro && <Bi t={step.intro} />}
      <div className="example-grid">
        <CodeView code={step.code} highlight={lines} onLineClick={(n) => {
          const i = step.notes.findIndex((x) => (Array.isArray(x.lines) ? x.lines : [x.lines]).includes(n));
          if (i >= 0) setActive(i);
        }} />
        <div className="example-notes">
          {step.notes.map((x, i) => (
            <button key={i} type="button" className={`example-note ${i === active ? 'active' : ''}`} onClick={() => setActive(i)}>
              <span className="note-lines">{(Array.isArray(x.lines) ? x.lines : [x.lines]).length > 1 ? `${(x.lines as number[])[0]}–${(x.lines as number[]).slice(-1)[0]}` : String(Array.isArray(x.lines) ? x.lines[0] : x.lines)}</span>
              <Bi t={x.text} size="sm" />
            </button>
          ))}
          <div className="example-nav">
            <button className="btn btn-soft btn-sm" disabled={active === 0} onClick={() => setActive(active - 1)}><Icon name="chevronLeft" size={14} /></button>
            <span>{active + 1} / {step.notes.length}</span>
            <button className="btn btn-soft btn-sm" disabled={active >= step.notes.length - 1} onClick={() => setActive(active + 1)}><Icon name="chevronRight" size={14} /></button>
          </div>
        </div>
      </div>
      {step.runnable && <RunCompleted code={step.code} app={step.app} />}
    </div>
  );
}

export function MappingStep({ step }: { step: S<'mapping'> }) {
  const [active, setActive] = useState<string | null>(step.links[0]?.from ?? null);
  const lines = step.links.filter((l) => l.from === active).flatMap((l) => l.lines);
  return (
    <div className="step-mapping">
      <StepLabel k="lesson.mapping" icon="repeat" />
      {step.title && <h2 className="step-title"><BiInline t={step.title} /></h2>}
      {step.intro && <Bi t={step.intro} />}
      <div className="mapping-hint"><U k="lesson.hoverMapping" stack={false} /></div>
      <div className="mapping-grid">
        <TestCaseCard tc={step.testCase} active={active} onHover={(k) => k && setActive(k)} />
        <CodeView code={step.code} highlight={lines} className={active?.startsWith('e') ? 'hl-expect' : ''} />
      </div>
    </div>
  );
}

export function MistakesStep({ step }: { step: S<'mistakes'> }) {
  return (
    <div className="step-mistakes">
      <StepLabel k="lesson.mistakes" icon="bug" />
      {step.title && <h2 className="step-title"><BiInline t={step.title} /></h2>}
      <div className="mistakes">
        {step.items.map((m, i) => (
          <div key={i} className="mistake">
            <div className="mistake-pair">
              <div className="mistake-wrong"><span className="mk-label"><Icon name="x" size={13} strokeWidth={2.6} /> <U k="lesson.wrong" stack={false} /></span><CodeView code={m.wrong} numbers={false} /></div>
              <div className="mistake-right"><span className="mk-label"><Icon name="check" size={13} strokeWidth={2.6} /> <U k="lesson.right" stack={false} /></span><CodeView code={m.right} numbers={false} /></div>
            </div>
            <Bi t={m.why} size="sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExplainStep({ step, lessonId, onReady }: { step: S<'explain'>; lessonId: string; onReady: () => void }) {
  const saved = useProgress((s) => s.explanations[lessonId]);
  const save = useProgress((s) => s.saveExplanation);
  const [text, setText] = useState(saved || '');
  const [shown, setShown] = useState(!!saved);
  const [rated, setRated] = useState<string | null>(null);
  const s = useUiString();
  return (
    <div className="step-explain">
      <StepLabel k="lesson.explainTitle" icon="chat" />
      <div className="task-prompt"><Bi t={step.prompt} size="lg" /></div>
      <textarea className="text-area" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={s('lesson.explainPlaceholder')} />
      {!shown ? (
        <button className="btn btn-soft" disabled={text.trim().length < 10} onClick={() => { setShown(true); save(lessonId, text.trim()); }}>
          <Icon name="eye" size={16} /> <U k="lesson.showModel" stack={false} />
        </button>
      ) : (
        <>
          <div className="model-answer">
            <div className="explain-label"><Icon name="sparkle" size={15} /> <U k="lesson.modelAnswer" stack={false} /></div>
            <Bi t={step.model} />
          </div>
          <div className="self-rate">
            {(['selfGotIt', 'selfPartly', 'selfMissed'] as const).map((k) => (
              <button key={k} className={`chip-btn ${rated === k ? 'on' : ''}`} onClick={() => { setRated(k); onReady(); }}>
                <BiInline t={uiText(`lesson.${k}`)} stack={false} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PhrasesStep({ step }: { step: S<'phrases'> }) {
  return (
    <div className="step-phrases">
      <StepLabel k="lesson.phrases" icon="chat" />
      <div className="phrases">
        {step.items.map((p, i) => (
          <div key={i} className="phrase">
            <span className={`ctx-chip ctx-${p.context}`}><BiInline t={uiText(`context.${p.context}`)} stack={false} /></span>
            <div className="phrase-body">
              <Bi t={{ en: p.en, ru: p.ru }} />
              {p.note && <div className="phrase-note"><Bi t={p.note} size="sm" /></div>}
            </div>
            <button className="icon-btn" onClick={() => speak(p.en)} aria-label="Listen"><Icon name="volume" size={18} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VocabStep({ lesson }: { lesson: Lesson }) {
  return (
    <div className="step-vocab">
      <StepLabel k="lesson.vocab" icon="book" />
      <div className="vocab-list">
        {lesson.terms.map((id) => {
          const e = glossary.get(id);
          if (!e) return null;
          return (
            <div key={id} className="vocab-row">
              <button className="icon-btn" onClick={() => speak(e.en)} aria-label="Listen"><Icon name="volume" size={18} /></button>
              <div className="vocab-main">
                <div><button type="button" className="term" data-term={e.id}>{e.en}</button> <span className="term-ipa">{e.ipa}</span></div>
                <div className="vocab-ru">{e.ru}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted small"><Icon name="repeat" size={14} /> <U k="lesson.vocabNote" stack={false} /></div>
    </div>
  );
}
