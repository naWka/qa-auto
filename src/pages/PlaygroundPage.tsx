// Playground: a bug hunt (pick a bug report, change Petal's draft test until it catches the bug)
// and a free mode (any test, any bugs switched on).
import { useEffect, useRef, useState } from 'react';
import { playground } from '../content';
import type { Checks, HuntBug } from '../content/schema';
import { Bi, BiInline, P, U, usePrimary, useUiString } from '../components/Bi';
import { Icon } from '../components/Icon';
import { CodeView } from '../components/CodeView';
import { Petal } from '../components/Characters';
import { CodeLab, type LabHandle } from '../lab/CodeLab';
import type { AppSetup } from '../emulator';
import { gradeCode, type CodeVerdict } from '../tasks/gradeCode';
import { useProgress } from '../store/progress';
import { PLAYGROUND_KEY } from '../store/backup';
import { sparkles } from '../lib/celebrate';

/** Mode, chosen bug and the student's drafts per bug (drafts stay in this browser only). */
const HUNT_KEY = 'bloomqa-playground-hunt';
interface HuntSaved { mode: 'hunt' | 'free'; bug?: string; drafts: Record<string, string> }

function readSaved(): HuntSaved {
  try {
    const v = JSON.parse(localStorage.getItem(HUNT_KEY) || '{}') as Partial<HuntSaved>;
    return { mode: v.mode === 'free' ? 'free' : 'hunt', bug: v.bug, drafts: v.drafts || {} };
  } catch {
    return { mode: 'hunt', drafts: {} };
  }
}
function writeSaved(v: HuntSaved) {
  try { localStorage.setItem(HUNT_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}

const BUGS = playground.bugs;
const bugById = new Map(BUGS.map((b) => [b.id, b]));
const starterOf = (b: HuntBug) => playground.starters[b.starter] ?? '';
/** "rose-bouquet" → "Rose Bouquet" */
const productName = (id: string) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export function PlaygroundPage() {
  const [saved, setSaved] = useState(readSaved);
  const update = (patch: Partial<HuntSaved>) => setSaved((s) => { const v = { ...s, ...patch }; writeSaved(v); return v; });
  const s = useUiString();
  return (
    <div className="page page-wide">
      <h1 className="page-title"><Icon name="code" size={24} /> <U k="playground.title" /></h1>
      <p className="page-intro"><U k="playground.intro" /></p>
      <div className="seg-ctl playground-modes" role="tablist" aria-label={s('playground.title')}>
        <button role="tab" aria-selected={saved.mode === 'hunt'} className={saved.mode === 'hunt' ? 'on' : ''} onClick={() => update({ mode: 'hunt' })}>
          <Icon name="bug" size={15} /> <P k="playground.modeHunt" />
        </button>
        <button role="tab" aria-selected={saved.mode === 'free'} className={saved.mode === 'free' ? 'on' : ''} onClick={() => update({ mode: 'free' })}>
          <Icon name="code" size={15} /> <P k="playground.modeFree" />
        </button>
      </div>
      {saved.mode === 'hunt'
        ? <BugHunt saved={saved} update={update} />
        : <FreeMode />}
    </div>
  );
}

function BugHunt({ saved, update }: { saved: HuntSaved; update: (p: Partial<HuntSaved>) => void }) {
  const hunted = useProgress((p) => p.hunted) ?? {};
  const catchBug = useProgress((p) => p.catchBug);
  // Without a saved choice: the first bug not caught yet, fixed for this visit (catching it must not switch the page).
  const [firstOpen] = useState(() => BUGS.find((b) => !hunted[b.id]) ?? BUGS[0]);
  const bug = bugById.get(saved.bug ?? '') ?? firstOpen;
  const [area, setArea] = useState(bug.area);
  const [bugOn, setBugOn] = useState(true);
  const [verdict, setVerdict] = useState<CodeVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(false);
  const lab = useRef<LabHandle | null>(null);
  const checkBtn = useRef<HTMLButtonElement>(null);
  const s = useUiString();
  const primary = usePrimary();

  const code = saved.drafts[bug.id] ?? starterOf(bug);
  const setCode = (c: string) => { update({ drafts: { ...saved.drafts, [bug.id]: c } }); setVerdict(null); };
  const fixedApp: AppSetup = { state: bug.app?.state };
  const buggyApp: AppSetup = { ...fixedApp, bugs: [bug.id] };

  useEffect(() => { setVerdict(null); setHint(false); setBugOn(true); }, [bug.id]);

  const pick = (id: string) => update({ bug: id });
  const caughtCount = BUGS.filter((b) => hunted[b.id]).length;
  const nextBug = BUGS.slice(BUGS.indexOf(bug) + 1).concat(BUGS).find((b) => !hunted[b.id] && b.id !== bug.id);

  const check = async () => {
    if (!lab.current) return;
    setBusy(true);
    setVerdict(null);
    const checks: Checks = { expect: 'fail', also: [{ app: { state: bug.app?.state }, expect: 'pass' }] };
    const run = (c: string, app: AppSetup | undefined, silent: boolean) => lab.current!.run({ code: c, app, silent, fast: silent });
    const v = await gradeCode(code, checks, buggyApp, run);
    setVerdict(v);
    setBusy(false);
    if (v.ok && catchBug(bug.id)) sparkles(checkBtn.current);
  };

  const state = bug.app?.state;
  const pre = [
    state?.user && s('playground.loggedIn', { email: state.user }),
    state?.cart?.length && s('playground.cart', { items: state.cart.map((c) => `${c.qty} × ${productName(c.id)}`).join(', ') }),
    state?.promo && s('playground.promo', { code: state.promo }),
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="hunt-top">
        <section className="card hunt-board" aria-label={s('playground.tracker')}>
          <div className="hunt-board-head">
            <h2><Icon name="bug" size={18} /> <U k="playground.tracker" stack={false} /></h2>
            <span className="chip chip-lavender"><U k="playground.caughtOf" vars={{ n: caughtCount, total: BUGS.length }} stack={false} /></span>
          </div>
          <div className="hunt-areas" role="tablist">
            {playground.areas.map((a) => {
              const list = BUGS.filter((b) => b.area === a.id);
              const done = list.filter((b) => hunted[b.id]).length;
              return (
                <button key={a.id} role="tab" aria-selected={area === a.id} className={`chip-btn ${area === a.id ? 'on' : ''}`} onClick={() => setArea(a.id)}>
                  {primary(a.title)} <span className="hunt-area-count">{done}/{list.length}</span>
                </button>
              );
            })}
          </div>
          <ul className="hunt-list">
            {BUGS.filter((b) => b.area === area).map((b) => (
              <li key={b.id}>
                <button className={`hunt-item ${b.id === bug.id ? 'on' : ''} ${hunted[b.id] ? 'caught' : ''}`} aria-current={b.id === bug.id} disabled={busy} onClick={() => pick(b.id)}>
                  <span className="hunt-mark" aria-hidden="true"><Icon name={hunted[b.id] ? 'check' : 'bug'} size={14} /></span>
                  <BiInline t={b.title} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card bug-report" aria-live="polite">
          <div className="bug-report-head">
            <code className="bug-id">{bug.id}</code>
            {hunted[bug.id] && <span className="chip chip-mint"><Icon name="check" size={13} /> <U k="playground.caught" stack={false} /></span>}
          </div>
          <h2 className="bug-report-title"><BiInline t={bug.title} /></h2>
          {pre.length > 0 && (
            <div className="br-field">
              <h3><U k="playground.preconditions" stack={false} /></h3>
              <ul className="br-pre">{pre.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          <div className="br-field">
            <h3><U k="playground.steps" stack={false} /></h3>
            <Bi t={bug.steps} size="sm" />
          </div>
          <div className="br-results">
            <div className="br-field br-expected">
              <h3><U k="playground.expected" stack={false} /></h3>
              <Bi t={bug.expected} size="sm" />
            </div>
            <div className="br-field br-actual">
              <h3><U k="playground.actual" stack={false} /></h3>
              <Bi t={bug.actual} size="sm" />
            </div>
          </div>
          <div className="petal-note">
            <Petal size={34} />
            <div>
              <U k="playground.petalDraft" />
              <div className="muted small petal-goal"><Icon name="target" size={13} /> <U k="playground.goal" stack={false} /></div>
            </div>
          </div>
          <div className="hunt-actions">
            <button ref={checkBtn} className="btn btn-primary" onClick={check} disabled={busy}>
              {busy ? <span className="spinner light" /> : <Icon name="target" size={16} />} <U k="playground.check" stack={false} />
            </button>
            <button className={`btn btn-soft btn-sm ${hint ? 'on' : ''}`} aria-expanded={hint} onClick={() => setHint(!hint)}>
              <Icon name="bulb" size={15} /> <U k="playground.hint" stack={false} />
            </button>
          </div>
          {hint && (
            <div className="hint">
              <div className="hint-label"><Icon name="bulb" size={13} /> <U k="playground.hint" stack={false} /></div>
              <Bi t={bug.hint} size="sm" />
            </div>
          )}
          {verdict && (
            <div className={`verdict ${verdict.ok ? 'ok' : 'bad'}`}>
              <div className="verdict-runs">
                {verdict.main && (
                  <span className={`chip ${verdict.main.status === 'failed' ? 'chip-mint' : 'chip-coral'}`}>
                    <Icon name="bug" size={13} /> <U k="task.runOnBuggy" stack={false} />: {verdict.main.status === 'passed' ? '✓ pass' : '✗ fail'}
                  </span>
                )}
                {verdict.also.map((a, i) => (
                  <span key={i} className={`chip ${a.ok ? 'chip-mint' : 'chip-coral'}`}>
                    <Icon name="shield" size={13} /> <U k="task.runOnFixed" stack={false} />: {a.result.status === 'passed' ? '✓ pass' : '✗ fail'}
                  </span>
                ))}
              </div>
              {!verdict.ok && <ul>{verdict.problems.map((p, i) => <li key={i}><Bi t={p} size="sm" /></li>)}</ul>}
              {verdict.ok && (
                <div className="verdict-caught">
                  <U k="playground.caughtMsg" />
                  {nextBug && (
                    <button className="btn btn-soft btn-sm" onClick={() => { setArea(nextBug.area); pick(nextBug.id); }}>
                      <U k="playground.nextBug" stack={false} /> <Icon name="chevronRight" size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <details className="hunt-solution">
            <summary><Icon name="eye" size={15} /> <U k="playground.solution" stack={false} /></summary>
            <CodeView code={bug.solution} />
            <button className="btn btn-ghost btn-sm" onClick={() => setCode(bug.solution)}><Icon name="code" size={15} /> <U k="playground.useSolution" stack={false} /></button>
          </details>
        </section>
      </div>

      <CodeLab
        key={bug.id}
        code={code}
        onCode={setCode}
        onReset={() => setCode(starterOf(bug))}
        app={bugOn ? buggyApp : fixedApp}
        labRef={lab}
        browserHeight={460}
        actions={(
          <label className="toggle" title={s('playground.bugOnTitle')}>
            <input type="checkbox" checked={bugOn} onChange={(e) => setBugOn(e.target.checked)} />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
            <Icon name="bug" size={14} /> <U k="playground.bugOn" stack={false} />
          </label>
        )}
      />
    </>
  );
}

const FREE_CODE = `from playwright.sync_api import Page, expect


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

function FreeMode() {
  const [code, setCode] = useState(() => { try { return localStorage.getItem(PLAYGROUND_KEY) || FREE_CODE; } catch { return FREE_CODE; } });
  const [bugs, setBugs] = useState<string[]>([]);
  const [cookie, setCookie] = useState(false);
  const [slow, setSlow] = useState(false);
  const save = (c: string) => { setCode(c); try { localStorage.setItem(PLAYGROUND_KEY, c); } catch { /* ignore */ } };
  const toggle = (id: string, on: boolean) => setBugs(on ? [...bugs, id] : bugs.filter((x) => x !== id));
  const primary = usePrimary();
  return (
    <>
      <details className="card bug-panel">
        <summary><Icon name="bug" size={16} /> <U k="playground.bugs" stack={false} /> {bugs.length ? <span className="chip chip-coral">{bugs.length}</span> : null}</summary>
        {playground.areas.map((a) => (
          <div key={a.id} className="bug-group">
            <h3><BiInline t={a.title} stack={false} /></h3>
            <div className="chip-row">
              {BUGS.filter((b) => b.area === a.id).map((b) => (
                <label key={b.id} className={`chip-check ${bugs.includes(b.id) ? 'on' : ''}`} title={b.id}>
                  <input type="checkbox" checked={bugs.includes(b.id)} onChange={(e) => toggle(b.id, e.target.checked)} />
                  {primary(b.title)}
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="chip-row">
          <label className={`chip-check ${cookie ? 'on' : ''}`}><input type="checkbox" checked={cookie} onChange={(e) => setCookie(e.target.checked)} /> <U k="playground.cookie" stack={false} /></label>
          <label className={`chip-check ${slow ? 'on' : ''}`}><input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> <U k="playground.slow" stack={false} /></label>
        </div>
      </details>
      <CodeLab code={code} onCode={save} onReset={() => save(FREE_CODE)} app={{ bugs, cookieBanner: cookie, latency: slow ? { products: [100, 1500], orders: [200, 2000], login: [100, 1200] } : undefined }} browserHeight={460} />
    </>
  );
}
