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
      <Node tone="butter" icon={<Petal size={36} />} title={{ en: 'Agent reads context', ru: 'Агент читает контекст' }} sub={{ en: 'your prompt + project files', ru: 'твой промпт + файлы проекта' }} />
      <Arrow />
      <Node tone="sky" icon={<Icon name="globe" size={26} />} title={{ en: 'Opens the browser', ru: 'Открывает браузер' }} sub={{ en: 'Playwright MCP / CLI → accessibility snapshot', ru: 'Playwright MCP / CLI → снапшот доступности' }} />
      <Arrow />
      <Node tone="peach" icon={<Icon name="code" size={26} />} title={{ en: 'Writes & runs the test', ru: 'Пишет и запускает тест' }} sub={{ en: 'pytest', ru: 'pytest' }} />
      <Arrow />
      <Node tone="mint" icon={<Icon name="eye" size={26} />} title={{ en: 'You review & verify', ru: 'Ты ревьюишь и проверяешь' }} sub={{ en: 'does it check what matters?', ru: 'проверяет ли он то, что важно?' }} />
    </div>
  );
}

function TestAnatomy() {
  const code = `from playwright.sync_api import Page, expect


def test_registered_user_can_log_in(page: Page):
    page.goto("/login")
    page.get_by_label("Email").fill("anna@bloomly.app")
    page.get_by_label("Password").fill("bloom123")
    page.get_by_role("button", name="Log in").click()
    expect(page.get_by_role("heading", name="Welcome back, Anna!")).to_be_visible()`;
  const cls = (n: number) => (n === 4 ? 'fig-l-title' : n >= 5 && n <= 8 ? 'fig-l-steps' : n === 9 ? 'fig-l-expect' : '');
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
    [{ en: 'Open the login page', ru: 'Открыть страницу входа' }, 'page.goto("/login")'],
    [{ en: 'Enter email and password', ru: 'Ввести email и пароль' }, 'get_by_label("Email").fill(…)'],
    [{ en: 'Click “Log in”', ru: 'Нажать «Log in»' }, 'get_by_role("button", …).click()'],
    [{ en: 'Expected: greeting is shown', ru: 'Ожидается: приветствие видно' }, 'expect(…).to_be_visible()'],
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
          <T tag="input" attrs='id="email" type="text"' tone="sky" />
          <T tag="button" attrs='type="submit" data-testid="login-button"' tone="peach"><span className="dom-text">Log in</span></T>
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
    { en: 'No hard waits, no methods without ()?', ru: 'Нет жёстких ожиданий и методов без ()?' },
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


type TT = { en: string; ru: string };

function LocatorPriority() {
  const rows: [string, TT, string][] = [
    ['get_by_role("button", name="Log in")', { en: 'What everyone sees: role + accessible name', ru: 'То, что видят все: роль + доступное имя' }, 'mint'],
    ['get_by_label("Email")', { en: 'Form fields by their label', ru: 'Поля формы по подписи' }, 'mint'],
    ['get_by_text("Your cart is empty.") · get_by_placeholder(…)', { en: 'Visible text; placeholder only without a label', ru: 'Видимый текст; placeholder — только если нет подписи' }, 'sky'],
    ['get_by_test_id("cart-total")', { en: 'A contract with developers: stable, invisible to users', ru: 'Договорённость с разработчиками: стабильно, но не видно пользователю' }, 'butter'],
    ["locator('#login-form > button.btn')", { en: 'CSS / XPath: last resort, breaks on redesign', ru: 'CSS / XPath: крайний случай, ломается от редизайна' }, 'coral'],
  ];
  return (
    <div className="figure fig-ladder">
      {rows.map(([code, t, tone], i) => (
        <div key={i} className={`ladder-row tone-${tone}`}>
          <span className="ladder-n">{i + 1}</span>
          <code className="ladder-code">{code}</code>
          <BiInline t={t} className="ladder-text" />
        </div>
      ))}
    </div>
  );
}

function Actionability() {
  const steps: [TT, TT][] = [
    [{ en: 'Attached', ru: 'В DOM' }, { en: 'the element exists', ru: 'элемент существует' }],
    [{ en: 'Visible', ru: 'Видим' }, { en: 'has a size, not hidden', ru: 'имеет размер, не скрыт' }],
    [{ en: 'Stable', ru: 'Неподвижен' }, { en: 'not animating', ru: 'не анимируется' }],
    [{ en: 'Enabled', ru: 'Активен' }, { en: 'not disabled', ru: 'не disabled' }],
    [{ en: 'Receives events', ru: 'Принимает клики' }, { en: 'not covered by a banner', ru: 'не закрыт баннером' }],
  ];
  return (
    <div className="figure">
      <div className="fig-flow fig-flow-tight">
        {steps.map(([t, sub], i) => (
          <div key={i} className="fig-step-wrap">
            <Node tone="mint" icon={<Icon name="check" size={20} />} title={t} sub={sub} />
            {i < steps.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
      <div className="fig-caption"><Icon name="clock" size={14} /> <BiInline t={{ en: 'Playwright re-checks all of this until it passes or the timeout ends — then it acts.', ru: 'Playwright перепроверяет всё это, пока условия не выполнятся или не выйдет тайм-аут, — и только потом действует.' }} stack={false} /></div>
    </div>
  );
}

function FlakyCauses() {
  const cards: [string, TT, TT][] = [
    ['clock', { en: 'Race condition', ru: 'Состояние гонки' }, { en: 'The test reads before the app is done: “Loading products…” is still on screen.', ru: 'Тест читает раньше, чем приложение закончило: на экране ещё «Loading products…».' }],
    ['globe', { en: 'Variable latency', ru: 'Плавающие задержки' }, { en: 'Fast today, slow tomorrow: hidden timing assumptions break.', ru: 'Сегодня быстро, завтра медленно: скрытые допущения о времени ломаются.' }],
    ['repeat', { en: 'Shared state', ru: 'Общее состояние' }, { en: 'The same user, cart or order — tests depend on each other’s leftovers.', ru: 'Один пользователь, корзина или заказ — тесты зависят от чужих остатков.' }],
    ['bug', { en: 'A real bug', ru: 'Настоящий баг' }, { en: 'Sometimes the app itself is flaky — then it’s a bug report, not a test fix.', ru: 'Иногда нестабильно само приложение — тогда это баг-репорт, а не правка теста.' }],
  ];
  return (
    <div className="figure fig-cards">
      {cards.map(([icon, t, d], i) => (
        <div key={i} className="fig-card">
          <div className="fig-card-head"><Icon name={icon} size={18} /> <BiInline t={t} className="fig-title" /></div>
          <BiInline t={d} className="fig-sub" />
        </div>
      ))}
    </div>
  );
}

function Gate({ label }: { label: TT }) {
  return <div className="fig-gate"><Icon name="eye" size={14} /> <BiInline t={label} stack={false} /></div>;
}

function TestAgents() {
  return (
    <div className="figure">
      <div className="fig-flow">
        <Node tone="lavender" icon={<Person who="you" size={34} />} title={{ en: 'You', ru: 'Ты' }} sub={{ en: 'request + seed test', ru: 'запрос + seed-тест' }} />
        <Arrow />
        <Node tone="butter" icon={<Icon name="map" size={24} />} title={{ en: 'Planner', ru: 'Планировщик' }} sub={{ en: 'explores the app → specs/plan.md', ru: 'исследует приложение → specs/plan.md' }} />
        <Arrow />
        <Node tone="sky" icon={<Icon name="code" size={24} />} title={{ en: 'Generator', ru: 'Генератор' }} sub={{ en: 'plan → tests/test_*.py, checks locators live', ru: 'план → tests/test_*.py, сверяет локаторы вживую' }} />
        <Arrow />
        <Node tone="peach" icon={<Icon name="wand" size={24} />} title={{ en: 'Healer', ru: 'Хилер' }} sub={{ en: 'failing test → fix or xfail + bug report', ru: 'упавший тест → исправление или xfail + баг-репорт' }} />
      </div>
      <div className="fig-gates">
        <Gate label={{ en: 'Gate 1: you approve the plan', ru: 'Точка 1: ты утверждаешь план' }} />
        <Gate label={{ en: 'Gate 2: you review the code', ru: 'Точка 2: ты проверяешь код' }} />
        <Gate label={{ en: 'Gate 3: you review every heal', ru: 'Точка 3: ты проверяешь каждое «лечение»' }} />
      </div>
    </div>
  );
}

function ReviewGates() {
  const gates: [TT, TT][] = [
    [{ en: 'Plan', ru: 'План' }, { en: 'Right scenarios? Risks, boundaries, negatives?', ru: 'Те ли сценарии? Риски, границы, негативные случаи?' }],
    [{ en: 'Code', ru: 'Код' }, { en: 'Five review questions for every test', ru: 'Пять вопросов ревью к каждому тесту' }],
    [{ en: 'Proof', ru: 'Доказательство' }, { en: 'Each test goes red when its bug comes back', ru: 'Каждый тест краснеет, когда возвращается его баг' }],
    [{ en: 'Heals', ru: 'Лечение' }, { en: 'Honest fix — or bug report + @pytest.mark.xfail', ru: 'Честное исправление — или баг-репорт + @pytest.mark.xfail' }],
  ];
  return (
    <div className="figure fig-flow">
      {gates.map(([t, d], i) => (
        <div key={i} className="fig-step-wrap">
          <Node tone={['lavender', 'sky', 'mint', 'peach'][i]} icon={<Icon name="shield" size={22} />} title={t} sub={d} />
          {i < gates.length - 1 && <Arrow />}
        </div>
      ))}
    </div>
  );
}

function PageObject() {
  return (
    <div className="figure fig-pom">
      <div className="pom-col">
        {['test_login.py', 'test_cart.py', 'test_orders.py'].map((f) => (
          <div key={f} className="pom-file"><Icon name="code" size={14} /> {f}<span className="pom-call">login_page.log_in(…)</span></div>
        ))}
      </div>
      <Arrow />
      <div className="pom-class">
        <div className="pom-title"><Icon name="books" size={16} /> LoginPage</div>
        <div className="pom-part"><BiInline t={{ en: 'Locators', ru: 'Локаторы' }} stack={false} /><code>email · password · submit</code></div>
        <div className="pom-part"><BiInline t={{ en: 'Actions', ru: 'Действия' }} stack={false} /><code>open() · log_in(email, password)</code></div>
        <div className="pom-note"><BiInline t={{ en: 'The button was renamed? Change one line here.', ru: 'Переименовали кнопку? Меняешь одну строку здесь.' }} /></div>
      </div>
      <Arrow />
      <div className="pom-page"><Icon name="globe" size={18} /> /login</div>
    </div>
  );
}

function FixtureLifecycle() {
  return (
    <div className="figure fig-flow">
      <Node tone="mint" icon={<Icon name="wand" size={22} />} title={{ en: 'Setup', ru: 'Подготовка' }} sub={{ en: 'code before yield: log in, fill the cart', ru: 'код до yield: войти, наполнить корзину' }} />
      <Arrow />
      <Node tone="lavender" icon={<Icon name="play" size={22} />} title={{ en: 'yield value', ru: 'yield value' }} sub={{ en: 'the test runs with the ready value', ru: 'тест выполняется с готовым значением' }} />
      <Arrow />
      <Node tone="peach" icon={<Icon name="trash" size={22} />} title={{ en: 'Teardown', ru: 'Уборка' }} sub={{ en: 'code after yield: clean up, even if the test failed', ru: 'код после yield: уборка, даже если тест упал' }} />
    </div>
  );
}

function HttpExchange() {
  return (
    <div className="figure fig-http">
      <div className="http-card http-req">
        <div className="http-head"><span className="http-method">POST</span> /api/login</div>
        <div className="http-sub"><BiInline t={{ en: 'Headers', ru: 'Заголовки' }} stack={false} /></div>
        <code>Content-Type: application/json</code>
        <div className="http-sub"><BiInline t={{ en: 'Body (JSON)', ru: 'Тело (JSON)' }} stack={false} /></div>
        <pre>{'{ "email": "anna@bloomly.app",\n  "password": "bloom123" }'}</pre>
      </div>
      <Arrow />
      <div className="http-card http-res">
        <div className="http-head"><span className="http-status">200 OK</span></div>
        <div className="http-sub"><BiInline t={{ en: 'Headers', ru: 'Заголовки' }} stack={false} /></div>
        <code>content-type: application/json</code>
        <div className="http-sub"><BiInline t={{ en: 'Body (JSON)', ru: 'Тело (JSON)' }} stack={false} /></div>
        <pre>{'{ "token": "token-anna%40bloomly.app",\n  "user": { "name": "Anna Silva" } }'}</pre>
      </div>
    </div>
  );
}

function UiVsApi() {
  return (
    <div className="figure fig-uiapi">
      <div className="uiapi-row">
        <span className="uiapi-label"><Icon name="globe" size={16} /> <BiInline t={{ en: 'Setup through the UI', ru: 'Подготовка через UI' }} stack={false} /></span>
        <div className="uiapi-bar ui"><span>/login → fill → click → /shop → wait → add × 3 → /cart</span></div>
        <span className="uiapi-time">~8 s</span>
      </div>
      <div className="uiapi-row">
        <span className="uiapi-label"><Icon name="terminal" size={16} /> <BiInline t={{ en: 'Setup through the API', ru: 'Подготовка через API' }} stack={false} /></span>
        <div className="uiapi-bar api"><span>POST /api/login · POST /api/orders</span></div>
        <span className="uiapi-time">~0.1 s</span>
      </div>
      <div className="fig-caption"><Icon name="target" size={14} /> <BiInline t={{ en: 'Then check through the UI only what you are actually testing.', ru: 'А через UI проверяй только то, что действительно тестируешь.' }} stack={false} /></div>
    </div>
  );
}

function CiPipeline() {
  return (
    <div className="figure fig-flow">
      <Node tone="lavender" icon={<Icon name="upload" size={22} />} title={{ en: 'Push / pull request', ru: 'Push / pull request' }} sub={{ en: 'git push origin my-branch', ru: 'git push origin my-branch' }} />
      <Arrow />
      <Node tone="sky" icon={<Icon name="gear" size={22} />} title={{ en: 'GitHub Actions', ru: 'GitHub Actions' }} sub={{ en: 'pip install → playwright install → pytest', ru: 'pip install → playwright install → pytest' }} />
      <Arrow />
      <Node tone="peach" icon={<Icon name="download" size={22} />} title={{ en: 'Report artifact', ru: 'Отчёт-артефакт' }} sub={{ en: 'playwright-report/ + traces', ru: 'playwright-report/ + трейсы' }} />
      <Arrow />
      <Node tone="mint" icon={<Icon name="shield" size={22} />} title={{ en: '✓ / ✗ on the PR', ru: '✓ / ✗ в PR' }} sub={{ en: 'red starts a conversation', ru: 'красное — повод поговорить' }} />
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
    case 'locator-priority': return <LocatorPriority />;
    case 'actionability': return <Actionability />;
    case 'flaky-causes': return <FlakyCauses />;
    case 'test-agents': return <TestAgents />;
    case 'review-gates': return <ReviewGates />;
    case 'page-object': return <PageObject />;
    case 'fixture-lifecycle': return <FixtureLifecycle />;
    case 'http-exchange': return <HttpExchange />;
    case 'ui-vs-api': return <UiVsApi />;
    case 'ci-pipeline': return <CiPipeline />;
    default: return null;
  }
}
