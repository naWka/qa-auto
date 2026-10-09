import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lesson, Step } from '../content/schema';
import { lessons, chapterById, lessonsOf } from '../content';
import { Bi, BiInline, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Mentor } from '../components/Mentor';
import { TaskShell, type TaskOutcome } from '../tasks/TaskShell';
import { ExampleStep, ExplainStep, MappingStep, MistakesStep, PhrasesStep, StepLabel, StoryStep, TheoryStep, VocabStep } from '../lesson/Steps';
import { useProgress } from '../store/progress';
import { pickPhrase } from '../engine/phrases';
import { dueCount } from '../engine/plan';
import { navigate } from '../lib/router';
import { hearts } from '../lib/celebrate';
import { today } from '../lib/dates';

type Item = { kind: 'step'; step: Step; index: number } | { kind: 'vocab' };

function buildItems(lesson: Lesson, focus: string[] | null): Item[] {
  const items: Item[] = [];
  lesson.steps.forEach((step, index) => {
    if (focus) {
      const kp = step.type === 'task' ? step.task.keyPoint : 'keyPoint' in step ? (step as { keyPoint?: string }).keyPoint : undefined;
      if (!kp || !focus.includes(kp)) return;
    }
    items.push({ kind: 'step', step, index });
  });
  items.push({ kind: 'vocab' });
  return items;
}

function PretestStep({ step, onDone }: { step: Extract<Step, { type: 'pretest' }>; onDone: () => void }) {
  const [i, setI] = useState(0);
  const intro = useMemo(() => step.intro ?? pickPhrase('pretestIntro'), [step]);
  const item = step.items[i];
  return (
    <div className="step-pretest">
      <StepLabel k="lesson.pretest" icon="crystal" />
      <Mentor t={intro} mood="think" compact />
      <TaskShell key={item.id} task={item} mode="review" onContinue={() => (i + 1 < step.items.length ? setI(i + 1) : onDone())} />
    </div>
  );
}

export function LessonPage({ id, focus }: { id: string; focus: string[] | null }) {
  const lesson = lessons.get(id);
  const p = useProgress();
  const saved = p.lessons[id];
  const items = useMemo(() => (lesson ? buildItems(lesson, focus) : []), [id, focus?.join(',')]);
  const startAt = !focus && saved?.status === 'in-progress' && saved.step && saved.step < items.length ? saved.step : 0;
  const [i, setI] = useState(startAt);
  const [gate, setGate] = useState<Record<number, boolean>>({});
  const [finished, setFinished] = useState(false);
  const [offerWarmup, setOfferWarmup] = useState(() => !focus && startAt === 0 && dueCount(p) > 0 && p.lastWarmup !== today());
  const sessionXp = useRef(0);
  const hintsUsed = useRef(0);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }); window.scrollTo({ top: 0 }); }, [i, finished]);
  useEffect(() => { if (!finished && !focus) p.setLessonStep(id, i); }, [i]);

  if (!lesson) return <div className="page"><p>Lesson not found.</p></div>;
  const chapter = chapterById(lesson.chapter);

  if (offerWarmup) {
    return (
      <div className="page page-narrow">
        <Mentor t={pickPhrase('warmupStart')} mood="happy" />
        <div className="card center-card">
          <h2><U k="review.offer" /></h2>
          <div className="row gap center">
            <button className="btn btn-soft" onClick={() => setOfferWarmup(false)}><U k="review.later" stack={false} /></button>
            <button className="btn btn-primary" onClick={() => navigate(`/review?then=${encodeURIComponent(`/lesson/${id}`)}`)}><Icon name="repeat" size={16} /> <U k="home.warmupTitle" stack={false} /></button>
          </div>
        </div>
      </div>
    );
  }

  const go = (n: number) => {
    if (n >= items.length) {
      const bonus = p.completeLesson(id, 'lesson', hintsUsed.current);
      sessionXp.current += bonus;
      setFinished(true);
      setTimeout(() => hearts(), 150);
      return;
    }
    setI(Math.max(0, n));
  };

  if (finished) {
    const idx = chapter ? lessonsOf(chapter).findIndex((l) => l.id === id) : -1;
    const nextL = chapter && idx >= 0 ? lessonsOf(chapter)[idx + 1] : undefined;
    return (
      <div className="page page-narrow lesson-finish" ref={top}>
        <div className="finish-card">
          <div className="finish-badge"><Icon name="sparkle" size={28} /></div>
          <h1><U k="lesson.finishTitle" /></h1>
          <h2 className="muted"><BiInline t={lesson.title} /></h2>
          <div className="finish-stats">
            <div className="stat"><span className="stat-n">+{sessionXp.current}</span><span className="stat-l">XP</span></div>
            <div className="stat"><span className="stat-n">{lesson.terms.length}</span><span className="stat-l"><U k="home.statsTerms" stack={false} /></span></div>
          </div>
          <Mentor t={pickPhrase('lessonDone')} mood="celebrate" />
          <div className="row gap center wrap">
            <button className="btn btn-soft" onClick={() => navigate(`/chapter/${lesson.chapter}`)}><Icon name="map" size={16} /> <U k="lesson.backToChapter" stack={false} /></button>
            {nextL ? (
              <button className="btn btn-primary" onClick={() => navigate(`/lesson/${nextL.id}`)}><U k="lesson.nextLesson" stack={false} /> <Icon name="chevronRight" size={16} /></button>
            ) : chapter?.boss ? (
              <button className="btn btn-primary" onClick={() => navigate(`/boss/${chapter.id}`)}><Icon name="crown" size={16} /> <U k="chapter.boss" stack={false} /></button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const item = items[i];
  const needsGate = item.kind === 'step' && (item.step.type === 'task' || item.step.type === 'pretest' || item.step.type === 'explain');
  const open = !needsGate || gate[i];
  const markDone = () => setGate((g) => ({ ...g, [i]: true }));

  const onTaskDone = (o: TaskOutcome) => {
    sessionXp.current += o.xp;
    hintsUsed.current += o.hints + (o.revealed ? 1 : 0);
    markDone();
  };

  let body: React.ReactNode = null;
  if (item.kind === 'vocab') body = <VocabStep lesson={lesson} />;
  else {
    const s = item.step;
    switch (s.type) {
      case 'story': body = <StoryStep step={s} />; break;
      case 'theory': body = <TheoryStep step={s} />; break;
      case 'example': body = <ExampleStep step={s} />; break;
      case 'mapping': body = <MappingStep step={s} />; break;
      case 'mistakes': body = <MistakesStep step={s} />; break;
      case 'phrases': body = <PhrasesStep step={s} />; break;
      case 'explain': body = <ExplainStep step={s} lessonId={id} onReady={markDone} />; break;
      case 'pretest': body = <PretestStep key={i} step={s} onDone={() => { markDone(); go(i + 1); }} />; break;
      case 'task': body = <TaskShell key={s.task.id} task={s.task} onDone={onTaskDone} onContinue={() => go(i + 1)} />; break;
    }
  }
  const isTask = item.kind === 'step' && (item.step.type === 'task' || item.step.type === 'pretest');
  const solvedBefore = item.kind === 'step' && item.step.type === 'task' && !!p.tasks[item.step.task.id]?.solved && !gate[i];
  const kind = item.kind === 'step' && item.step.type === 'task' ? item.step.task.kind : '';
  const wide = ['fix', 'find-bug', 'code'].includes(kind) ? 'lesson-wide' : ['predict', 'agent'].includes(kind) ? 'lesson-mid' : '';

  return (
    <div className={`page lesson ${wide}`} ref={top}>
      <div className="lesson-top">
        <button className="icon-btn" onClick={() => navigate(`/chapter/${lesson.chapter}`)} aria-label="exit"><Icon name="x" /></button>
        <div className="lesson-progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={i + 1}>
          {items.map((_, k) => <span key={k} className={`seg ${k < i ? 'done' : k === i ? 'current' : ''}`} />)}
        </div>
        <span className="lesson-count">{i + 1}/{items.length}</span>
      </div>
      <div className="lesson-title-row">
        <BiInline t={lesson.title} className="lesson-title" />
        {focus && <span className="chip chip-peach"><U k="lesson.focusMode" stack={false} /></span>}
      </div>
      <div className="lesson-step" key={i}>{body}</div>
      {!isTask && (
        <div className="lesson-nav">
          <button className="btn btn-ghost" onClick={() => go(i - 1)} disabled={i === 0}><Icon name="chevronLeft" size={16} /> <U k="common.back" stack={false} /></button>
          <button className="btn btn-primary btn-lg" onClick={() => go(i + 1)} disabled={!open}>
            <U k="common.continue" stack={false} /> <Icon name="chevronRight" size={18} />
          </button>
        </div>
      )}
      {isTask && (i > 0 || solvedBefore) && (
        <div className="lesson-nav lesson-nav-back">
          {i > 0 ? <button className="btn btn-ghost btn-sm" onClick={() => go(i - 1)}><Icon name="chevronLeft" size={14} /> <U k="common.back" stack={false} /></button> : <span />}
          {solvedBefore && <button className="btn btn-ghost btn-sm" onClick={() => go(i + 1)}><U k="common.skip" stack={false} /> <Icon name="chevronRight" size={14} /></button>}
        </div>
      )}
      {lesson.goal && i === 0 && <div className="lesson-goal"><Icon name="target" size={15} /> <Bi t={lesson.goal} size="sm" /></div>}
    </div>
  );
}
