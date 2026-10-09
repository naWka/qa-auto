// Check ("I know this"), boss, entry check and warm-up flows.
import { useMemo, useState } from 'react';
import type { Task } from '../content/schema';
import { chapterById, chapters, lessons, lessonsOf } from '../content';
import { Bi, BiInline, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Dialogue, Mentor } from '../components/Mentor';
import { useProgress } from '../store/progress';
import { chapterCheckItems, lessonCheckItems, placementItems, warmupQueue } from '../engine/plan';
import { pickPhrase } from '../engine/phrases';
import { navigate } from '../lib/router';
import { confettiBurst, hearts } from '../lib/celebrate';
import { TaskSequence } from './Sequence';
import type { TaskOutcome } from '../tasks/TaskShell';

function ResultCard({ children }: { children: React.ReactNode }) {
  return <div className="page page-narrow"><div className="finish-card">{children}</div></div>;
}

export function CheckPage({ scope, id }: { scope: 'lesson' | 'chapter'; id: string }) {
  const p = useProgress();
  const [result, setResult] = useState<null | { passed: boolean; failed: { lessonId: string; kp?: string }[]; xp: number }>(null);
  const items = useMemo(() => {
    if (scope === 'lesson') {
      const l = lessons.get(id);
      return l ? lessonCheckItems(l, p).map((task) => ({ task, lessonId: l.id })) : [];
    }
    return chapterCheckItems(id, p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, id]);
  const title = scope === 'lesson' ? lessons.get(id)?.title : chapterById(id)?.title;

  if (!items.length || !title) return <div className="page"><p>—</p></div>;

  if (result) {
    const lesson = scope === 'lesson' ? lessons.get(id)! : null;
    const failedKpTitles = result.failed.map((f) => {
      const l = lessons.get(f.lessonId)!;
      const kp = l.keyPoints.find((k) => k.id === f.kp);
      return { l, kp };
    });
    return (
      <ResultCard>
        <div className={`finish-badge ${result.passed ? '' : 'soft'}`}><Icon name={result.passed ? 'check' : 'compass'} size={28} /></div>
        <h1><U k={result.passed ? 'check.passedTitle' : 'check.failedTitle'} /></h1>
        <h2 className="muted"><BiInline t={title} /></h2>
        {result.passed && result.xp > 0 && <div className="finish-stats"><div className="stat"><span className="stat-n">+{result.xp}</span><span className="stat-l">XP</span></div></div>}
        <Mentor t={pickPhrase(result.passed ? 'checkPassed' : 'checkFailed')} mood={result.passed ? 'celebrate' : 'think'} />
        {!result.passed && (
          <div className="failed-kps">
            <div className="report-sub"><U k="check.failedKps" stack={false} /></div>
            <ul>
              {failedKpTitles.map(({ l, kp }, i) => (
                <li key={i}><Icon name="target" size={14} /> {kp ? <BiInline t={kp.title} stack={false} /> : <BiInline t={l.title} stack={false} />}{scope === 'chapter' && <span className="muted small"> · <BiInline t={l.title} stack={false} /></span>}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="row gap center wrap">
          <button className="btn btn-soft" onClick={() => navigate('/')}><U k="check.backHome" stack={false} /></button>
          {!result.passed && lesson && (
            <button className="btn btn-primary" onClick={() => navigate(`/lesson/${lesson.id}?focus=${[...new Set(result.failed.map((f) => f.kp).filter(Boolean))].join(',')}`)}>
              <Icon name="target" size={16} /> <U k="check.practiceThese" stack={false} />
            </button>
          )}
          {!result.passed && !lesson && result.failed[0] && (
            <button className="btn btn-primary" onClick={() => navigate(`/lesson/${result.failed[0].lessonId}`)}>
              <Icon name="target" size={16} /> <U k="check.practiceThese" stack={false} />
            </button>
          )}
          {result.passed && <button className="btn btn-primary" onClick={() => navigate(scope === 'lesson' ? `/chapter/${lessons.get(id)!.chapter}` : '/')}><U k="common.continue" stack={false} /> <Icon name="chevronRight" size={16} /></button>}
        </div>
      </ResultCard>
    );
  }

  const finish = (outcomes: TaskOutcome[]) => {
    const failed = items.map((it, i) => ({ ...it, ok: outcomes[i]?.correct })).filter((x) => !x.ok).map((x) => ({ lessonId: x.lessonId, kp: x.task.keyPoint }));
    const passed = failed.length === 0;
    for (const [i, it] of items.entries()) {
      const k = it.task.keyPoint;
      if (k) p.attempt({ ...it.task, id: `chk-${it.task.id}` } as Task, !!outcomes[i]?.correct);
    }
    p.recordCheck(`${scope}:${id}`, items.map((x) => x.task.id), passed, failed.map((f) => f.kp || ''));
    let xp = 0;
    if (passed) {
      xp = scope === 'lesson' ? p.completeLesson(id, 'check') : p.passChapterCheck(id);
      confettiBurst();
    }
    setResult({ passed, failed, xp });
  };

  return (
    <TaskSequence
      tasks={items.map((x) => x.task)}
      mode="exam"
      title={<><U k={scope === 'lesson' ? 'check.lessonTitle' : 'check.chapterTitle'} stack={false} /> · <BiInline t={title} stack={false} /></>}
      intro={<Mentor t={uiIntro} mood="think" />}
      onExit={() => history.back()}
      onFinish={finish}
    />
  );
}

const uiIntro = { en: 'A short practical check: no hints this time, just show what you can do. If something doesn\'t click — we\'ll practise only that part.', ru: 'Короткая практическая проверка: без подсказок, просто покажи, что умеешь. Если что-то не получится — потренируем только эту часть.' };

export function BossPage({ chapterId }: { chapterId: string }) {
  const ch = chapterById(chapterId);
  const p = useProgress();
  const [done, setDone] = useState<null | number>(null);
  if (!ch?.boss) return <div className="page"><p>—</p></div>;
  if (done !== null) {
    return (
      <ResultCard>
        <div className="finish-badge"><Icon name="crown" size={28} /></div>
        <h1><BiInline t={ch.boss.title} /></h1>
        <div className="finish-stats"><div className="stat"><span className="stat-n">+{done}</span><span className="stat-l">XP</span></div></div>
        <Mentor t={pickPhrase('chapterDone')} vars={{ chapter: ch.title.en }} mood="celebrate" />
        {ch.outro && <Dialogue lines={ch.outro} />}
        <div className="row gap center"><button className="btn btn-primary" onClick={() => navigate('/')}><U k="common.continue" stack={false} /> <Icon name="chevronRight" size={16} /></button></div>
      </ResultCard>
    );
  }
  return (
    <TaskSequence
      tasks={ch.boss.tasks}
      mode="learn"
      bonusXp={0}
      title={<><Icon name="crown" size={16} /> <BiInline t={ch.boss.title} stack={false} /></>}
      intro={<><Mentor t={pickPhrase('bossIntro')} mood="think" /><Dialogue lines={ch.boss.story} /></>}
      onExit={() => navigate(`/chapter/${chapterId}`)}
      onFinish={(o) => {
        const xp = o.reduce((s, x) => s + (x?.xp || 0), 0) + p.completeBoss(chapterId);
        setDone(xp);
        confettiBurst();
      }}
    />
  );
}

export function PlacementPage() {
  const p = useProgress();
  const items = useMemo(() => placementItems(), []);
  const [summary, setSummary] = useState<null | { credited: string[]; start: string | null }>(null);

  if (summary) {
    return (
      <ResultCard>
        <div className="finish-badge"><Icon name="compass" size={28} /></div>
        <h1><U k="placement.resultTitle" /></h1>
        <Mentor t={pickPhrase(summary.credited.length ? 'checkPassed' : 'greeting')} mood="happy" />
        {summary.credited.length ? (
          <div className="credited">
            <div className="report-sub"><Icon name="check" size={14} /> <U k="placement.credited" stack={false} /></div>
            <ul>{summary.credited.map((id) => <li key={id}><BiInline t={lessons.get(id)!.title} stack={false} /></li>)}</ul>
          </div>
        ) : <Bi t={{ en: "We'll start from the beginning — it'll go fast with your experience.", ru: 'Начнём с начала — с твоим опытом пойдёт быстро.' }} />}
        <div className="row center">
          <button className="btn btn-primary btn-lg" onClick={() => navigate(summary.start ? `/lesson/${summary.start}` : '/')}>
            <U k="placement.startHere" stack={false} /> <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </ResultCard>
    );
  }

  const finish = (outcomes: TaskOutcome[]) => {
    const credited: string[] = [];
    for (const ch of chapters) {
      if (ch.status !== 'ready') continue;
      const its = items.map((it, i) => ({ ...it, ok: !!outcomes[i]?.correct })).filter((x) => x.chapterId === ch.id);
      if (!its.length) continue;
      const ok = its.filter((x) => x.ok);
      if (ok.length === its.length) {
        p.passChapterCheck(ch.id);
        credited.push(...its.map((x) => x.lessonId));
      } else if (ok.length >= its.length - 1 && its.length >= 3) {
        for (const x of ok) { p.completeLesson(x.lessonId, 'placement'); credited.push(x.lessonId); }
      }
    }
    p.setPlacement({ done: true });
    const st = useProgress.getState();
    let start: string | null = null;
    for (const ch of chapters) {
      if (ch.status !== 'ready') continue;
      const l = lessonsOf(ch).find((x) => st.lessons[x.id]?.status !== 'done');
      if (l) { start = l.id; break; }
    }
    if (credited.length) confettiBurst();
    else hearts();
    setSummary({ credited, start });
  };

  return (
    <TaskSequence
      tasks={items.map((x) => x.task)}
      mode="exam"
      title={<U k="placement.title" stack={false} />}
      intro={<Mentor t={{ en: 'Answer as you can — this only decides where you start. Wrong answers cost nothing.', ru: 'Отвечай как получается — это лишь определит, откуда начать. Ошибки ничего не стоят.' }} mood="think" />}
      onExit={() => { p.setPlacement({ done: false, skipped: true }); navigate('/'); }}
      onFinish={finish}
    />
  );
}

export function ReviewPage({ then }: { then: string | null }) {
  const p = useProgress();
  const queue = useMemo(() => warmupQueue(p), []);
  const [done, setDone] = useState(false);
  if (!queue.length || done) {
    return (
      <ResultCard>
        <div className="finish-badge"><Icon name="repeat" size={28} /></div>
        <h1><U k={queue.length ? 'review.done' : 'review.title'} /></h1>
        <Mentor t={queue.length ? pickPhrase('lessonDone') : { en: 'Nothing to review right now. Come back tomorrow!', ru: 'Сейчас повторять нечего. Возвращайся завтра!' }} mood={queue.length ? 'happy' : 'sleepy'} />
        <div className="row center"><button className="btn btn-primary" onClick={() => navigate(then || '/')}><U k="common.continue" stack={false} /> <Icon name="chevronRight" size={16} /></button></div>
      </ResultCard>
    );
  }
  return (
    <TaskSequence
      tasks={queue.map((q) => q.task)}
      mode="review"
      title={<><Icon name="repeat" size={16} /> <U k="review.title" stack={false} /></>}
      intro={<><Mentor t={pickPhrase('warmupStart')} mood="happy" /><Bi t={{ en: 'Spaced repetition: we bring back what you are about to forget — and stop bothering you with what you know well.', ru: 'Интервальное повторение: возвращаем то, что вот-вот забудется, и не докучаем тем, что ты знаешь хорошо.' }} size="sm" /></>}
      onExit={() => navigate(then || '/')}
      onFinish={(outcomes) => {
        queue.forEach((q, i) => {
          const o = outcomes[i];
          const quality = !o ? 2 : o.correct ? (o.firstTry ? 5 : 4) : 1;
          p.reviewCard(q.cardId, quality);
          if (q.cardId.startsWith('topic:')) p.recordCheck(`warm:${q.cardId.slice(6)}`, [q.task.id], !!o?.correct);
        });
        p.setWarmupDone();
        hearts();
        setDone(true);
      }}
    />
  );
}
