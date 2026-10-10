// Dev-only helpers: render one task by id, or the lab components on their own.
import { taskById } from '../content';
import { TaskShell } from '../tasks/TaskShell';
import { Inspector } from '../lab/Inspector';
import { TraceViewer } from '../lab/TraceViewer';
import { CodeLab } from '../lab/CodeLab';
import { useState } from 'react';
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
  const ref = taskById.get(id);
  if (!ref) return <div className="page"><p>No task {id}</p></div>;
  return (
    <div className="page lesson lesson-wide" style={{ paddingBottom: 160 }}>
      <p className="muted"><code>{id}</code> · {ref.lessonId ?? ref.chapterId} · {ref.where}</p>
      <TaskShell key={id} task={ref.task} />
    </div>
  );
}

const TRACE = `import { test, expect } from '@playwright/test';

test('promo code gives 10% off', async ({ page }) => {
  await page.goto('/cart');
  await page.getByLabel('Promo code').fill('BLOOM100');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('cart-total')).toHaveText('€36.40');
});`;

const PAGE_OBJECT = `export class LoginPage {
  constructor(page) {
    this.page = page;
    this.email = page.getByLabel('Email');
    this.password = page.getByLabel('Password');
    this.submit = page.getByRole('button', { name: 'Log in' });
  }
  async goto() {
    await this.page.goto('/login');
  }
  async login(email, password) {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
`;
const SPEC = `import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

test('registered user can log in', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('anna@bloomly.app', 'bloom123');
  await expect(page.getByRole('heading', { name: 'Welcome back, Anna!' })).toBeVisible();
});`;

export function DevLabPage() {
  const [code, setCode] = useState(SPEC);
  const [files, setFiles] = useState<Record<string, string>>({ 'pages/LoginPage.js': PAGE_OBJECT });
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
