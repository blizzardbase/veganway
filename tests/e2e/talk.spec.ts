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

/** Join through the real screens and land on Home. */
async function join(page: Page, email: string) {
  await page.goto('/join');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a long password here');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Keep this name' }).click();
  await expect(page).toHaveURL(/\/join\/recovery$/);
  const code = ((await page.getByTestId('recovery-code').textContent()) ?? '').trim();
  await page.getByLabel('I saved my recovery code').check();
  await page.getByLabel('Type the last 4 characters').fill(code.replace(/-/g, '').slice(-4));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/join\/service$/);
  await page.getByRole('link', { name: 'Later' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('start a poll, vote, see the bars, reply and upvote', async ({ page, baseURL }, testInfo) => {
  const problems = guard(page, new URL(baseURL!).origin);
  await join(page, `talk.${testInfo.project.name}.${Date.now()}@example.test`);

  // Talk tab: the list loads (empty or not) without side scroll.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Talk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Talk', level: 1 })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Sort discussions' })).toBeVisible();

  // Start a poll from the Add sheet.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add' }).click();
  await page.getByRole('dialog', { name: 'What would you like to add?' }).getByRole('button', { name: /^Poll/ }).click();
  await expect(page).toHaveURL(/\/add\/poll$/);
  const question = `Which area needs more vegan options ${testInfo.project.name}?`;
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Option 1', { exact: true }).fill('Marina');
  await page.getByLabel('Option 2', { exact: true }).fill('Deira');
  await page.getByRole('button', { name: 'Add option' }).click();
  await page.getByLabel('Option 3', { exact: true }).fill('Al Quoz');
  await page.getByRole('button', { name: '3 days' }).click();
  await expect(page.getByRole('button', { name: '3 days' })).toHaveAttribute('aria-pressed', 'true');
  // Let the chip colour transition finish, or axe measures a half blended colour.
  await page.waitForTimeout(300);
  await expectNoSeriousA11yIssues(page, 'Add poll');
  await expectNoSideScroll(page, 'Add poll');
  await page.getByRole('button', { name: 'Post poll' }).click();

  // The topic page: vote and see animated result bars.
  await expect(page).toHaveURL(/\/talk\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: question })).toBeVisible();
  await expect(page.getByText('Closes in 3 days')).toBeVisible();
  await expect(page.getByText('Results show after you vote.')).toBeVisible();
  await page.getByRole('button', { name: 'Vote for Deira' }).click();
  await expect(page.getByRole('button', { name: 'Deira, 100 percent, your vote' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marina, 0 percent' })).toBeVisible();
  await expect(page.getByText('You voted')).toBeVisible();

  // Change the vote.
  await page.getByRole('button', { name: 'Marina, 0 percent' }).click();
  await expect(page.getByRole('button', { name: 'Marina, 100 percent, your vote' })).toBeVisible();

  // Reply through the sticky composer, then reply to that reply (one level deep).
  const composer = page.getByLabel('Write a reply');
  await expect(composer).toBeVisible();
  await composer.fill('Marina has plenty already, but Deira needs more.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  const thread = page.getByTestId('reply-thread');
  await expect(thread.getByText('Marina has plenty already, but Deira needs more.')).toBeVisible();
  await expect(composer).toHaveValue('');
  await thread.getByRole('button', { name: /^Reply/ }).first().click();
  await expect(page.getByText(/^Replying to/)).toBeVisible();
  await composer.fill('Agreed, Deira first.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(thread.getByText('Agreed, Deira first.')).toBeVisible();
  await expect(thread.getByTestId('reply')).toHaveCount(2);

  // Upvote the first reply, then the topic.
  const replyUpvote = thread.getByRole('button', { name: 'Upvote reply, 0 upvotes' }).first();
  await replyUpvote.click();
  await expect(thread.getByRole('button', { name: 'Upvote reply, 1 upvote' }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Upvote, 0 upvotes' }).click();
  await expect(page.getByRole('button', { name: 'Upvote, 1 upvote' })).toHaveAttribute('aria-pressed', 'true');

  // The last reply is not hidden behind the composer or the tab bar.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = thread.getByTestId('reply').last();
  const composerBox = await page.locator('form:has(textarea)').boundingBox();
  const lastBox = await last.boundingBox();
  expect(lastBox && composerBox && lastBox.y + lastBox.height <= composerBox.y).toBeTruthy();

  await expectNoSeriousA11yIssues(page, 'Topic');
  await expectNoSideScroll(page, 'Topic');

  // Back on Talk the poll shows inline with its compact bars and counts.
  await page.goto('/talk?sort=new');
  const row = page.getByTestId('topic-row').filter({ hasText: question });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Marina, 100 percent, your vote' })).toBeVisible();
  await expect(row.getByRole('link', { name: '2 replies' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Upvote, 1 upvote' })).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Talk');
  await expectNoSideScroll(page, 'Talk');

  expect(problems).toEqual([]);
});

test('signed out visitors can read Talk and are asked to join to reply', async ({ page, baseURL }) => {
  const problems = guard(page, new URL(baseURL!).origin);
  await page.goto('/talk');
  await expect(page.getByRole('heading', { name: 'Talk', level: 1 })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Sort discussions' })).toBeVisible();
  await expectNoSideScroll(page, 'Talk signed out');
  await page.goto('/add/discussion');
  await expect(page).toHaveURL(/\/join\?next=/);
  expect(problems).toEqual([]);
});
