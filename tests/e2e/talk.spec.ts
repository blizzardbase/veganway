import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ReplyResponse, TopicResponse } from '../../shared/types/talk';
import type { ListingDetail } from '../../shared/types/listings';

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

/** Join through the real screens and land on Home. */
async function join(page: Page, email: string) {
  await page.goto('/join');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a long password here');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Keep this name' }).click();
  await expect(page).toHaveURL(/\/join\/service$/);
  await page.getByRole('link', { name: 'Later' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function apiMember(page: Page, origin: string, email: string) {
  const signup = await page.request.post('/api/auth/signup', {
    headers: { origin }, data: { email, password: 'a long synthetic password' },
  });
  expect(signup.status()).toBe(201);
  const { csrf } = await signup.json();
  const headers = { origin, 'x-csrf-token': csrf };
  expect((await page.request.post('/api/auth/confirm-pseudonym', { headers, data: {} })).status()).toBe(200);
  return headers;
}

test('maximum listing names fit linked topics and discussion listing selectors at 360 and 430 pixels', async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const headers = await apiMember(page, origin, `long.${testInfo.project.name}.${Date.now()}@example.test`);
  const name = 'W'.repeat(80);
  const created = await page.request.post('/api/listings', {
    headers, data: { kind: 'place', name, area: 'JLT', veganStatus: 'fully_vegan' },
  });
  expect(created.status()).toBe(201);
  const { listing }: { listing: ListingDetail } = await created.json();
  const posted = await page.request.post('/api/talk/topics', {
    headers, data: { kind: 'discussion', title: 'A linked listing with a long name', listingIds: [listing.id] },
  });
  expect(posted.status()).toBe(201);
  const { topic }: TopicResponse = await posted.json();

  for (const width of [360, 430]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/talk/${topic.id}`);
    await expect(page.getByRole('link', { name: `${name} Place`, exact: true })).toBeVisible();
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `linked topic at ${width}`).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`long-linked-${width}.png`), fullPage: true });

    for (const preset of [false, true]) {
      const query = preset ? `?${new URLSearchParams({ listing: listing.id, name, slug: listing.slug, kind: 'place' })}` : '';
      await page.goto(`/add/discussion${query}`);
      if (!preset) {
        await page.getByLabel(/^Link places, products or services/).fill(name);
        const matches = page.getByRole('list', { name: 'Matches', exact: true });
        await expect(matches).toBeVisible();
        const choice = matches.getByRole('button', { name: `${name} Place · JLT`, exact: true }).first();
        await expect(choice).toBeVisible();
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `discussion matches at ${width}`).toBe(width);
        await choice.click();
      }
      await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth), `discussion selected at ${width}, preset=${preset}`).toBe(width);
    }
  }
});

test('load more replies keeps complete threads, retries failures and supports actions on later pages', async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const headers = await apiMember(page, origin, `pages.${testInfo.project.name}.${Date.now()}@example.test`);
  const posted = await page.request.post('/api/talk/topics', {
    headers, data: { kind: 'discussion', title: 'A conversation with more than one page' },
  });
  expect(posted.status()).toBe(201);
  const { topic }: TopicResponse = await posted.json();
  let firstId = '';
  for (let i = 1; i <= 20; i++) {
    const reply = await page.request.post('/api/talk/replies', {
      headers, data: { targetType: 'topic', targetId: topic.id, body: `Earlier message ${i}` },
    });
    expect(reply.status()).toBe(201);
    if (i === 1) {
      const body: ReplyResponse = await reply.json();
      firstId = body.reply.id;
    }
  }
  await page.context().clearCookies();
  const writer = await apiMember(page, origin, `writer.${testInfo.project.name}.${Date.now()}@example.test`);
  for (const [body, parentId] of [['A child stays with the first thread.', firstId], ['The later page is reachable.', null]]) {
    expect((await page.request.post('/api/talk/replies', {
      headers: writer, data: { targetType: 'topic', targetId: topic.id, body, parentId },
    })).status()).toBe(201);
  }
  await page.goto(`/talk/${topic.id}`);
  const thread = page.getByTestId('reply-thread');
  await expect(thread.getByTestId('reply')).toHaveCount(21);
  await expect(thread.getByText('A child stays with the first thread.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Replies\s*22$/ })).toBeVisible();
  await expect(thread.getByText('The later page is reachable.')).toHaveCount(0);

  await page.route('**/api/talk/replies?**', async (route) => {
    if (new URL(route.request().url()).searchParams.has('cursor')) {
      await route.fulfill({ status: 503, json: { error: 'Synthetic temporary failure.' } });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Load more replies', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('More replies did not load. Try again.', { timeout: 15000 });
  await expect(thread.getByTestId('reply')).toHaveCount(21);
  await page.unroute('**/api/talk/replies?**');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const later = thread.getByRole('article').filter({ hasText: 'The later page is reachable.' });
  await expect(later).toBeVisible();
  await expect(thread.getByTestId('reply')).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'Load more replies', exact: true })).toHaveCount(0);
  await later.getByRole('button', { name: 'Upvote reply, 0 upvotes' }).click();
  await expect(later.getByRole('button', { name: 'Upvote reply, 1 upvote' })).toHaveAttribute('aria-pressed', 'true');
  await later.getByRole('button', { name: /^Reply/ }).click();
  await page.getByLabel('Write a reply').fill('An answer on the later page.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(thread.getByText('An answer on the later page.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Replies\s*23$/ })).toBeVisible();
});

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

test('review 13: a new top level reply appears before loading older remaining pages', async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  const headers = await apiMember(page, origin, `newreply.${testInfo.project.name}.${Date.now()}@example.test`);
  const posted = await page.request.post('/api/talk/topics', {
    headers, data: { kind: 'discussion', title: 'Synthetic new reply beyond the first page' },
  });
  expect(posted.status()).toBe(201);
  const { topic }: TopicResponse = await posted.json();
  for (let i = 1; i <= 20; i++) {
    const reply = await page.request.post('/api/talk/replies', {
      headers, data: { targetType: 'topic', targetId: topic.id, body: `Synthetic earlier root ${i}` },
    });
    expect(reply.status()).toBe(201);
  }
  await page.context().clearCookies();
  const writer = await apiMember(page, origin, `newwriter.${testInfo.project.name}.${Date.now()}@example.test`);
  expect((await page.request.post('/api/talk/replies', {
    headers: writer, data: { targetType: 'topic', targetId: topic.id, body: 'Synthetic unloaded root' },
  })).status()).toBe(201);
  await page.goto(`/talk/${topic.id}`);
  const thread = page.getByTestId('reply-thread');
  await expect(thread.getByTestId('reply')).toHaveCount(20);
  await page.getByLabel('Write a reply').fill('Synthetic newest reply from the composer');
  await page.getByRole('button', { name: 'Send reply' }).click();
  const newest = thread.getByRole('article').filter({ hasText: 'Synthetic newest reply from the composer' });
  await expect(newest).toBeVisible();
  await expect(page.getByLabel('Write a reply')).toHaveValue('');
  await expect(page.getByRole('heading', { name: /^Replies\s*22$/ })).toBeVisible();
  await newest.getByRole('button', { name: 'Upvote reply, 0 upvotes' }).click();
  await expect(newest.getByRole('button', { name: 'Upvote reply, 1 upvote' })).toBeVisible();
  await page.getByRole('button', { name: 'Load more replies', exact: true }).click();
  await expect(thread.getByTestId('reply')).toHaveCount(22);
  await expect(thread.getByText('Synthetic newest reply from the composer', { exact: true })).toHaveCount(1);
  await expect(thread.getByText('Synthetic unloaded root', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('new-reply-visible.png'), fullPage: true });
});
