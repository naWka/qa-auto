// Autocompletion for the Playwright API subset supported by the emulator, with bilingual docs.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { useSettings } from '../store/settings';

type Doc = [string, string, string]; // [signature, en, ru]

const PAGE: Record<string, Doc> = {
  goto: ["goto('/path')", 'Open a page (like typing the URL).', 'Открыть страницу (как ввести адрес).'],
  getByRole: ["getByRole('button', { name: 'Log in' })", 'Find by role and accessible name — the most resilient locator.', 'Найти по роли и доступному имени — самый устойчивый локатор.'],
  getByLabel: ["getByLabel('Email')", 'Find a form field by its label.', 'Найти поле формы по подписи.'],
  getByText: ["getByText('Welcome')", 'Find an element by visible text.', 'Найти элемент по видимому тексту.'],
  getByPlaceholder: ["getByPlaceholder('you@example.com')", 'Find an input by placeholder.', 'Найти поле по плейсхолдеру.'],
  getByTestId: ["getByTestId('cart-total')", 'Find by data-testid attribute.', 'Найти по атрибуту data-testid.'],
  getByAltText: ["getByAltText('Bouquet of pink roses')", 'Find an image by alt text.', 'Найти картинку по alt-тексту.'],
  getByTitle: ["getByTitle('…')", 'Find by title attribute.', 'Найти по атрибуту title.'],
  locator: ["locator('css')", 'CSS/XPath locator — tied to markup, use sparingly.', 'CSS/XPath-локатор — привязан к вёрстке, используй осторожно.'],
  url: ['url()', 'Current URL.', 'Текущий адрес.'],
  title: ['title()', 'Page title.', 'Заголовок вкладки.'],
  reload: ['reload()', 'Reload the page.', 'Перезагрузить страницу.'],
  goBack: ['goBack()', 'Browser “Back”.', 'Кнопка «Назад» браузера.'],
  waitForURL: ["waitForURL('/account')", 'Wait for navigation to a URL.', 'Дождаться перехода на адрес.'],
  waitForTimeout: ['waitForTimeout(1000)', 'Hard wait — avoid it in real tests.', 'Жёсткое ожидание — в реальных тестах лучше избегать.'],
  pause: ['pause()', 'Pause and switch to step-by-step mode.', 'Пауза и переход в пошаговый режим.'],
  keyboard: ['keyboard', 'Keyboard: press(key), type(text).', 'Клавиатура: press(key), type(text).'],
};

const LOCATOR: Record<string, Doc> = {
  click: ['click()', 'Click (waits until the element is ready).', 'Кликнуть (дождётся готовности элемента).'],
  fill: ["fill('text')", 'Type a value into a field (replaces it).', 'Ввести значение в поле (заменяет старое).'],
  clear: ['clear()', 'Clear a field.', 'Очистить поле.'],
  check: ['check()', 'Tick a checkbox / choose a radio.', 'Отметить чекбокс / выбрать радиокнопку.'],
  uncheck: ['uncheck()', 'Untick a checkbox.', 'Снять чекбокс.'],
  selectOption: ["selectOption('Poland')", 'Choose an option in a <select>.', 'Выбрать вариант в списке <select>.'],
  press: ["press('Enter')", 'Press a key on this element.', 'Нажать клавишу на элементе.'],
  pressSequentially: ["pressSequentially('text')", 'Type character by character.', 'Печатать посимвольно.'],
  hover: ['hover()', 'Move the mouse over.', 'Навести мышь.'],
  dblclick: ['dblclick()', 'Double click.', 'Двойной клик.'],
  textContent: ['textContent()', 'Read the text (once, no retry).', 'Прочитать текст (один раз, без повторов).'],
  innerText: ['innerText()', 'Read visible text.', 'Прочитать видимый текст.'],
  inputValue: ['inputValue()', 'Read a field value.', 'Прочитать значение поля.'],
  getAttribute: ["getAttribute('name')", 'Read an attribute.', 'Прочитать атрибут.'],
  isVisible: ['isVisible()', 'Is it visible right now? (no waiting)', 'Видим ли прямо сейчас? (без ожидания)'],
  count: ['count()', 'How many elements match now.', 'Сколько элементов найдено сейчас.'],
  first: ['first()', 'The first match.', 'Первый найденный.'],
  last: ['last()', 'The last match.', 'Последний найденный.'],
  nth: ['nth(0)', 'Match by index (from 0).', 'Элемент по номеру (с 0).'],
  filter: ["filter({ hasText: 'Sunny Tulips' })", 'Keep only matches containing text / element.', 'Оставить только содержащие текст / элемент.'],
  getByRole: ["getByRole('button', { name: '…' })", 'Search inside this element by role.', 'Искать внутри элемента по роли.'],
  getByText: ["getByText('…')", 'Search inside this element by text.', 'Искать внутри элемента по тексту.'],
  getByLabel: ["getByLabel('…')", 'Search inside by label.', 'Искать внутри по подписи.'],
  getByTestId: ["getByTestId('…')", 'Search inside by test id.', 'Искать внутри по test id.'],
  locator: ["locator('css')", 'Search inside by CSS.', 'Искать внутри по CSS.'],
  waitFor: ["waitFor({ state: 'visible' })", 'Wait for a state.', 'Дождаться состояния.'],
  all: ['all()', 'All matches as a list of locators.', 'Все найденные как список локаторов.'],
  allTextContents: ['allTextContents()', 'Texts of all matches.', 'Тексты всех найденных.'],
};

const MATCHERS: Record<string, Doc> = {
  toBeVisible: ['toBeVisible()', 'Waits until the element is visible.', 'Ждёт, пока элемент станет видимым.'],
  toBeHidden: ['toBeHidden()', 'Waits until hidden or gone.', 'Ждёт, пока элемент скроется или исчезнет.'],
  toHaveText: ["toHaveText('Exact text')", 'Whole text equals (whitespace normalised).', 'Весь текст равен ожидаемому (пробелы нормализуются).'],
  toContainText: ["toContainText('part')", 'Text contains a part.', 'Текст содержит часть.'],
  toHaveURL: ["toHaveURL('/account')", 'Page URL equals (relative to baseURL).', 'Адрес страницы равен (относительно baseURL).'],
  toHaveTitle: ["toHaveTitle('Log in · Bloomly')", 'Page title equals.', 'Заголовок вкладки равен.'],
  toHaveValue: ["toHaveValue('anna@bloomly.app')", 'Field value equals.', 'Значение поля равно.'],
  toHaveCount: ['toHaveCount(3)', 'Number of matching elements.', 'Количество найденных элементов.'],
  toBeEnabled: ['toBeEnabled()', 'Element is enabled.', 'Элемент активен.'],
  toBeDisabled: ['toBeDisabled()', 'Element is disabled.', 'Элемент неактивен.'],
  toBeChecked: ['toBeChecked()', 'Checkbox/radio is checked.', 'Чекбокс/радиокнопка отмечены.'],
  toHaveAttribute: ["toHaveAttribute('name', 'value')", 'Attribute has a value.', 'Атрибут имеет значение.'],
  toHaveClass: ["toHaveClass('btn')", 'Class attribute equals.', 'Атрибут class равен.'],
  toBeEmpty: ['toBeEmpty()', 'Field/element is empty.', 'Поле/элемент пустой.'],
  toBeFocused: ['toBeFocused()', 'Element has focus.', 'Элемент в фокусе.'],
  toBe: ['toBe(value)', 'Exactly equal (no retry).', 'Строго равно (без повторов).'],
  toEqual: ['toEqual(value)', 'Deep equality for objects/arrays.', 'Глубокое равенство объектов/массивов.'],
  toContain: ["toContain('part')", 'String/array contains.', 'Строка/массив содержит.'],
  toHaveLength: ['toHaveLength(2)', 'Length of a string/array.', 'Длина строки/массива.'],
  toBeTruthy: ['toBeTruthy()', 'Any “truthy” value — a weak check, avoid on locators.', 'Любое «истинное» значение — слабая проверка, не для локаторов.'],
  toBeGreaterThan: ['toBeGreaterThan(0)', 'Number is greater.', 'Число больше.'],
  toBeOK: ['toBeOK()', 'API response status is 2xx.', 'Статус ответа API — 2xx.'],
};

const TEST_API: Record<string, Doc> = {
  describe: ["describe('group', () => {})", 'Group tests.', 'Сгруппировать тесты.'],
  beforeEach: ['beforeEach(async ({ page }) => {})', 'Runs before every test.', 'Выполняется перед каждым тестом.'],
  afterEach: ['afterEach(async ({ page }) => {})', 'Runs after every test.', 'Выполняется после каждого теста.'],
  beforeAll: ['beforeAll(async () => {})', 'Runs once before all tests.', 'Один раз перед всеми тестами.'],
  step: ["step('name', async () => {})", 'A named step in the report.', 'Именованный шаг в отчёте.'],
  skip: ["skip('title', async () => {})", 'Skip a test.', 'Пропустить тест.'],
  only: ["only('title', async () => {})", 'Run only this test.', 'Запустить только этот тест.'],
  extend: ['extend({ … })', 'Create custom fixtures.', 'Создать свои фикстуры.'],
};

const REQUEST: Record<string, Doc> = {
  get: ["get('/api/products')", 'HTTP GET.', 'HTTP GET-запрос.'],
  post: ["post('/api/login', { data: {…} })", 'HTTP POST with a JSON body.', 'HTTP POST с JSON-телом.'],
  put: ["put('/api/…', { data })", 'HTTP PUT.', 'HTTP PUT.'],
  delete: ["delete('/api/orders/1043')", 'HTTP DELETE.', 'HTTP DELETE.'],
};

const TOP: Record<string, Doc> = {
  test: ["test('title', async ({ page }) => { … })", 'Declare a test.', 'Объявить тест.'],
  expect: ['expect(…)', 'Start an assertion.', 'Начать проверку.'],
  await: ['await', 'Wait for this step to finish.', 'Дождаться окончания шага.'],
  async: ['async', 'Marks a function that uses await.', 'Помечает функцию, где есть await.'],
  page: ['page', 'The browser page fixture.', 'Фикстура страницы браузера.'],
  request: ['request', 'API request fixture.', 'Фикстура API-запросов.'],
};

function info(doc: Doc) {
  return () => {
    const lang = useSettings.getState().lang;
    const el = document.createElement('div');
    el.className = 'cm-doc';
    const sig = document.createElement('code');
    sig.textContent = doc[0];
    el.appendChild(sig);
    if (lang !== 'ru') { const p = document.createElement('div'); p.textContent = doc[1]; el.appendChild(p); }
    if (lang !== 'en') { const p = document.createElement('div'); p.textContent = doc[2]; p.className = 'cm-doc-ru'; el.appendChild(p); }
    return el;
  };
}

function options(map: Record<string, Doc>, type: string): Completion[] {
  return Object.entries(map).map(([label, doc]) => ({ label, type, detail: doc[0].slice(label.length), info: info(doc), boost: label.startsWith('getBy') ? 2 : 0 }));
}

const PAGE_OPTS = options(PAGE, 'method');
const LOC_OPTS = options(LOCATOR, 'method');
const MATCH_OPTS = options(MATCHERS, 'function');
const TEST_OPTS = options(TEST_API, 'method');
const REQ_OPTS = options(REQUEST, 'method');
const TOP_OPTS = options(TOP, 'keyword');

export const KNOWN_METHODS = [...Object.keys(PAGE), ...Object.keys(LOCATOR), ...Object.keys(MATCHERS), ...Object.keys(TEST_API)];

export function playwrightCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[\w$]*/);
  if (!word) return null;
  const before = ctx.state.doc.sliceString(Math.max(0, word.from - 300), word.from);
  let opts: Completion[] | null = null;
  if (/expect(\.soft)?\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\.(not\.)?$/.test(before)) opts = MATCH_OPTS;
  else if (/\btest\.$/.test(before)) opts = TEST_OPTS;
  else if (/\brequest\.$/.test(before)) opts = REQ_OPTS;
  else if (/\bpage\.$/i.test(before) || /Page\.$/.test(before)) opts = PAGE_OPTS;
  else if (/(\)|\b\w+)\.$/.test(before)) opts = LOC_OPTS;
  else if (word.text.length >= 2 || ctx.explicit) opts = TOP_OPTS;
  if (!opts) return null;
  return { from: word.from, options: opts, validFor: /^[\w$]*$/ };
}

/** Closest known method name, for "Did you mean …?" hints. */
export function closestMethod(name: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const m of KNOWN_METHODS) {
    const d = levenshtein(name.toLowerCase(), m.toLowerCase());
    if (d < bestD) { bestD = d; best = m; }
  }
  return bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}
