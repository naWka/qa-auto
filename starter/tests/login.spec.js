import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

// TC-001: Registered user can log in
test('registered user can log in', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('anna@bloomly.app', 'bloom123');
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('heading', { name: 'Welcome back, Anna!' })).toBeVisible();
});

// TC-102: Wrong password shows an error
test('wrong password shows an error', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login('anna@bloomly.app', 'wrong-pass');
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
});
