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
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
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

/** Letters only, so the name is one searchable word and unique per run and project. */
function uniqueWord(seed: string): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let n = Date.now() + [...seed].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += letters[Math.abs(n) % 26];
    n = Math.floor(n / 26) + 13;
  }
  return out;
}

test('sign up, answer Yes, create a service, see contact buttons, find it in search, report it', async ({ page, baseURL }, testInfo) => {
  const problems = guard(page, new URL(baseURL!).origin);
  const email = `e2e.services.${testInfo.project.name}.${Date.now()}@example.test`;
  const word = uniqueWord(testInfo.project.name);
  const name = `Kitchen ${word[0].toUpperCase()}${word.slice(1)}`;

  // Sign up and choose a community name.
  await page.goto('/join');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a long password here');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Keep this name' }).click();

  // The service question: Yes opens the form.
  await expect(page).toHaveURL(/\/join\/service$/);
  await expect(page.getByRole('heading', { name: 'Do you bake, cook or run a vegan service?' })).toBeVisible();
  await page.getByRole('link', { name: 'Yes, add my service' }).click();
  await expect(page).toHaveURL(/\/add\/service$/);
  await expect(page.getByRole('heading', { name: 'Add your service' })).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Add service');
  await expectNoSideScroll(page, 'Add service');

  // Contact details in free text are refused with a clear message.
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('What you offer').fill('Vegan birthday cakes, call me on 050 123 4567.');
  await page.getByRole('button', { name: 'Home baker' }).click();
  await page.getByRole('button', { name: 'Delivers across Dubai' }).click();
  // No vegan status is chosen for the member: the form asks.
  await page.getByRole('button', { name: 'Add my service' }).click();
  await expect(page.getByText('Choose Fully vegan or Vegan options.')).toBeVisible();
  await page.getByRole('group', { name: 'Vegan status' }).getByRole('button', { name: 'Vegan options' }).click();
  await page.getByRole('button', { name: 'Add my service' }).click();
  await expect(page.getByText('Please remove phone numbers and email addresses.', { exact: false })).toBeVisible();

  await page.getByLabel('What you offer').fill('Vegan birthday cakes and sourdough, baked to order every weekend.');
  await page.getByLabel('WhatsApp number or wa.me link').fill('+971 50 123 4567');
  await page.getByLabel('Instagram handle').fill('@kitchen_test');
  await page.getByLabel('Website').fill('https://kitchen.example');
  await page.getByRole('button', { name: 'Add my service' }).click();

  // The profile with the owner's contact buttons.
  await expect(page).toHaveURL(/\/services\/kitchen-/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('Run by owner', { exact: true })).toBeVisible();
  // The status the member chose, not a Fully vegan claim.
  await expect(page.getByText('Vegan options', { exact: true })).toBeVisible();
  await expect(page.getByText('Fully vegan', { exact: true })).toHaveCount(0);
  // A detail page: no tab bar or raised Add button, one sticky bar with the opinion buttons.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.getByTestId('listing-action-bar')).toBeVisible();
  await expect(page.getByTestId('opinion-summary')).toHaveText('Be the first to recommend');
  const wa = page.getByTestId('contact-whatsapp');
  await expect(wa).toHaveAttribute('href', 'https://wa.me/971501234567');
  await expect(wa).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
  await expect(page.getByTestId('contact-instagram')).toHaveAttribute('href', 'https://www.instagram.com/kitchen_test/');
  await expect(page.getByTestId('contact-website')).toHaveAttribute('href', 'https://kitchen.example/');
  await expect(page.getByRole('button', { name: 'Edit your page' })).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Service profile');
  await expectNoSideScroll(page, 'Service profile');

  // Search finds it.
  await page.goto('/search');
  const box = page.getByRole('searchbox', { name: 'Search places, products, services and talk' });
  await expect(box).toBeFocused();
  await box.fill(word.slice(0, 5));
  const services = page.getByRole('region', { name: 'Services' });
  await expect(services.getByRole('link', { name: new RegExp(name, 'i') })).toBeVisible();
  await expect(services.locator('mark').first()).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Search');
  await expectNoSideScroll(page, 'Search');
  await services.getByRole('link', { name: new RegExp(name, 'i') }).click();
  await expect(page).toHaveURL(/\/services\/kitchen-/);

  // Report it.
  await page.getByRole('button', { name: 'Report' }).click();
  const sheet = page.getByRole('dialog', { name: 'Report this service' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Wrong information').check();
  await expectNoSeriousA11yIssues(page, 'Report sheet');
  await sheet.getByRole('button', { name: 'Send report' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Thanks. An admin will take a look.')).toBeVisible();

  // Recent searches stay in this browser only.
  await page.goto('/search');
  await expect(page.getByRole('region', { name: 'Recent searches' })).toBeVisible();

  // Me shows the service.
  await page.goto('/me');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Me');
  await expectNoSideScroll(page, 'Me');

  expect(problems).toEqual([]);
});

test('privacy page is plain and links to the source', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'What we never store' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://github.com/blizzardbase/veganway' })).toBeVisible();
  const text = (await page.locator('main').textContent()) ?? '';
  expect(text, 'no hyphens or dashes in privacy copy').not.toMatch(/[–—]| - /);
  await expectNoSeriousA11yIssues(page, 'Privacy');
  await expectNoSideScroll(page, 'Privacy');
});
