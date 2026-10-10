import { useMemo } from 'react';
import { chapters, lessonsOf, story } from '../content';
import { Bi, BiInline, P, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Mentor } from '../components/Mentor';
import { Mochi } from '../components/Characters';
import { BackupNudge } from '../components/BackupNudge';
import { chapterMastered, chapterUnlocked, currentStreak, lessonDone, termsLearned, useProgress } from '../store/progress';
import { dueCount, lessonProgressRatio, nextBoss, nextLesson, weakTopics, placementVars } from '../engine/plan';
import { levelFor } from '../engine/xp';
import { pickPhrase } from '../engine/phrases';
import { diffDays, today } from '../lib/dates';
import { navigate } from '../lib/router';

function Ring({ value, color }: { value: number; color: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" className="ring" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx="20" cy="20" r={r} fill="none" stroke={`var(--${color}-strong)`} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 20 20)" />
    </svg>
  );
}

export function LevelCard() {
  const p = useProgress();
  const lv = levelFor(p.xp);
  const streak = currentStreak(p.days);
  const lessonsDone = Object.values(p.lessons).filter((l) => l.status === 'done').length;
  return (
    <div className="card level-card">
      <div className="level-top">
        <div>
          <div className="eyebrow"><U k="home.levelLabel" stack={false} /> · {lv.index + 1}/{story.levels.length}</div>
          <div className="level-name"><BiInline t={{ en: lv.level.en, ru: lv.level.ru }} /></div>
        </div>
        <div className="streak-pill" title="streak"><Icon name="flame" size={18} /> {streak}</div>
      </div>
      <div className="xp-bar"><span style={{ width: `${Math.round(lv.progress * 100)}%` }} /></div>
      <div className="xp-meta">
        <span>{p.xp} XP</span>
        {lv.next && <span className="muted">{lv.next.xp - p.xp} XP <P k="home.toNext" /></span>}
      </div>
      <div className="mini-stats">
        <span><strong>{lessonsDone}</strong> <P k="home.statsLessons" /></span>
        <span><strong>{termsLearned(p)}</strong> <P k="home.statsTerms" /></span>
        <span><strong>{p.stats.tasksSolved}</strong> <P k="home.statsTasks" /></span>
      </div>
    </div>
  );
}

export function HomePage() {
  const p = useProgress();
  const next = nextLesson(p);
  const boss = nextBoss(p);
  const due = dueCount(p);
  const weak = weakTopics(p);
  const started = Object.keys(p.lessons).length > 0;
  const last = p.days.length > 1 ? p.days[p.days.length - 2] : null;
  const greeting = useMemo(() => {
    const lessonsDone = Object.values(p.lessons).filter((l) => l.status === 'done').length;
    if (last && diffDays(last, today()) >= 3) return { t: pickPhrase('welcomeBack'), mood: 'sleepy' as const };
    if (lessonsDone >= 2 && Math.random() < 0.35) {
      return { t: pickPhrase('progress'), mood: 'happy' as const, vars: { lessons: lessonsDone, terms: termsLearned(p), tasks: p.stats.tasksSolved, days: Math.max(1, diffDays(p.startedAt, today())) } };
    }
    return { t: pickPhrase('greeting'), mood: 'happy' as const };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page home">
      <div className="home-hero">
        <Mentor t={greeting.t} vars={greeting.vars} mood={greeting.mood} />
      </div>
      <div className="home-grid">
        <div className="home-main">
          {(next || boss) && (
            <button className="card cta-card" onClick={() => navigate(boss && (!next || next.chapter !== boss) ? `/boss/${boss}` : `/lesson/${next!.id}`)}>
              <div className="cta-icon">{boss && (!next || next.chapter !== boss) ? <Icon name="crown" size={26} /> : <Icon name="play" size={26} />}</div>
              <div className="cta-text">
                <div className="eyebrow"><U k={started ? 'home.continueTitle' : 'home.startTitle'} stack={false} /></div>
                {boss && (!next || next.chapter !== boss)
                  ? <div className="cta-title"><U k="chapter.boss" stack={false} /></div>
                  : <div className="cta-title"><BiInline t={next!.title} /></div>}
                {next && <div className="cta-meta"><Icon name="clock" size={14} /> {next.minutes} <U k="common.minutes" stack={false} /></div>}
              </div>
              <Icon name="chevronRight" size={22} />
            </button>
          )}
          <div className="home-row">
            <button className={`card small-card ${due ? '' : 'calm'}`} onClick={() => navigate('/review')} disabled={!due}>
              <div className="small-card-head"><Icon name="repeat" size={18} /> <U k="home.warmupTitle" stack={false} /></div>
              {due ? <><div className="big-num">{due}</div><div className="muted small"><U k="home.warmupDue" stack={false} /></div></> : <div className="muted small"><U k="home.allCaughtUp" stack={false} /></div>}
            </button>
            {!p.placement?.done && !started && (
              <button className="card small-card accent" onClick={() => navigate('/placement')}>
                <div className="small-card-head"><Icon name="compass" size={18} /> <U k="home.placementTitle" stack={false} /></div>
                <div className="muted small"><U k="home.placementDesc" vars={placementVars()} stack={false} /></div>
              </button>
            )}
          </div>
          <BackupNudge />
          {weak.length > 0 && (
            <div className="card weak-card">
              <div className="small-card-head"><Icon name="target" size={18} /> <U k="home.weakTitle" stack={false} /></div>
              <Bi t={{ en: 'These ideas tripped you up — a short focused practice will lock them in.', ru: 'На этих идеях были ошибки — короткая практика закрепит их.' }} size="sm" />
              {weak.map((w) => (
                <button key={w.lesson.id} className="weak-row" onClick={() => navigate(`/lesson/${w.lesson.id}?focus=${w.kps.map((k) => k.id).join(',')}`)}>
                  <span><BiInline t={w.lesson.title} stack={false} /></span>
                  <span className="muted small">{w.kps.map((k) => k.title.en).join(' · ')}</span>
                  <span className="chip chip-peach"><U k="home.practice" stack={false} /></span>
                </button>
              ))}
            </div>
          )}
          <h2 className="section-title"><Icon name="map" size={18} /> <U k="home.mapTitle" stack={false} /></h2>
          <div className="map">
            {chapters.map((ch) => {
              const unlocked = chapterUnlocked(p, ch.id) && ch.status === 'ready';
              const mastered = chapterMastered(p, ch.id);
              const ratio = lessonProgressRatio(ch, p);
              const ls = lessonsOf(ch);
              return (
                <button key={ch.id} className={`map-node tone-${ch.color} ${unlocked ? '' : 'locked'} ${mastered ? 'mastered' : ''} ${ch.status === 'planned' ? 'planned' : ''}`} onClick={() => navigate(`/chapter/${ch.id}`)}>
                  <div className="map-num">{ch.number}</div>
                  <div className="map-text">
                    <div className="eyebrow"><BiInline t={ch.department} stack={false} /></div>
                    <div className="map-title"><BiInline t={ch.title} /></div>
                    <div className="map-meta">
                      {ch.status === 'planned' ? <span className="chip chip-ghost"><U k="chapter.comingSoon" stack={false} /></span>
                        : mastered ? <span className="chip chip-mint"><Icon name="check" size={12} /> <U k="chapter.mastered" stack={false} /></span>
                        : !unlocked ? <span className="chip chip-ghost"><Icon name="lock" size={12} /> <U k="common.locked" stack={false} /></span>
                        : <span className="muted small">{ls.filter((l) => lessonDone(p, l.id)).length}/{ls.length}</span>}
                    </div>
                  </div>
                  {unlocked && <Ring value={ratio} color={ch.color} />}
                </button>
              );
            })}
          </div>
        </div>
        <aside className="home-side">
          <LevelCard />
          <div className="card mochi-card">
            <Mochi mood={due ? 'think' : 'happy'} size={88} />
            <Bi t={{ en: 'Mochi sniffs out bugs. You make sure the tests can, too.', ru: 'Мочи вынюхивает баги. А ты следишь, чтобы тесты тоже умели.' }} size="sm" />
          </div>
        </aside>
      </div>
    </div>
  );
}
