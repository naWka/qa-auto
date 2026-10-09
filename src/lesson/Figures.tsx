// Small explanatory diagrams built from HTML so labels stay bilingual and responsive.
import { BiInline } from '../components/Bi';
import { CodeView } from '../components/CodeView';
import { Icon } from '../components/Icon';
import { Person, Petal } from '../components/Characters';

function Node({ icon, title, sub, tone }: { icon: React.ReactNode; title: { en: string; ru: string }; sub?: { en: string; ru: string }; tone: string }) {
  return (
    <div className={`fig-node tone-${tone}`}>
      <div className="fig-icon">{icon}</div>
      <div className="fig-text">
        <BiInline t={title} className="fig-title" />
        {sub && <BiInline t={sub} className="fig-sub" />}
      </div>
    </div>
  );
}

const Arrow = () => <div className="fig-arrow" aria-hidden="true"><Icon name="chevronRight" size={18} /></div>;

function AgentLoop() {
  return (
    <div className="figure fig-flow">
      <Node tone="lavender" icon={<Person who="you" size={36} />} title={{ en: 'You: prompt', ru: 'Ты: промпт' }} sub={{ en: 'goal, steps, data, expected result', ru: 'цель, шаги, данные, ожидаемый результат' }} />
      <Arrow />
      <Node tone="rose" icon={<Petal size={36} />} title={{ en: 'Agent reads context', ru: 'Агент читает контекст' }} sub={{ en: 'your prompt + project files', ru: 'твой промпт + файлы проекта' }} />
      <Arrow />
      <Node tone="sky" icon={<Icon name="globe" size={26} />} title={{ en: 'Opens the browser', ru: 'Открывает браузер' }} sub={{ en: 'Playwright MCP / CLI → accessibility snapshot', ru: 'Playwright MCP / CLI → снапшот доступности' }} />
      <Arrow />
      <Node tone="peach" icon={<Icon name="code" size={26} />} title={{ en: 'Writes & runs the test', ru: 'Пишет и запускает тест' }} sub={{ en: 'npx playwright test', ru: 'npx playwright test' }} />
      <Arrow />
      <Node tone="mint" icon={<Icon name="eye" size={26} />} title={{ en: 'You review & verify', ru: 'Ты ревьюишь и проверяешь' }} sub={{ en: 'does it check what matters?', ru: 'проверяет ли он то, что важно?' }} />
    </div>
  );
}

function TestAnatomy() {
  const code = `import { test, expect } from '@playwright/test';

test('registered user can log in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('anna@bloomly.app');
  await page.getByLabel('Password').fill('bloom123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Anna!' })).toBeVisible();
});`;
  const cls = (n: number) => (n === 3 ? 'fig-l-title' : n >= 4 && n <= 7 ? 'fig-l-steps' : n === 8 ? 'fig-l-expect' : '');
  return (
    <div className="figure fig-anatomy">
      <CodeView code={code} lineClass={cls} />
      <div className="fig-legend">
        <span className="leg leg-title"><BiInline t={{ en: 'Test case title', ru: 'Название тест-кейса' }} stack={false} /></span>
        <span className="leg leg-steps"><BiInline t={{ en: 'Steps → actions', ru: 'Шаги → действия' }} stack={false} /></span>
        <span className="leg leg-expect"><BiInline t={{ en: 'Expected result → assertion', ru: 'Ожидаемый результат → проверка' }} stack={false} /></span>
      </div>
    </div>
  );
}

function ManualVsAuto() {
  const rows: [{ en: string; ru: string }, string][] = [
    [{ en: 'Open the login page', ru: 'Открыть страницу входа' }, "page.goto('/login')"],
    [{ en: 'Enter email and password', ru: 'Ввести email и пароль' }, "getByLabel('Email').fill(…)"],
    [{ en: 'Click “Log in”', ru: 'Нажать «Log in»' }, "getByRole('button', …).click()"],
    [{ en: 'Expected: greeting is shown', ru: 'Ожидается: приветствие видно' }, 'expect(…).toBeVisible()'],
  ];
  return (
    <div className="figure fig-mva">
      <div className="mva-head"><BiInline t={{ en: 'Manual: you', ru: 'Вручную: ты' }} /><BiInline t={{ en: 'Automated: code', ru: 'Автотест: код' }} /></div>
      {rows.map(([m, c], i) => (
        <div key={i} className={`mva-row ${i === rows.length - 1 ? 'mva-expect' : ''}`}>
          <div className="mva-manual"><span className="mva-n">{i + 1}</span><BiInline t={m} /></div>
          <Icon name="chevronRight" size={18} />
          <code className="mva-code">{c}</code>
        </div>
      ))}
      <div className="mva-foot">
        <span><Icon name="clock" size={15} /> <BiInline t={{ en: '400 cases by hand: ~3 days', ru: '400 кейсов вручную: ~3 дня' }} stack={false} /></span>
        <span><Icon name="sparkle" size={15} /> <BiInline t={{ en: 'Automated regression: minutes, every release', ru: 'Автоматический регресс: минуты, каждый релиз' }} stack={false} /></span>
      </div>
    </div>
  );
}

function DomTree() {
  const T = ({ tag, attrs, children, tone }: { tag: string; attrs?: string; children?: React.ReactNode; tone?: string }) => (
    <div className={`dom-node ${tone ? `tone-${tone}` : ''}`}>
      <code>&lt;{tag}{attrs ? ` ${attrs}` : ''}&gt;</code>
      {children && <div className="dom-children">{children}</div>}
    </div>
  );
  return (
    <div className="figure fig-dom">
      <T tag="main">
        <T tag="h1" tone="lavender"><span className="dom-text">Log in</span></T>
        <T tag="form" attrs='id="login-form"'>
          <T tag="label" attrs='for="email"'><span className="dom-text">Email</span></T>
          <T tag="input" attrs='id="email" type="text"' tone="mint" />
          <T tag="button" attrs='type="submit" data-testid="login-button"' tone="rose"><span className="dom-text">Log in</span></T>
        </T>
      </T>
    </div>
  );
}

function ReviewChecklist() {
  const items = [
    { en: 'Does it check the expected result from the test case?', ru: 'Проверяет ли тест ожидаемый результат из тест-кейса?' },
    { en: 'Is there a real assertion (not just “no errors”)?', ru: 'Есть ли настоящая проверка (а не просто «без ошибок»)?' },
    { en: 'Are the locators resilient (role, label, test id)?', ru: 'Устойчивые ли локаторы (роль, подпись, test id)?' },
    { en: 'No hard waits, no missing awaits?', ru: 'Нет жёстких ожиданий и пропущенных await?' },
    { en: 'Right test data, independent of other tests?', ru: 'Верные данные, тест независим от других?' },
  ];
  return (
    <div className="figure fig-checklist">
      {items.map((t, i) => (
        <div key={i} className="check-item"><span className="check-n">{i + 1}</span><BiInline t={t} /></div>
      ))}
    </div>
  );
}

function RedGreen() {
  return (
    <div className="figure fig-redgreen">
      <div className="rg-card rg-red">
        <Icon name="bug" size={22} />
        <BiInline t={{ en: 'Buggy build → test is RED', ru: 'Версия с багом → тест КРАСНЫЙ' }} />
      </div>
      <Icon name="chevronRight" size={20} />
      <div className="rg-card rg-green">
        <Icon name="shield" size={22} />
        <BiInline t={{ en: 'Fixed build → test is GREEN', ru: 'Исправленная версия → тест ЗЕЛЁНЫЙ' }} />
      </div>
      <div className="rg-note"><BiInline t={{ en: 'Only then do you trust it: you have seen it fail for the right reason.', ru: 'Только тогда ему можно верить: ты видел{а|} его падение по правильной причине.' }} /></div>
    </div>
  );
}

export function Figure({ id }: { id: string }) {
  switch (id) {
    case 'agent-loop': return <AgentLoop />;
    case 'test-anatomy': return <TestAnatomy />;
    case 'manual-vs-auto': return <ManualVsAuto />;
    case 'dom-tree': return <DomTree />;
    case 'review-checklist': return <ReviewChecklist />;
    case 'red-green': return <RedGreen />;
    default: return null;
  }
}
