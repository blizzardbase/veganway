import { expect, test, type Page } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';
const group = (type = 'photo') => ({
  targetType: type, targetId: id, openCount: 1, reasons: [{ reason: 'spam', count: 1 }], notes: [], lastReportedAt: '2026-01-01T00:00:00Z', autoHidden: false,
  preview: { title: 'Synthetic photo', excerpt: null, path: null, hidden: false, author: 'Synthetic author', authorId: id, exists: true }
});
async function admin(page: Page) {
  await page.route('**/api/me', r => r.fulfill({ json: { user: { id, role: 'admin', pseudonym: 'Synthetic admin', pseudonymConfirmed: true }, csrf: 'synthetic' } }));
  await page.route('**/api/admin/**', r => r.fulfill({ json: { groups: [], items: [], banned: [], claims: [], listings: [], rows: [], next: null } }));
}

test('UX-02 all admin sections show request errors with Retry before empty states', async ({ page }) => {
  await admin(page);
  await page.route('**/api/admin/**', r => r.fulfill({ status: 500, json: { error: 'Synthetic failure' } }));
  await page.goto('/admin');
  await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
  await expect(page.getByText('No open reports. All clear.')).toHaveCount(0);
  await expect(page.getByText('Nothing is hidden.')).toHaveCount(0);
  for (const section of ['Hidden', 'Banned members', 'Hidden photos and deletion history']) {
    const region = page.getByRole('region', { name: section, exact: true });
    await expect(region.getByRole('alert')).toBeVisible({ timeout: 15000 });
    await expect(region.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  }
  for (const tab of ['Claims', 'Listings', 'Audit']) {
    await page.getByRole('radio', { name: tab, exact: true }).click();
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible();
  }
  await page.route('**/api/admin/audit*', r => r.fulfill({ json: { rows: [], next: null } }));
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Nothing in the audit log yet.')).toBeVisible();
});

test('UX-05 photo hide and author ban require named confirmation while text hide stays immediate', async ({ page }, testInfo) => {
  await admin(page);
  await page.route('**/api/admin/reports*', r => r.fulfill({ json: { groups: [group()], next: null } }));
  let writes = 0;
  await page.route('**/api/admin/moderate', r => { writes++; return r.fulfill({ json: { ok: true } }); });
  await page.route('**/api/admin/users/*/ban', r => { writes++; return r.fulfill({ json: { ok: true } }); });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByText(/photos cannot come back/i)).toBeVisible();
  await expect(page.getByText(/Hide Synthetic photo/)).toBeVisible();
  expect(writes).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('photo-confirmation.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, hide photo' }).click();
  await expect.poll(() => writes).toBe(1);
  await page.getByRole('button', { name: 'Ban author' }).click();
  await expect(page.getByText(/Ban Synthetic author/)).toBeVisible();
  await expect(page.getByText(/photos cannot come back/i)).toBeVisible();
  expect(writes).toBe(1);
  await page.getByRole('button', { name: 'Yes, ban author' }).click();
  await expect.poll(() => writes).toBe(2);
  await page.route('**/api/admin/reports*', r => r.fulfill({ json: { groups: [group('topic')], next: null } }));
  await page.reload();
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect.poll(() => writes).toBe(3);
});

test('UX-02 cached reports stay visible when an action triggers a failed refresh', async ({ page }) => {
  await admin(page);
  let failed = false;
  await page.route('**/api/admin/reports*', r => failed ? r.fulfill({ status: 500, json: { error: 'Synthetic refresh failure' } }) : r.fulfill({ json: { groups: [group('topic')], next: null } }));
  await page.route('**/api/admin/moderate', r => { failed = true; return r.fulfill({ json: { ok: true } }); });
  await page.goto('/admin');
  await expect(page.getByText('Synthetic photo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Synthetic photo', { exact: true })).toBeVisible();
  await expect(page.getByText('No open reports. All clear.')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('DATA-02 admin Load more reaches the next report page', async ({ page }) => {
  await admin(page);
  await page.route('**/api/admin/reports*', r => r.fulfill({
    json: new URL(r.request().url()).searchParams.has('cursor')
      ? { groups: [{ ...group('topic'), targetId: '22222222-2222-4222-8222-222222222222', preview: { ...group().preview, title: 'Older report' } }], next: null }
      : { groups: [group('topic')], next: 'synthetic-cursor' },
  }));
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByText('Older report', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic photo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
});


test('review 6: admins can restore auto hidden photos or confirm permanent deletion', async ({ page }, testInfo) => {
  await admin(page);
  let pending = true;
  const actions: string[] = [];
  await page.route('**/api/admin/reports*', r => r.fulfill({ json: {
    groups: pending ? [{ ...group(), autoHidden: true, preview: { ...group().preview, hidden: true } }] : [], next: null,
  } }));
  await page.route('**/api/admin/moderate', r => {
    actions.push(r.request().postDataJSON().action);
    pending = false;
    return r.fulfill({ json: { ok: true } });
  });
  for (const action of ['restore', 'dismiss', 'hide']) {
    pending = true;
    await page.goto('/admin');
    await expect(page.getByText('Auto hidden', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    await page.getByRole('button', { name: action === 'restore' ? 'Restore' : action === 'dismiss' ? 'Dismiss' : 'Hide', exact: true }).click();
    if (action === 'hide') {
      expect(actions).toEqual(['restore', 'dismiss']);
      await expect(page.getByRole('group', { name: 'Confirm permanent action' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('auto-hidden-photo-decision.png'), fullPage: true });
      await page.getByRole('button', { name: 'Yes, hide photo', exact: true }).click();
    }
    await expect(page.getByText('No open reports. All clear.')).toBeVisible();
    await page.reload();
  }
  expect(actions).toEqual(['restore', 'dismiss', 'hide']);
});
