import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Fails the test on any request that leaves the app origin and on any CSP violation. */
function guard(page: Page, origin: string) {
  const problems: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin) problems.push(`third party request: ${url.origin}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /content security policy/i.test(msg.text())) problems.push(`CSP: ${msg.text()}`);
  });
  return problems;
}

async function expectNoSeriousA11yIssues(page: Page, where: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(serious, `axe on ${where}`).toEqual([]);
}

async function expectNoSideScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow on ${where}`).toBeLessThanOrEqual(0);
}

test('sign up, pass the recovery gate, reach Home with five tabs', async ({ page, baseURL }, testInfo) => {
  const problems = guard(page, new URL(baseURL!).origin);
  const email = `e2e.${testInfo.project.name}.${Date.now()}@example.test`;

  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText('No phone number. Any email works, even a burner. We never send email and never track you.')).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Welcome');
  await expectNoSideScroll(page, 'Welcome');

  await page.getByRole('link', { name: 'Join' }).click();
  await expect(page.getByRole('heading', { name: 'Join VeganWay' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a long password here');
  await expectNoSeriousA11yIssues(page, 'Join');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Pseudonym reveal with Shuffle.
  const name = page.getByTestId('pseudonym');
  await expect(name).toBeVisible();
  const first = (await name.textContent())?.trim() ?? '';
  expect(first).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+/);
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await expect(name).not.toHaveText(first);
  await page.getByRole('button', { name: 'Keep this name' }).click();

  // Recovery code gate.
  await expect(page).toHaveURL(/\/join\/recovery$/);
  await expect(page.getByTestId('recovery-email')).toHaveText(email);
  const code = ((await page.getByTestId('recovery-code').textContent()) ?? '').trim();
  expect(code.replace(/-/g, '')).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/);
  const last4 = code.replace(/-/g, '').slice(-4);
  const wrong4 = last4.split('').map((c) => (c === '0' ? '1' : '0')).join('');

  const cont = page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await page.getByLabel('Type the last 4 characters').fill(last4);
  await expect(cont, 'typed code alone does not unlock').toBeDisabled();
  await page.getByLabel('Type the last 4 characters').fill('');
  await page.getByLabel('I saved my recovery code').check();
  await expect(cont, 'tick alone does not unlock').toBeDisabled();
  await page.getByLabel('Type the last 4 characters').fill(wrong4);
  await expect(cont, 'wrong characters do not unlock').toBeDisabled();
  await page.getByLabel('Type the last 4 characters').fill(last4.toLowerCase());
  await expect(cont).toBeEnabled();
  await expectNoSeriousA11yIssues(page, 'Recovery');
  await expectNoSideScroll(page, 'Recovery');
  await cont.click();

  // Service question, then Home.
  await expect(page).toHaveURL(/\/join\/service$/);
  await page.getByRole('link', { name: 'Later' }).click();
  await expect(page).toHaveURL(/\/$/);

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();
  for (const tab of ['Home', 'Explore', 'Talk', 'Me']) await expect(nav.getByRole('link', { name: tab, exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  // The shared server is filled by other specs in parallel: Home shows the welcome card or the feed.
  await expect(page.getByTestId('welcome-card').or(page.getByRole('region', { name: 'Latest from members' }))).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Home');
  await expectNoSideScroll(page, 'Home');

  // The Add sheet opens with six tiles.
  await nav.getByRole('button', { name: 'Add' }).click();
  const sheet = page.getByRole('dialog', { name: 'What would you like to add?' });
  await expect(sheet).toBeVisible();
  for (const tile of ['Place', 'Product', 'Offer', 'Service', 'Discussion', 'Poll']) {
    await expect(sheet.getByRole('button', { name: new RegExp(`^${tile}`) })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  expect(problems).toEqual([]);
});
