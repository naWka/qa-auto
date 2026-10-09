import { useState } from 'react';
import { chapterById, lessonsOf } from '../content';
import { Bi, BiInline, U } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Dialogue } from '../components/Mentor';
import { chapterMastered, chapterUnlocked, lessonDone, useProgress } from '../store/progress';
import { navigate } from '../lib/router';

export function ChapterPage({ id }: { id: string }) {
  const ch = chapterById(id);
  const p = useProgress();
  const [storyOpen, setStoryOpen] = useState(!Object.keys(p.lessons).some((k) => k.startsWith(`${id}-`)));
  if (!ch) return <div className="page"><p>—</p></div>;
  const unlocked = chapterUnlocked(p, ch.id);
  const mastered = chapterMastered(p, ch.id);
  const ls = lessonsOf(ch);
  const allDone = ls.length > 0 && ls.every((l) => lessonDone(p, l.id));
  const nextIdx = ls.findIndex((l) => !lessonDone(p, l.id));

  return (
    <div className={`page chapter tone-${ch.color}`}>
      <button className="link-btn back-link" onClick={() => navigate('/')}><Icon name="chevronLeft" size={16} /> <U k="nav.home" stack={false} /></button>
      <header className="chapter-head">
        <div className="chapter-num">{ch.number}</div>
        <div>
          <div className="eyebrow"><U k="chapter.chapter" stack={false} /> {ch.number} · <BiInline t={ch.department} stack={false} /></div>
          <h1><BiInline t={ch.title} /></h1>
          <Bi t={ch.summary} />
        </div>
      </header>

      {!unlocked && ch.status === 'ready' && <div className="notice"><Icon name="lock" size={16} /> <U k="chapter.lockedChapter" stack={false} /></div>}

      {ch.intro && ch.intro.length > 0 && (
        <div className="card story-card">
          <button className="story-toggle" onClick={() => setStoryOpen(!storyOpen)} aria-expanded={storyOpen}>
            <Icon name="chat" size={16} /> <U k="lesson.story" stack={false} /> <Icon name="chevronDown" size={16} className={storyOpen ? 'rot180' : ''} />
          </button>
          {storyOpen && <Dialogue lines={ch.intro} />}
        </div>
      )}

      {ch.status === 'planned' ? (
        <div className="plan">
          <h2 className="section-title"><Icon name="book" size={18} /> <U k="chapter.plan" stack={false} /> <span className="chip chip-ghost"><U k="chapter.comingSoon" stack={false} /></span></h2>
          {ch.plan?.map((pl, i) => (
            <div key={i} className="card plan-card">
              <div className="plan-n">{ch.number}.{i + 1}</div>
              <div>
                <h3><BiInline t={pl.title} /></h3>
                <Bi t={pl.goal} size="sm" />
                <ul className="kp-list">{pl.keyPoints.map((k, j) => <li key={j}><BiInline t={k} stack={false} /></li>)}</ul>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <h2 className="section-title"><Icon name="book" size={18} /> <U k="chapter.lessons" stack={false} /></h2>
          <div className="lesson-list">
            {ls.map((l, i) => {
              const lp = p.lessons[l.id];
              const done = lp?.status === 'done';
              return (
                <div key={l.id} className={`lesson-card ${done ? 'done' : ''} ${i === nextIdx ? 'next' : ''}`}>
                  <button className="lesson-card-main" onClick={() => unlocked && navigate(`/lesson/${l.id}`)} disabled={!unlocked}>
                    <span className="lesson-n">{done ? <Icon name="check" size={18} strokeWidth={2.4} /> : `${ch.number}.${i + 1}`}</span>
                    <span className="lesson-card-text">
                      <BiInline t={l.title} className="lesson-card-title" />
                      <span className="lesson-card-meta">
                        <Icon name="clock" size={13} /> {l.minutes} <U k="common.minutes" stack={false} />
                        {done && lp?.via && lp.via !== 'lesson' && <span className="chip chip-butter"><U k="chapter.viaCheck" stack={false} /></span>}
                        {!done && lp?.status === 'in-progress' && <span className="chip chip-lavender"><U k="chapter.inProgress" stack={false} /></span>}
                      </span>
                    </span>
                    <span className="lesson-go">{done ? <U k="chapter.review" stack={false} /> : <U k="chapter.start" stack={false} />} <Icon name="chevronRight" size={16} /></span>
                  </button>
                  {!done && unlocked && (
                    <button className="iknow-btn" onClick={() => navigate(`/check/lesson/${l.id}`)} title="I know this">
                      <Icon name="check" size={14} /> <U k="chapter.iKnowThis" stack={false} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {ch.boss && (
            <div className={`card boss-card ${allDone ? '' : 'locked'} ${p.chapters[ch.id]?.bossDone ? 'done' : ''}`}>
              <div className="boss-icon"><Icon name="crown" size={28} /></div>
              <div className="boss-text">
                <div className="eyebrow"><U k="chapter.boss" stack={false} /></div>
                <h3><BiInline t={ch.boss.title} /></h3>
                {!allDone && <div className="muted small"><Icon name="lock" size={13} /> <U k="chapter.bossLocked" stack={false} /></div>}
              </div>
              <button className="btn btn-primary" disabled={!allDone || !unlocked} onClick={() => navigate(`/boss/${ch.id}`)}>
                {p.chapters[ch.id]?.bossDone ? <Icon name="check" size={16} /> : <Icon name="play" size={16} />} <U k={p.chapters[ch.id]?.bossDone ? 'chapter.review' : 'common.start'} stack={false} />
              </button>
            </div>
          )}

          {!mastered && unlocked && (
            <div className="card iknow-card">
              <div>
                <h3><Icon name="check" size={18} /> <U k="chapter.chapterCheck" stack={false} /></h3>
                <div className="muted small"><U k="chapter.iKnowThisDesc" stack={false} /></div>
              </div>
              <button className="btn btn-soft" onClick={() => navigate(`/check/chapter/${ch.id}`)}><U k="common.start" stack={false} /> <Icon name="chevronRight" size={16} /></button>
            </div>
          )}
          {mastered && ch.outro && <div className="card story-card"><Dialogue lines={ch.outro} /></div>}
        </>
      )}
    </div>
  );
}
