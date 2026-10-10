import { useEffect, useState } from 'react';
import { story, chapterById } from './content';
import { BiInline, P, U, usePrimary } from './components/Bi';
import { Icon } from './components/Icon';
import { Mentor } from './components/Mentor';
import { Sticker } from './components/Sticker';
import { TermLayer } from './components/TermLayer';
import { BackupNote } from './components/BackupNudge';
import { keepStorage } from './store/backup';
import { useRoute, navigate } from './lib/router';
import { useSettings } from './store/settings';
import { currentStreak, useProgress } from './store/progress';
import { levelFor } from './engine/xp';
import { onEvent, type AppEvent } from './engine/events';
import { pickPhrase } from './engine/phrases';
import { confettiBurst, hearts } from './lib/celebrate';
import { HomePage } from './pages/HomePage';
import { ChapterPage } from './pages/ChapterPage';
import { LessonPage } from './pages/LessonPage';
import { BossPage, CheckPage, PlacementPage, ReviewPage } from './pages/Flows';
import { BadgesPage, GlossaryPage, InterviewPage, Onboarding, PlaygroundPage, SettingsPage } from './pages/OtherPages';
import { SelfTestPage } from './pages/SelfTestPage';
import { DevFiguresPage, DevLabPage, DevTaskPage } from './pages/DevPages';

const NAV = [
  { path: '/', key: 'nav.home', icon: 'home' },
  { path: '/glossary', key: 'nav.glossary', icon: 'book' },
  { path: '/review', key: 'nav.review', icon: 'repeat' },
  { path: '/badges', key: 'nav.badges', icon: 'sticker' },
  { path: '/interview', key: 'nav.interview', icon: 'chat' },
  { path: '/playground', key: 'nav.playground', icon: 'code' },
  { path: '/settings', key: 'nav.settings', icon: 'gear' },
];

function LangSwitch() {
  const lang = useSettings((s) => s.lang);
  const update = useSettings((s) => s.update);
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {(['both', 'en', 'ru'] as const).map((v) => (
        <button key={v} className={lang === v ? 'on' : ''} onClick={() => update({ lang: v })} aria-pressed={lang === v}>
          {v === 'both' ? 'EN+RU' : v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function TopBar({ path }: { path: string }) {
  const xp = useProgress((s) => s.xp);
  const days = useProgress((s) => s.days);
  const lv = levelFor(xp);
  const primary = usePrimary();
  const active = (p: string) => (p === '/' ? path === '/' || path.startsWith('/chapter') : path.startsWith(p));
  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate('/')} aria-label="Bloom QA home">
        <span className="brand-mark" aria-hidden="true">✿</span>
        <span className="brand-name">Bloom QA</span>
      </button>
      <nav className="topnav" aria-label="Main">
        {NAV.slice(0, 6).map((n) => (
          <button key={n.path} className={`topnav-link ${active(n.path) ? 'active' : ''}`} onClick={() => navigate(n.path)}>
            <Icon name={n.icon} size={17} /> <P k={n.key} />
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <LangSwitch />
        <span className="pill pill-streak" title="streak"><Icon name="flame" size={16} /> {currentStreak(days)}</span>
        <span className="pill pill-xp" title={primary({ en: lv.level.en, ru: lv.level.ru })}><Icon name="star" size={15} /> {xp}</span>
        <button className={`icon-btn ${active('/settings') ? 'active' : ''}`} onClick={() => navigate('/settings')} aria-label="Settings"><Icon name="gear" /></button>
      </div>
    </header>
  );
}

function BottomNav({ path }: { path: string }) {
  const items = [NAV[0], NAV[1], NAV[2], NAV[3], NAV[4]];
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((n) => {
        const on = n.path === '/' ? path === '/' || path.startsWith('/chapter') : path.startsWith(n.path);
        return (
          <button key={n.path} className={on ? 'active' : ''} onClick={() => navigate(n.path)}>
            <Icon name={n.icon} size={22} />
            <span><P k={n.key} /></span>
          </button>
        );
      })}
    </nav>
  );
}

/** Modals/toasts for level-ups, stickers, finished chapters, streaks. */
function CelebrationLayer() {
  const [queue, setQueue] = useState<AppEvent[]>([]);
  const [toast, setToast] = useState<AppEvent | null>(null);
  useEffect(() => onEvent((e) => {
    if (e.type === 'xp') return;
    if (e.type === 'streak' || e.type === 'welcomeBack') {
      setToast(e);
      setTimeout(() => setToast(null), 5000);
      return;
    }
    setQueue((q) => [...q, e]);
  }), []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    if (current.type === 'badge') hearts();
    else confettiBurst();
  }, [current]);
  const close = () => setQueue((q) => q.slice(1));
  return (
    <>
      {current && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal celebrate-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {current.type === 'levelUp' && (() => {
              const lv = story.levels[current.index];
              return (
                <>
                  <div className="eyebrow"><U k="celebrate.levelUp" stack={false} /></div>
                  <div className="level-big">{current.index + 1}</div>
                  <h2><BiInline t={{ en: lv.en, ru: lv.ru }} /></h2>
                  <Mentor t={pickPhrase('levelUp')} vars={{ level: lv.en }} mood="celebrate" compact />
                </>
              );
            })()}
            {current.type === 'badge' && (() => {
              const b = story.badges.find((x) => x.id === current.id);
              if (!b) return null;
              return (
                <>
                  <div className="eyebrow"><U k="badges.newBadge" stack={false} /></div>
                  <div className="sticker-reveal"><Sticker icon={b.icon} color={b.color} size={140} tilt={-6} /></div>
                  <h2><BiInline t={b.title} /></h2>
                  <Mentor t={pickPhrase('badge')} vars={{ badge: b.title.en }} mood="happy" compact />
                </>
              );
            })()}
            {current.type === 'chapterDone' && (() => {
              const ch = chapterById(current.id);
              return (
                <>
                  <div className="eyebrow"><U k="celebrate.chapterDone" stack={false} /></div>
                  <div className="sticker-reveal"><Sticker icon="trophy" color={ch?.color || 'butter'} size={130} tilt={4} /></div>
                  {ch && <h2><BiInline t={ch.department} /></h2>}
                  <Mentor t={pickPhrase('chapterDone')} vars={{ chapter: ch?.title.en || '' }} mood="celebrate" compact />
                  <BackupNote />
                </>
              );
            })()}
            <button className="btn btn-primary btn-lg" onClick={close} autoFocus><U k="common.continue" stack={false} /></button>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast.type === 'streak' && <Mentor t={pickPhrase('streak')} vars={{ streak: toast.days }} mood="celebrate" compact />}
          {toast.type === 'welcomeBack' && <Mentor t={pickPhrase('welcomeBack')} mood="happy" compact />}
        </div>
      )}
    </>
  );
}

function useTheme() {
  const theme = useSettings((s) => s.theme);
  const lang = useSettings((s) => s.lang);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.lang = lang === 'ru' ? 'ru' : 'en';
  }, [lang]);
}

export function App() {
  const route = useRoute();
  const onboarded = useSettings((s) => s.onboarded);
  const touchDay = useProgress((s) => s.touchDay);
  const learning = useProgress((s) => Object.values(s.lessons).some((l) => l.status === 'done'));
  useTheme();
  useEffect(() => { touchDay(); }, [route.path]);
  useEffect(() => { if (learning) keepStorage(); }, [learning]);

  const [a, b, c] = route.parts;
  let page: React.ReactNode;
  if (a === 'dev' && b === 'selftest') page = <SelfTestPage />;
  else if (a === 'dev' && b === 'task' && c) page = <DevTaskPage id={c} />;
  else if (a === 'dev' && b === 'lab') page = <DevLabPage />;
  else if (a === 'dev' && b === 'figures') page = <DevFiguresPage />;
  else if (!onboarded && a !== 'placement') page = <Onboarding />;
  else if (!a) page = <HomePage />;
  else if (a === 'chapter' && b) page = <ChapterPage key={b} id={b} />;
  else if (a === 'lesson' && b) {
    const focus = route.query.get('focus');
    const step = route.query.get('step');
    page = <LessonPage key={`${b}-${focus}-${step}`} id={b} focus={focus ? focus.split(',').filter(Boolean) : null} startStep={step ? Number(step) : undefined} />;
  } else if (a === 'check' && (b === 'lesson' || b === 'chapter') && c) page = <CheckPage key={`${b}-${c}`} scope={b} id={c} />;
  else if (a === 'boss' && b) page = <BossPage key={b} chapterId={b} />;
  else if (a === 'placement') page = <PlacementPage />;
  else if (a === 'review') page = <ReviewPage key={route.query.toString()} then={route.query.get('then')} />;
  else if (a === 'glossary') page = <GlossaryPage key={route.query.get('q') || ''} q={route.query.get('q') || ''} />;
  else if (a === 'badges') page = <BadgesPage />;
  else if (a === 'interview') page = <InterviewPage />;
  else if (a === 'playground') page = <PlaygroundPage />;
  else if (a === 'settings') page = <SettingsPage />;
  else page = <HomePage />;

  const immersive = ['lesson', 'check', 'boss', 'placement', 'review'].includes(a || '') || !onboarded;
  return (
    <div className={`app ${immersive ? 'app-immersive' : ''}`}>
      {!immersive && <TopBar path={route.path} />}
      <main className="main" id="main">{page}</main>
      {!immersive && <BottomNav path={route.path} />}
      <TermLayer />
      <CelebrationLayer />
    </div>
  );
}
