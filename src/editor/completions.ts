// Autocompletion for the Playwright for Python API subset supported by the emulator, with bilingual docs.
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { useSettings } from '../store/settings';

type Doc = [string, string, string]; // [signature, en, ru]

const PAGE: Record<string, Doc> = {
  goto: ['goto("/path")', 'Open a page (like typing the URL).', 'Открыть страницу (как ввести адрес).'],
  get_by_role: ['get_by_role("button", name="Log in")', 'Find by role and accessible name — the most resilient locator.', 'Найти по роли и доступному имени — самый устойчивый локатор.'],
  get_by_label: ['get_by_label("Email")', 'Find a form field by its label.', 'Найти поле формы по подписи.'],
  get_by_text: ['get_by_text("Welcome")', 'Find an element by visible text.', 'Найти элемент по видимому тексту.'],
  get_by_placeholder: ['get_by_placeholder("you@example.com")', 'Find an input by placeholder.', 'Найти поле по плейсхолдеру.'],
  get_by_test_id: ['get_by_test_id("cart-total")', 'Find by data-testid attribute.', 'Найти по атрибуту data-testid.'],
  get_by_alt_text: ['get_by_alt_text("Bouquet of pink roses")', 'Find an image by alt text.', 'Найти картинку по alt-тексту.'],
  get_by_title: ['get_by_title("…")', 'Find by title attribute.', 'Найти по атрибуту title.'],
  locator: ['locator("css")', 'CSS/XPath locator — tied to markup, use sparingly.', 'CSS/XPath-локатор — привязан к вёрстке, используй осторожно.'],
  url: ['url', 'Current URL (a property — no brackets).', 'Текущий адрес (свойство — без скобок).'],
  title: ['title()', 'Page title.', 'Заголовок вкладки.'],
  reload: ['reload()', 'Reload the page.', 'Перезагрузить страницу.'],
  go_back: ['go_back()', 'Browser “Back”.', 'Кнопка «Назад» браузера.'],
  wait_for_url: ['wait_for_url("**/account")', 'Wait for navigation to a URL.', 'Дождаться перехода на адрес.'],
  wait_for_timeout: ['wait_for_timeout(1000)', 'Hard wait — avoid it in real tests.', 'Жёсткое ожидание — в реальных тестах лучше избегать.'],
  pause: ['pause()', 'Pause and switch to step-by-step mode.', 'Пауза и переход в пошаговый режим.'],
  keyboard: ['keyboard', 'Keyboard: press(key), type(text).', 'Клавиатура: press(key), type(text).'],
  request: ['request', 'API requests that share the browser context.', 'API-запросы в том же контексте браузера.'],
};

const LOCATOR: Record<string, Doc> = {
  click: ['click()', 'Click (waits until the element is ready).', 'Кликнуть (дождётся готовности элемента).'],
  fill: ['fill("text")', 'Type a value into a field (replaces it).', 'Ввести значение в поле (заменяет старое).'],
  clear: ['clear()', 'Clear a field.', 'Очистить поле.'],
  check: ['check()', 'Tick a checkbox / choose a radio.', 'Отметить чекбокс / выбрать радиокнопку.'],
  uncheck: ['uncheck()', 'Untick a checkbox.', 'Снять чекбокс.'],
  select_option: ['select_option("Poland")', 'Choose an option in a <select>.', 'Выбрать вариант в списке <select>.'],
  press: ['press("Enter")', 'Press a key on this element.', 'Нажать клавишу на элементе.'],
  press_sequentially: ['press_sequentially("text")', 'Type character by character.', 'Печатать посимвольно.'],
  hover: ['hover()', 'Move the mouse over.', 'Навести мышь.'],
  dblclick: ['dblclick()', 'Double click.', 'Двойной клик.'],
  text_content: ['text_content()', 'Read the text (once, no retry).', 'Прочитать текст (один раз, без повторов).'],
  inner_text: ['inner_text()', 'Read visible text.', 'Прочитать видимый текст.'],
  input_value: ['input_value()', 'Read a field value.', 'Прочитать значение поля.'],
  get_attribute: ['get_attribute("name")', 'Read an attribute.', 'Прочитать атрибут.'],
  is_visible: ['is_visible()', 'Is it visible right now? (no waiting)', 'Видим ли прямо сейчас? (без ожидания)'],
  count: ['count()', 'How many elements match now.', 'Сколько элементов найдено сейчас.'],
  first: ['first', 'The first match (a property — no brackets).', 'Первый найденный (свойство — без скобок).'],
  last: ['last', 'The last match (a property).', 'Последний найденный (свойство).'],
  nth: ['nth(0)', 'Match by index (from 0).', 'Элемент по номеру (с 0).'],
  filter: ['filter(has_text="Sunny Tulips")', 'Keep only matches containing text / element.', 'Оставить только содержащие текст / элемент.'],
  get_by_role: ['get_by_role("button", name="…")', 'Search inside this element by role.', 'Искать внутри элемента по роли.'],
  get_by_text: ['get_by_text("…")', 'Search inside this element by text.', 'Искать внутри элемента по тексту.'],
  get_by_label: ['get_by_label("…")', 'Search inside by label.', 'Искать внутри по подписи.'],
  get_by_test_id: ['get_by_test_id("…")', 'Search inside by test id.', 'Искать внутри по test id.'],
  locator: ['locator("css")', 'Search inside by CSS.', 'Искать внутри по CSS.'],
  wait_for: ['wait_for(state="visible")', 'Wait for a state.', 'Дождаться состояния.'],
  all: ['all()', 'All matches as a list of locators.', 'Все найденные как список локаторов.'],
  all_text_contents: ['all_text_contents()', 'Texts of all matches.', 'Тексты всех найденных.'],
};

const MATCHERS: Record<string, Doc> = {
  to_be_visible: ['to_be_visible()', 'Waits until the element is visible.', 'Ждёт, пока элемент станет видимым.'],
  to_be_hidden: ['to_be_hidden()', 'Waits until hidden or gone.', 'Ждёт, пока элемент скроется или исчезнет.'],
  to_have_text: ['to_have_text("Exact text")', 'Whole text equals (whitespace normalised).', 'Весь текст равен ожидаемому (пробелы нормализуются).'],
  to_contain_text: ['to_contain_text("part")', 'Text contains a part.', 'Текст содержит часть.'],
  to_have_url: ['to_have_url("http://localhost:3000/account")', 'Page URL equals (or matches re.compile(…)).', 'Адрес страницы равен (или совпадает с re.compile(…)).'],
  to_have_title: ['to_have_title("Log in · Bloomly")', 'Page title equals.', 'Заголовок вкладки равен.'],
  to_have_value: ['to_have_value("anna@bloomly.app")', 'Field value equals.', 'Значение поля равно.'],
  to_have_count: ['to_have_count(3)', 'Number of matching elements.', 'Количество найденных элементов.'],
  to_be_enabled: ['to_be_enabled()', 'Element is enabled.', 'Элемент активен.'],
  to_be_disabled: ['to_be_disabled()', 'Element is disabled.', 'Элемент неактивен.'],
  to_be_checked: ['to_be_checked()', 'Checkbox/radio is checked.', 'Чекбокс/радиокнопка отмечены.'],
  to_have_attribute: ['to_have_attribute("name", "value")', 'Attribute has a value.', 'Атрибут имеет значение.'],
  to_have_class: ['to_have_class("btn")', 'Class attribute equals.', 'Атрибут class равен.'],
  to_be_empty: ['to_be_empty()', 'Field/element is empty.', 'Поле/элемент пустой.'],
  to_be_focused: ['to_be_focused()', 'Element has focus.', 'Элемент в фокусе.'],
  to_be_ok: ['to_be_ok()', 'API response status is 2xx.', 'Статус ответа API — 2xx.'],
  not_to_be_visible: ['not_to_be_visible()', 'Waits until the element is not visible.', 'Ждёт, пока элемент перестанет быть видимым.'],
  not_to_have_text: ['not_to_have_text("…")', 'Text is not equal.', 'Текст не равен.'],
};

const PYTEST: Record<string, Doc> = {
  fixture: ['fixture', 'Declare a fixture: @pytest.fixture', 'Объявить фикстуру: @pytest.fixture'],
  mark: ['mark', 'Marks: @pytest.mark.parametrize, skip, xfail, smoke…', 'Метки: @pytest.mark.parametrize, skip, xfail, smoke…'],
  raises: ['raises(ValueError)', 'Expect an exception: with pytest.raises(...):', 'Ожидать исключение: with pytest.raises(...):'],
  approx: ['approx(42.9)', 'Compare floats with a tolerance.', 'Сравнить дробные числа с допуском.'],
  skip: ['skip("reason")', 'Skip the test from inside.', 'Пропустить тест изнутри.'],
  param: ['param(…, id="name")', 'One parametrize case with a readable id.', 'Один набор parametrize с понятным id.'],
};

const MARKS: Record<string, Doc> = {
  parametrize: ['parametrize("email, password", [(…), (…)])', 'Run the test once per data row.', 'Запустить тест на каждую строку данных.'],
  skip: ['skip(reason="…")', 'Skip this test.', 'Пропустить тест.'],
  skipif: ['skipif(condition, reason="…")', 'Skip when the condition is true.', 'Пропустить, если условие истинно.'],
  xfail: ['xfail(reason="BUG-123")', 'Known bug: the test is expected to fail.', 'Известный баг: тест должен падать.'],
  usefixtures: ['usefixtures("logged_in")', 'Use a fixture without an argument.', 'Подключить фикстуру без аргумента.'],
  smoke: ['smoke', 'Your own marker — run with pytest -m smoke.', 'Своя метка — запуск через pytest -m smoke.'],
};

const REQUEST: Record<string, Doc> = {
  get: ['get("/api/products")', 'HTTP GET.', 'HTTP GET-запрос.'],
  post: ['post("/api/login", data={…})', 'HTTP POST with a JSON body.', 'HTTP POST с JSON-телом.'],
  put: ['put("/api/…", data=…)', 'HTTP PUT.', 'HTTP PUT.'],
  delete: ['delete("/api/orders/1043")', 'HTTP DELETE.', 'HTTP DELETE.'],
};

const RESPONSE: Record<string, Doc> = {
  status: ['status', 'Status code (a property — no brackets).', 'Код ответа (свойство — без скобок).'],
  ok: ['ok', 'True for 2xx (a property).', 'True для 2xx (свойство).'],
  json: ['json()', 'Body parsed from JSON into dicts and lists.', 'Тело, разобранное из JSON в словари и списки.'],
  text: ['text()', 'Body as text.', 'Тело как текст.'],
  headers: ['headers', 'Response headers (a dict).', 'Заголовки ответа (словарь).'],
};

const TOP: Record<string, Doc> = {
  def: ['def test_name(page: Page):', 'Declare a test function.', 'Объявить тестовую функцию.'],
  expect: ['expect(…)', 'Start an assertion.', 'Начать проверку.'],
  assert: ['assert actual == expected', 'Plain Python check.', 'Обычная проверка Python.'],
  page: ['page', 'The browser page fixture.', 'Фикстура страницы браузера.'],
  pytest: ['pytest', 'The test runner module.', 'Модуль тест-раннера.'],
  print: ['print(value)', 'Show a value in the output.', 'Вывести значение.'],
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
  return Object.entries(map).map(([label, doc]) => ({ label, type, detail: doc[0].slice(label.length), info: info(doc), boost: label.startsWith('get_by') ? 2 : 0 }));
}

const PAGE_OPTS = options(PAGE, 'method');
const LOC_OPTS = options(LOCATOR, 'method');
const MATCH_OPTS = options(MATCHERS, 'function');
const PYTEST_OPTS = options(PYTEST, 'method');
const MARK_OPTS = options(MARKS, 'method');
const REQ_OPTS = options(REQUEST, 'method');
const RES_OPTS = options(RESPONSE, 'property');
const TOP_OPTS = options(TOP, 'keyword');

export const KNOWN_METHODS = [...Object.keys(PAGE), ...Object.keys(LOCATOR), ...Object.keys(MATCHERS), ...Object.keys(PYTEST)];

export function playwrightCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\w*/);
  if (!word) return null;
  const before = ctx.state.doc.sliceString(Math.max(0, word.from - 300), word.from);
  let opts: Completion[] | null = null;
  if (/expect\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\.$/.test(before)) opts = MATCH_OPTS;
  else if (/\bpytest\.mark\.$/.test(before)) opts = MARK_OPTS;
  else if (/\bpytest\.$/.test(before)) opts = PYTEST_OPTS;
  else if (/\b(request|api|api_request_context|api_context)\.$/.test(before)) opts = REQ_OPTS;
  else if (/\b(response|resp|r|res)\.$/.test(before)) opts = RES_OPTS;
  else if (/\bpage\.$/.test(before)) opts = PAGE_OPTS;
  else if (/(\)|\b\w+)\.$/.test(before)) opts = LOC_OPTS;
  else if (word.text.length >= 2 || ctx.explicit) opts = TOP_OPTS;
  if (!opts) return null;
  return { from: word.from, options: opts, validFor: /^\w*$/ };
}
