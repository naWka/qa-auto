// Glossary, stickers, interview prep, settings, playground, onboarding.
import { useMemo, useRef, useState } from 'react';
import { glossary, interview, story, uiText } from '../content';
import { Bi, BiInline, U, usePrimary, useUiString } from '../components/Bi';
import { Icon } from '../components/Icon';
import { Mentor } from '../components/Mentor';
import { Sticker } from '../components/Sticker';
import { ListenButton } from '../components/Listen';
import { placementVars } from '../engine/plan';
import { useProgress, progressSnapshot } from '../store/progress';
import { useSettings, type Settings } from '../store/settings';
import { PLAYGROUND_KEY, applyBackup, backupCode, downloadBackup, hasProgress, parseBackup, summarize, type Backup, type Summary } from '../store/backup';
import { formatDay, today } from '../lib/dates';
import { CodeLab } from '../lab/CodeLab';
import { navigate } from '../lib/router';

export function GlossaryPage({ q: initial }: { q: string }) {
  const [q, setQ] = useState(initial);
  const [filter, setFilter] = useState<'all' | 'learned'>('all');
  const p = useProgress();
  const s = useUiString();
  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...glossary.values()]
      .filter((e) => filter === 'all' || p.srs[`term:${e.id}`])
      .filter((e) => !needle || e.en.toLowerCase().includes(needle) || e.ru.toLowerCase().includes(needle) || e.def.en.toLowerCase().includes(needle))
      .sort((a, b) => a.chapter - b.chapter || a.en.localeCompare(b.en));
  }, [q, filter, p.srs]);
  return (
    <div className="page">
      <h1 className="page-title"><Icon name="book" size={24} /> <U k="glossary.title" /></h1>
      <p className="page-intro"><U k="glossary.intro" /></p>
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={s('glossary.search')} aria-label={s('glossary.search')} />
        </label>
        <div className="seg-ctl">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}><U k="glossary.all" stack={false} /></button>
          <button className={filter === 'learned' ? 'on' : ''} onClick={() => setFilter('learned')}><U k="glossary.learned" stack={false} /></button>
        </div>
      </div>
      {entries.length === 0 && <p className="muted"><U k="glossary.empty" /></p>}
      <div className="gloss-grid">
        {entries.map((e) => (
          <article key={e.id} className={`card gloss-card ${p.srs[`term:${e.id}`] ? 'learned' : ''}`}>
            <div className="gloss-head">
              <div>
                <div className="term-word">{e.en}</div>
                <div className="term-ipa">{e.ipa}{e.pos ? ` · ${e.pos}` : ''}</div>
              </div>
              <ListenButton text={e.en} size={18} />
            </div>
            <div className="term-ru">{e.ru}</div>
            <Bi t={e.def} size="sm" />
            <div className="term-example"><Bi t={e.example} size="sm" /></div>
            <div className="gloss-foot"><span className="chip chip-ghost"><U k="glossary.chapterN" stack={false} /> {e.chapter}</span>{e.context && <span className={`ctx-chip ctx-${e.context}`}><BiInline t={uiText(`context.${e.context}`)} stack={false} /></span>}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function BadgesPage() {
  const badges = useProgress((s) => s.badges);
  const primary = usePrimary();
  return (
    <div className="page">
      <h1 className="page-title"><Icon name="sticker" size={24} /> <U k="badges.title" /></h1>
      <p className="page-intro"><U k="badges.intro" /></p>
      <div className="sticker-grid">
        {story.badges.map((b, i) => {
          const at = badges[b.id];
          return (
            <div key={b.id} className={`sticker-cell ${at ? 'earned' : ''}`}>
              <Sticker icon={b.icon} color={b.color} locked={!at} tilt={at ? ((i * 7) % 13) - 6 : 0} label={primary(b.title)} />
              <div className="sticker-name"><BiInline t={b.title} /></div>
              <div className="sticker-desc"><Bi t={b.desc} size="sm" /></div>
              {at && <div className="muted small"><U k="badges.earned" stack={false} /> {at}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InterviewPage() {
  const [topic, setTopic] = useState<string>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const topics = useMemo(() => Array.from(new Set(interview.map((q) => q.topic))), []);
  const list = interview.filter((q) => topic === 'all' || q.topic === topic);
  return (
    <div className="page page-narrow">
      <h1 className="page-title"><Icon name="chat" size={24} /> <U k="interview.title" /></h1>
      <p className="page-intro"><U k="interview.intro" /></p>
      <div className="chip-row">
        <button className={`chip-btn ${topic === 'all' ? 'on' : ''}`} onClick={() => setTopic('all')}><U k="glossary.all" stack={false} /></button>
        {topics.map((t) => <button key={t} className={`chip-btn ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}><BiInline t={uiText(`interview.topic.${t}`)} stack={false} /></button>)}
      </div>
      <div className="qa-list">
        {list.map((q) => (
          <div key={q.id} className="card qa">
            <div className="qa-q">
              <span className={`chip chip-ghost`}><BiInline t={uiText(`interview.topic.${q.topic}`)} stack={false} /></span>
              <Bi t={q.q} size="lg" />
              <ListenButton text={q.q.en} size={18} />
            </div>
            {open[q.id] ? (
              <div className="qa-a">
                <Bi t={q.a} />
                <ListenButton text={q.a.en} label />
                {q.tip && <div className="explain-box"><div className="explain-label"><Icon name="bulb" size={14} /> <U k="interview.tip" stack={false} /></div><Bi t={q.tip} size="sm" /></div>}
              </div>
            ) : (
              <button className="btn btn-soft btn-sm" onClick={() => setOpen({ ...open, [q.id]: true })}><Icon name="eye" size={15} /> <U k="interview.show" stack={false} /></button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type Msg = { ok: boolean; k: string; vars?: Record<string, string | number> };

/** Copies a code that is still being built: Safari only allows clipboard writes started inside the click. */
async function copyLater(code: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': code.then((c) => new Blob([c], { type: 'text/plain' })) })]);
  } else {
    await navigator.clipboard.writeText(await code);
  }
}

function ImportConfirm({ backup, onDone, onCancel }: { backup: Backup; onDone: (m: Msg) => void; onCancel: () => void }) {
  const copy = summarize(backup.progress);
  const here = summarize(progressSnapshot());
  const rows: { k: string; v: (x: Summary) => number | string | null }[] = [
    { k: 'common.xp', v: (x) => x.xp },
    { k: 'settings.statLessons', v: (x) => x.lessons },
    { k: 'settings.statTasks', v: (x) => x.tasks },
    { k: 'settings.statLast', v: (x) => x.lastDay },
  ];
  const apply = (mode: 'replace' | 'merge') => {
    applyBackup(backup, mode);
    onDone({ ok: true, k: mode === 'merge' ? 'settings.merged' : 'settings.imported' });
  };
  return (
    <div className="import-box" role="dialog" aria-label="Import">
      <h3><U k="settings.importTitle" stack={false} /></h3>
      <table className="import-cmp">
        <thead><tr><th /><th><U k="settings.inCopy" stack={false} /></th><th><U k="settings.inBrowser" stack={false} /></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const a = r.v(copy);
            const b = r.v(here);
            return (
              <tr key={r.k}>
                <th scope="row"><U k={r.k} stack={false} /></th>
                <td className={a !== null && (b === null || a > b) ? 'more' : ''}>{typeof a === 'string' ? formatDay(a) : a ?? '—'}</td>
                <td className={b !== null && (a === null || b > a) ? 'more' : ''}>{typeof b === 'string' ? formatDay(b) : b ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {backup.exportedAt && <div className="muted small"><U k="settings.copyMade" stack={false} />: {formatDay(today(new Date(backup.exportedAt)))}</div>}
      <div className="import-choice">
        <button className="btn btn-primary btn-sm" onClick={() => apply('merge')}><Icon name="check" size={14} /> <U k="settings.merge" stack={false} /></button>
        <span className="muted small"><U k="settings.mergeDesc" stack={false} /></span>
      </div>
      <div className="import-choice">
        <button className="btn btn-coral btn-sm" onClick={() => apply('replace')}><Icon name="repeat" size={14} /> <U k="settings.replace" stack={false} /></button>
        <span className="muted small"><U k="settings.replaceDesc" stack={false} /></span>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onCancel}><U k="common.cancel" stack={false} /></button>
    </div>
  );
}

export function SettingsPage() {
  const st = useSettings();
  const reset = useProgress((s) => s.reset);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useUiString();
  const [msg, setMsg] = useState<Msg | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState<Backup | null>(null);
  const [codeOut, setCodeOut] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');

  const receive = async (text: string) => {
    setMsg(null);
    setCodeOut(null);
    try {
      const b = await parseBackup(text);
      if (hasProgress(progressSnapshot())) setPending(b);
      else {
        applyBackup(b, 'replace');
        setMsg({ ok: true, k: 'settings.imported' });
      }
      setPasteOpen(false);
      setPasted('');
    } catch {
      setMsg({ ok: false, k: 'settings.importError' });
    }
  };
  const copyCode = async () => {
    setMsg(null);
    setPending(null);
    const code = backupCode();
    try {
      await copyLater(code);
      setCodeOut(null);
      setMsg({ ok: true, k: 'settings.codeCopied', vars: { n: (await code).length } });
    } catch {
      setCodeOut(await code.catch(() => null));
      setMsg({ ok: false, k: 'settings.codeCopyManual' });
    }
  };

  const speechSample = glossary.get('test-automation')?.example.en;
  const Opt = <K extends keyof Settings>({ k, v, label }: { k: K; v: Settings[K]; label: string }) => (
    <button className={`seg-btn ${st[k] === v ? 'on' : ''}`} onClick={() => st.update({ [k]: v } as Partial<Settings>)}><U k={label} stack={false} /></button>
  );

  return (
    <div className="page page-narrow settings">
      <h1 className="page-title"><Icon name="gear" size={24} /> <U k="settings.title" /></h1>
      <section className="card set-card">
        <h2><Icon name="globe" size={18} /> <U k="settings.language" stack={false} /></h2>
        <p className="muted small"><U k="settings.languageDesc" stack={false} /></p>
        <div className="seg-row"><Opt k="lang" v="both" label="settings.both" /><Opt k="lang" v="en" label="settings.en" /><Opt k="lang" v="ru" label="settings.ru" /></div>
      </section>
      <section className="card set-card">
        <h2><Icon name="chat" size={18} /> <U k="settings.address" stack={false} /></h2>
        <div className="seg-row"><Opt k="gender" v="f" label="settings.female" /><Opt k="gender" v="m" label="settings.male" /></div>
      </section>
      <section className="card set-card">
        <h2><Icon name="moon" size={18} /> <U k="settings.theme" stack={false} /></h2>
        <div className="seg-row"><Opt k="theme" v="auto" label="settings.themeAuto" /><Opt k="theme" v="light" label="settings.themeLight" /><Opt k="theme" v="dark" label="settings.themeDark" /></div>
      </section>
      <section className="card set-card">
        <h2><Icon name="volume" size={18} /> <U k="settings.speech" stack={false} /></h2>
        <p className="muted small"><U k="settings.speechDesc" stack={false} /></p>
        <div className="seg-row"><Opt k="speechRate" v={1} label="settings.speechNormal" /><Opt k="speechRate" v={0.75} label="settings.speechSlow" /></div>
        {speechSample && <ListenButton text={speechSample} label />}
      </section>
      <section className="card set-card">
        <h2><Icon name="clock" size={18} /> <U k="settings.speed" stack={false} /></h2>
        <p className="muted small"><U k="settings.speedDesc" stack={false} /></p>
        <div className="range-row">
          <U k="settings.slow" stack={false} />
          <input type="range" min={0} max={1000} step={50} value={1000 - st.speed} onChange={(e) => st.update({ speed: 1000 - Number(e.target.value) })} />
          <U k="settings.fast" stack={false} />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={st.celebrations} onChange={(e) => st.update({ celebrations: e.target.checked })} />
          <span className="toggle-track"><span className="toggle-thumb" /></span>
          <U k="settings.motion" stack={false} />
        </label>
      </section>
      <section className="card set-card">
        <h2><Icon name="download" size={18} /> <U k="settings.progress" stack={false} /></h2>
        <p className="muted small"><U k="settings.progressDesc" stack={false} /></p>
        <div className={`chip ${st.backupAt ? 'chip-mint' : 'chip-butter'}`}>
          <Icon name="shield" size={14} /> {st.backupAt ? <U k="settings.lastBackup" vars={{ date: formatDay(st.backupAt) }} stack={false} /> : <U k="settings.noBackup" stack={false} />}
        </div>
        <div className="row gap wrap">
          <button className="btn btn-soft" onClick={downloadBackup}><Icon name="download" size={16} /> <U k="settings.export" stack={false} /></button>
          <button className="btn btn-soft" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> <U k="settings.import" stack={false} /></button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await receive(await f.text()); }} />
        </div>
        <div className="row gap wrap">
          <button className="btn btn-soft" onClick={copyCode}><Icon name="send" size={16} /> <U k="settings.copyCode" stack={false} /></button>
          <button className="btn btn-soft" onClick={() => { setPasteOpen(!pasteOpen); setMsg(null); }} aria-expanded={pasteOpen}><Icon name="code" size={16} /> <U k="settings.pasteCode" stack={false} /></button>
        </div>
        <p className="muted small"><U k="settings.codeHint" stack={false} /></p>
        {codeOut && <textarea className="code-box" readOnly value={codeOut} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label={s('settings.copyCode')} />}
        {pasteOpen && (
          <div className="paste-box">
            <textarea className="code-box" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} placeholder={s('settings.codePlaceholder')} aria-label={s('settings.pasteCode')} autoFocus />
            <button className="btn btn-primary btn-sm" disabled={!pasted.trim()} onClick={() => receive(pasted)}><Icon name="upload" size={14} /> <U k="settings.codeLoad" stack={false} /></button>
          </div>
        )}
        {pending && <ImportConfirm backup={pending} onDone={(m) => { setPending(null); setMsg(m); }} onCancel={() => setPending(null)} />}
        {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'}`} role="status"><U k={msg.k} vars={msg.vars} stack={false} /></div>}
        <button className="btn btn-soft" onClick={() => navigate('/placement')}><Icon name="compass" size={16} /> <U k="settings.placementRetake" stack={false} /></button>
        <div className="danger-zone">
          {!confirmReset ? (
            <button className="btn btn-ghost danger" onClick={() => setConfirmReset(true)}><Icon name="trash" size={16} /> <U k="settings.reset" stack={false} /></button>
          ) : (
            <div className="confirm-box">
              <U k="settings.resetConfirm" />
              <div className="row gap">
                <button className="btn btn-soft btn-sm" onClick={() => setConfirmReset(false)}><U k="common.cancel" stack={false} /></button>
                <button className="btn btn-coral btn-sm" onClick={() => { reset(); setConfirmReset(false); navigate('/'); }}><Icon name="trash" size={14} /> <U k="settings.reset" stack={false} /></button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const PLAYGROUND_CODE = `from playwright.sync_api import Page, expect


def test_customer_can_add_tulips_to_the_cart(page: Page):
    page.goto("/shop")
    (
        page.get_by_test_id("product-card")
        .filter(has_text="Sunny Tulips")
        .get_by_role("button", name="Add to cart")
        .click()
    )
    expect(page.get_by_test_id("cart-count")).to_have_text("1")
`;

const BUGS = ['login-trim', 'login-no-error', 'greeting-wrong-name', 'signup-terms-ignored', 'search-case-sensitive', 'sort-by-name', 'add-to-cart-double', 'cart-count-stale', 'cart-total-ignores-qty', 'remove-wrong-item', 'promo-case-sensitive', 'promo-stacks', 'free-delivery-boundary', 'checkout-past-date', 'orders-filter-wrong', 'orders-summary-wrong', 'a11y-add-to-cart-div', 'a11y-qty-unnamed', 'a11y-search-no-label'];

export function PlaygroundPage() {
  const [code, setCode] = useState(() => { try { return localStorage.getItem(PLAYGROUND_KEY) || PLAYGROUND_CODE; } catch { return PLAYGROUND_CODE; } });
  const [bugs, setBugs] = useState<string[]>([]);
  const [cookie, setCookie] = useState(false);
  const [slow, setSlow] = useState(false);
  const save = (c: string) => { setCode(c); try { localStorage.setItem(PLAYGROUND_KEY, c); } catch { /* ignore */ } };
  return (
    <div className="page page-wide">
      <h1 className="page-title"><Icon name="code" size={24} /> <U k="playground.title" /></h1>
      <p className="page-intro"><U k="playground.intro" /></p>
      <details className="card bug-panel">
        <summary><Icon name="bug" size={16} /> <U k="playground.bugs" stack={false} /> {bugs.length ? <span className="chip chip-coral">{bugs.length}</span> : null}</summary>
        <div className="chip-row">
          {BUGS.map((b) => (
            <label key={b} className={`chip-check ${bugs.includes(b) ? 'on' : ''}`}>
              <input type="checkbox" checked={bugs.includes(b)} onChange={(e) => setBugs(e.target.checked ? [...bugs, b] : bugs.filter((x) => x !== b))} />
              <code>{b}</code>
            </label>
          ))}
          <label className={`chip-check ${cookie ? 'on' : ''}`}><input type="checkbox" checked={cookie} onChange={(e) => setCookie(e.target.checked)} /> <U k="playground.cookie" stack={false} /></label>
          <label className={`chip-check ${slow ? 'on' : ''}`}><input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> <U k="playground.slow" stack={false} /></label>
        </div>
      </details>
      <CodeLab code={code} onCode={save} onReset={() => save(PLAYGROUND_CODE)} app={{ bugs, cookieBanner: cookie, latency: slow ? { products: [100, 1500], orders: [200, 2000], login: [100, 1200] } : undefined }} browserHeight={460} />
    </div>
  );
}

export function Onboarding() {
  const st = useSettings();
  const [step, setStep] = useState(0);
  const finish = (placement: boolean) => {
    st.update({ onboarded: true });
    navigate(placement ? '/placement' : '/');
  };
  return (
    <div className="onboarding">
      <div className="onb-card">
        <div className="onb-dots">{[0, 1, 2, 3].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
        {step === 0 && (
          <>
            <Mentor t={uiText('onboarding.hello')} mood="happy" />
            <Bi t={uiText('onboarding.pitch')} size="lg" />
            <button className="btn btn-primary btn-lg" onClick={() => setStep(1)}><U k="common.letsGo" stack={false} /> <Icon name="chevronRight" size={18} /></button>
          </>
        )}
        {step === 1 && (
          <>
            <h2><U k="onboarding.langTitle" /></h2>
            <p className="muted"><U k="onboarding.langDesc" /></p>
            <div className="onb-options">
              {(['both', 'en', 'ru'] as const).map((v) => (
                <button key={v} className={`onb-opt ${st.lang === v ? 'on' : ''}`} onClick={() => st.update({ lang: v })}>
                  <strong><U k={`settings.${v}`} stack={false} /></strong>
                  <span className="muted small">{v === 'both' ? 'Locator — локатор' : v === 'en' ? 'Locator' : 'Локатор'}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => setStep(2)}><U k="common.next" stack={false} /> <Icon name="chevronRight" size={18} /></button>
          </>
        )}
        {step === 2 && (
          <>
            <h2><U k="onboarding.formTitle" /></h2>
            <div className="onb-options">
              <button className={`onb-opt ${st.gender === 'f' ? 'on' : ''}`} onClick={() => st.update({ gender: 'f' })}><strong>Ты справилась</strong></button>
              <button className={`onb-opt ${st.gender === 'm' ? 'on' : ''}`} onClick={() => st.update({ gender: 'm' })}><strong>Ты справился</strong></button>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => setStep(3)}><U k="common.next" stack={false} /> <Icon name="chevronRight" size={18} /></button>
          </>
        )}
        {step === 3 && (
          <>
            <h2><U k="onboarding.placementTitle" /></h2>
            <Bi t={uiText('onboarding.placementDesc')} vars={placementVars()} />
            <div className="onb-options col">
              <button className="btn btn-primary btn-lg" onClick={() => finish(true)}><Icon name="compass" size={18} /> <U k="onboarding.placementYes" stack={false} /></button>
              <button className="btn btn-soft btn-lg" onClick={() => finish(false)}><Icon name="play" size={18} /> <U k="onboarding.placementNo" stack={false} /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
