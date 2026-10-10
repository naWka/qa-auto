import { useEffect, useMemo, useState } from 'react';
import type { GlossaryEntry, Task } from '../content/schema';
import { glossary, studyTerms } from '../content';
import { Bi, U, useLang } from '../components/Bi';
import { ListenButton } from '../components/Listen';
import { MatchBoard } from './MatchTask';
import { shuffle, type KindProps, type Registration } from './types';

type Vocab = Extract<Task, { kind: 'vocab' }>;

/** Russian translation for quizzes: drops the English in brackets ("проверка (assertion)" → "проверка"), which gives the answer away. */
export function quizRu(e: GlossaryEntry): string {
  const ru = e.ru.replace(/\s*\([^()]*[A-Za-z][^()]*\)/g, '').trim();
  return ru || e.ru;
}

export function distractors(entry: GlossaryEntry, n = 3): GlossaryEntry[] {
  const others = [...glossary.values()].filter((e) => e.id !== entry.id);
  const studied = others.filter((e) => studyTerms.has(e.id));
  const all = studied.length >= n ? studied : others;
  const near = all.filter((e) => Math.abs(e.chapter - entry.chapter) <= 1);
  return shuffle(near.length >= n ? near : all).slice(0, n);
}

/** A single-choice card among text options; shared with the review session. */
export function OptionCard({ prompt, options, answer, register, phase, speakText, sentence }: {
  prompt: React.ReactNode;
  options: string[];
  answer: string;
  register: (r: Registration) => void;
  phase: string;
  /** English text with a listen button next to the prompt */
  speakText?: string;
  sentence?: React.ReactNode;
}) {
  const order = useMemo(() => shuffle(options), [options.join('|')]);
  const [sel, setSel] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const done = phase === 'correct' || phase === 'revealed' || phase === 'final' || revealed;
  useEffect(() => {
    register({ canCheck: !!sel, check: () => ({ correct: sel === answer }), reveal: () => setRevealed(true) });
  });
  return (
    <div className="vocab-card">
      <div className="vocab-prompt">
        {prompt}
        {speakText && <ListenButton text={speakText} />}
      </div>
      {sentence}
      <div className="vocab-options">
        {order.map((o) => {
          const state = done && o === answer ? 'opt-correct' : (phase === 'wrong' || done) && o === sel && o !== answer ? 'opt-wrong' : '';
          return (
            <button key={o} type="button" className={`vocab-opt ${sel === o ? 'opt-selected' : ''} ${state}`} onClick={() => !done && setSel(o)} disabled={done && o !== answer && o !== sel}>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function VocabTask({ task, register, phase }: KindProps<Vocab>) {
  const { lang } = useLang();
  if (task.mode === 'match' && task.terms) {
    const pairs = task.terms.map((id) => glossary.get(id)).filter(Boolean).map((e) => ({ left: e!.en, right: quizRu(e!) }));
    return <MatchBoard spec={{ id: task.id, pairs }} register={register} phase={phase} />;
  }
  if (task.mode === 'cloze' && task.sentence && task.answer && task.options) {
    const [before, after] = task.sentence.en.split('___');
    return (
      <OptionCard
        prompt={<U k="review.cloze" stack={false} />}
        sentence={
          <div className="cloze">
            <p className="cloze-en">{before}<span className="cloze-gap">____</span>{after}</p>
            {lang !== 'en' && <p className="cloze-ru">{task.sentence.ru}</p>}
          </div>
        }
        options={task.options}
        answer={task.answer}
        register={register}
        phase={phase}
      />
    );
  }
  const entry = task.term ? glossary.get(task.term) : undefined;
  if (!entry) return <div className="muted">—</div>;
  return <TranslateCard entry={entry} enToRu={task.direction !== 'ru-en'} register={register} phase={phase} />;
}

export function TranslateCard({ entry, enToRu, register, phase }: { entry: GlossaryEntry; enToRu: boolean; register: (r: Registration) => void; phase: string }) {
  const ds = useMemo(() => distractors(entry), [entry.id]);
  return (
    <OptionCard
      prompt={enToRu ? (
        <div className="vocab-term"><span className="term-word">{entry.en}</span><span className="term-ipa">{entry.ipa}</span></div>
      ) : (
        <div className="vocab-term"><span className="term-word">{quizRu(entry)}</span></div>
      )}
      speakText={enToRu ? entry.en : undefined}
      sentence={<div className="vocab-ask"><U k={enToRu ? 'review.translate' : 'review.translateBack'} stack={false} /></div>}
      options={enToRu ? [quizRu(entry), ...ds.map(quizRu)] : [entry.en, ...ds.map((d) => d.en)]}
      answer={enToRu ? quizRu(entry) : entry.en}
      register={register}
      phase={phase}
    />
  );
}

export function TermExample({ entry }: { entry: GlossaryEntry }) {
  return <Bi t={entry.example} size="sm" />;
}
