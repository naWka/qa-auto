// Dev-only helpers: render one task by id, or the lab components on their own.
import { loadAllTasks, type TaskRef } from '../content';
import { TaskShell } from '../tasks/TaskShell';
import { Inspector } from '../lab/Inspector';
import { TraceViewer } from '../lab/TraceViewer';
import { CodeLab } from '../lab/CodeLab';
import { useEffect, useState } from 'react';
import { Figure } from '../lesson/Figures';
import { Figure as FigureEnum } from '../content/schema';

export function DevFiguresPage() {
  return (
    <div className="page lesson">
      {FigureEnum.options.map((f) => <div key={f}><h3><code>{f}</code></h3><Figure id={f} /></div>)}
    </div>
  );
}

export function DevTaskPage({ id }: { id: string }) {
  const [ref, setRef] = useState<TaskRef | null | undefined>(undefined);
  useEffect(() => { loadAllTasks().then((all) => setRef(all.find((r) => r.task.id === id) ?? null)); }, [id]);
  if (ref === undefined) return <div className="page"><span className="spinner" /></div>;
  if (!ref) return <div className="page"><p>No task {id}</p></div>;
  return (
    <div className="page lesson lesson-wide" style={{ paddingBottom: 160 }}>
      <p className="muted"><code>{id}</code> · {ref.lessonId ?? ref.chapterId} · {ref.where}</p>
      <TaskShell key={id} task={ref.task} />
    </div>
  );
}

const TRACE = `from playwright.sync_api import Page, expect


def test_promo_code_gives_10_percent_off(page: Page):
    page.goto("/cart")
    page.get_by_label("Promo code").fill("BLOOM100")
    page.get_by_role("button", name="Apply").click()
    expect(page.get_by_test_id("cart-total")).to_have_text("€36.40")
`;

const PAGE_OBJECT = `from playwright.sync_api import Page


class LoginPage:
    def __init__(self, page: Page):
        self.page = page
        self.email = page.get_by_label("Email")
        self.password = page.get_by_label("Password")
        self.submit = page.get_by_role("button", name="Log in")

    def open(self):
        self.page.goto("/login")

    def log_in(self, email: str, password: str):
        self.email.fill(email)
        self.password.fill(password)
        self.submit.click()
`;
const SPEC = `from playwright.sync_api import Page, expect
from pages.login_page import LoginPage


def test_registered_user_can_log_in(page: Page):
    login_page = LoginPage(page)
    login_page.open()
    login_page.log_in("anna@bloomly.app", "bloom123")
    expect(page.get_by_role("heading", name="Welcome back, Anna!")).to_be_visible()
`;

export function DevLabPage() {
  const [code, setCode] = useState(SPEC);
  const [files, setFiles] = useState<Record<string, string>>({ 'pages/login_page.py': PAGE_OBJECT });
  return (
    <div className="page page-wide">
      <h1 className="page-title">Lab components</h1>
      <h2>Inspector</h2>
      <Inspector app={{ route: '/login' }} focus="#email" />
      <h2>Trace viewer</h2>
      <TraceViewer code={TRACE} app={{ state: { cart: [{ id: 'rose-bouquet', qty: 1 }] } }} />
      <h2>Files</h2>
      <CodeLab code={code} onCode={setCode} files={files} onFiles={setFiles} />
    </div>
  );
}
