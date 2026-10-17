import { expect, test, type Page } from '@playwright/test';
import type { AccountWithCodeResponse } from '../../shared/types';
import type { ServiceCreated } from '../../shared/types/services';

async function member(page: Page, origin: string) {
  const res = await page.request.post('/api/auth/signup', {
    headers: { origin },
    data: { email: `auth.errors.${crypto.randomUUID()}@example.test`, password: 'synthetic browser password' },
  });
  expect(res.status()).toBe(201);
  const account: AccountWithCodeResponse = await res.json();
  return account;
}

const sections = [
  { path: '/api/me/profile', message: 'Could not load your profile.' },
  { path: '/api/me/posts', message: 'Could not load your posts.' },
  { path: '/api/me/service', message: 'Could not load your service.' },
  { path: '/api/bookmarks', message: 'Could not load your saved places.' },
];

test('UX-07: failed Me sections show Retry instead of empty prompts', async ({ page, baseURL }, testInfo) => {
  await member(page, baseURL!);
  const failing = new Set(sections.map((s) => s.path));
  for (const { path } of sections) {
    await page.route(`**${path}`, (route) => failing.has(path)
      ? route.fulfill({ status: 500, json: { error: 'Synthetic server failure.' } }) : route.continue());
  }
  await page.goto('/me');
  for (const { message } of sections) await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('You have not posted yet.', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Do you bake, cook or run a vegan service?', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Nothing saved yet.', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('me-errors.png'), fullPage: true });
  for (const { path, message } of sections) {
    failing.delete(path);
    const alert = page.getByRole('alert').filter({ hasText: message });
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(alert).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeEnabled();
  await expect(page.getByText('You have not posted yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add it', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing saved yet.', { exact: false })).toBeVisible();
});

test('UX-07: cached Me content stays visible when refresh fails and Retry recovers', async ({ page, baseURL }) => {
  const account = await member(page, baseURL!);
  const headers = { origin: baseURL!, 'x-csrf-token': account.csrf };
  const suffix = crypto.randomUUID().slice(0, 8).replace(/\d/g, (n) => String.fromCharCode(97 + Number(n)));
  const name = `Synthetic Kitchen ${suffix}`;
  const created = await page.request.post('/api/services', {
    headers,
    data: { name, summary: 'Synthetic plant based meal boxes.', category: 'Meal prep', area: 'JLT' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const service: ServiceCreated = await created.json();
  expect((await page.request.post(`/api/listings/${service.slug}/bookmark`, { headers, data: {} })).status()).toBe(200);
  expect((await page.request.patch('/api/me/profile', { headers, data: { bio: 'Synthetic member profile.' } })).status()).toBe(200);
  await page.clock.install();
  await page.goto('/me');
  await expect(page.getByText('Synthetic member profile.', { exact: true })).toBeVisible();
  for (const title of ['My posts', 'My service', 'Saved']) {
    await expect(page.getByRole('region', { name: title, exact: true }).getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);
  let failing = true;
  for (const { path } of sections) {
    await page.route(`**${path}`, (route) => failing
      ? route.fulfill({ status: 500, json: { error: 'Synthetic refresh failure.' } }) : route.continue());
  }
  await page.clock.fastForward(31_000);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Me', exact: true }).click();
  for (const { message } of sections) await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Synthetic member profile.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile', exact: true })).toBeEnabled();
  for (const title of ['My posts', 'My service', 'Saved']) {
    await expect(page.getByRole('region', { name: title, exact: true }).getByText(name, { exact: true })).toBeVisible();
  }
  failing = false;
  for (const { message } of sections) {
    const alert = page.getByRole('alert').filter({ hasText: message });
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(alert).toHaveCount(0);
  }
});

test('UX-07: failed account lookup shows Retry instead of Join', async ({ page, baseURL }) => {
  const account = await member(page, baseURL!);
  let failing = true;
  await page.route('**/api/me', (route) => failing
    ? route.fulfill({ status: 500, json: { error: 'Synthetic account failure.' } }) : route.continue());
  await page.goto('/me');
  const alert = page.getByRole('alert').filter({ hasText: 'Could not load your account.' });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: 'Join', exact: true })).toHaveCount(0);
  failing = false;
  await alert.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('me-name')).toHaveText(account.user.pseudonym);
});

for (const failure of ['offline', 'server error'] as const) {
  test(`SEC-05: ${failure} keeps sign out visibly signed in until Retry succeeds`, async ({ page, baseURL }) => {
    const account = await member(page, baseURL!);
    await page.goto('/me');
    await expect(page.getByTestId('me-name')).toHaveText(account.user.pseudonym);
    let fail = true;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/auth/logout', async (route) => {
      if (!fail) return route.continue();
      await held;
      if (failure === 'offline') await route.abort('failed');
      else await route.fulfill({ status: 500, json: { error: 'Synthetic server failure.' } });
    });
    try {
      const request = page.waitForRequest('**/api/auth/logout');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await request;
      await expect(page).toHaveURL(/\/me$/);
      await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeDisabled();
      await expect(page.getByTestId('me-name')).toHaveText(account.user.pseudonym);
      release();
      const error = page.getByRole('alert').filter({ hasText: 'Sign out did not finish.' });
      await expect(error).toBeVisible();
      await expect(page.getByText('Signed out.', { exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/\/me$/);
      const session = await page.request.get('/api/me');
      expect((await session.json()).user.id).toBe(account.user.id);
      fail = false;
      await error.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(page).not.toHaveURL(/\/me$/);
      expect((await (await page.request.get('/api/me')).json()).user).toBeNull();
      await page.goto('/me');
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    } finally {
      release();
    }
  });
}
