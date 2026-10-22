// Home on a truly empty app. The shared e2e server is filled by the other specs in parallel, so each
// worker here starts its own production server on a fresh in memory database.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const test = base.extend<object, { homeOrigin: string }>({
  // Playwright needs the destructured first argument, even when it is empty.
  // eslint-disable-next-line no-empty-pattern
  homeOrigin: [async ({}, use) => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    // dist/client was built by the shared webServer in playwright.config.ts before any worker started.
    const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server/dev.ts'], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
        APP_ORIGIN: origin,
        DATABASE_URL: 'pglite://memory',
        VW_E2E_RELAXED_LIMITS: '1',
        SERVER_SECRET: 'e2e-home-only-secret-0123456789abcdef012345',
      },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(`${origin}/manifest.webmanifest`)).ok) break;
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline || child.exitCode !== null) throw new Error('the Home test server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
    await use(origin);
    child.kill('SIGTERM');
  }, { scope: 'worker' }],
  baseURL: async ({ homeOrigin }, use) => use(homeOrigin),
});

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

async function settle(page: Page) {
  // Toasts, chips and bars animate; axe would measure a half blended colour mid animation.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

async function expectNoSeriousA11yIssues(page: Page, where: string) {
  await settle(page);
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

async function shot(page: Page, name: string, project: string) {
  mkdirSync('test-results/home', { recursive: true });
  await settle(page);
  await page.screenshot({ path: `test-results/home/home-${name}-${project}.png`, fullPage: true });
}

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

const home = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home', exact: true });

/** The top bar Back button of a detail page or Add form; lands on Home unless told otherwise. */
async function back(page: Page, to: RegExp = /\/$/) {
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(to);
}

test('Home: welcome card on an empty app, then new places and polls in the feed', async ({ page, baseURL }, testInfo) => {
  const project = testInfo.project.name;
  const problems = guard(page, new URL(baseURL!).origin);
  const welcome = page.getByTestId('welcome-card');

  await test.step('signed out visitors see the same Home with a Join banner', async () => {
    await page.goto('/welcome');
    await page.getByRole('button', { name: 'Look around first' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(welcome).toBeVisible();
    await expect(page.getByTestId('join-banner')).toContainText('Join to add and vote');
    await expect(page.locator('header').getByRole('link', { name: 'Join', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deals now' })).toHaveCount(0);
    await expectNoSideScroll(page, 'Home signed out');
    await expectNoSeriousA11yIssues(page, 'Home signed out');
    // Acting sends a visitor to Join.
    await welcome.getByRole('link', { name: 'Add a place' }).click();
    await expect(page).toHaveURL(/\/join\?next=%2Fadd%2Fplace$/);
  });

  await test.step('a new member lands on the welcome card, and its three buttons work', async () => {
    await join(page, `home.${project}.${Date.now()}@example.test`);
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('heading', { name: 'Welcome to VeganWay' })).toBeVisible();
    await expect(page.getByTestId('join-banner')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Me: / })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search places, products and talk' })).toBeVisible();
    await expectNoSideScroll(page, 'Home empty');
    await expectNoSeriousA11yIssues(page, 'Home empty');
    await shot(page, 'empty', project);

    // Add forms hide the tab bar; Back returns Home.
    await welcome.getByRole('link', { name: 'Add a place' }).click();
    await expect(page).toHaveURL(/\/add\/place$/);
    await expect(page.getByRole('heading', { name: 'Add a place' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await back(page);
    await welcome.getByRole('link', { name: 'Start a discussion' }).click();
    await expect(page).toHaveURL(/\/add\/discussion$/);
    await expect(page.getByRole('heading', { name: 'Start a discussion' })).toBeVisible();
    await back(page);
    await welcome.getByRole('link', { name: 'Showcase your service' }).click();
    await expect(page).toHaveURL(/\/add\/service$/);
    await back(page);
    await expect(welcome).toBeVisible();
  });

  const placeName = `Basil Bowl Kitchen ${project.replace(/\W/g, '')}`;
  const question = 'Which area needs more vegan options?';

  await test.step('add a place and a poll', async () => {
    await page.goto('/add/place');
    await page.getByLabel('Name').fill(placeName);
    await page.getByRole('group', { name: 'Area' }).getByRole('button', { name: 'JLT', exact: true }).click();
    await page.getByRole('group', { name: 'Vegan status' }).getByRole('button', { name: 'Fully vegan' }).click();
    // Nothing is preselected under the optional heading; recommending is one tap.
    const recommendIt = page.getByRole('button', { name: 'I recommend it' });
    await expect(recommendIt).toHaveAttribute('aria-pressed', 'false');
    await recommendIt.click();
    await expect(recommendIt).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('What to order (optional)').fill('The green bowl with tahini');
    await page.getByRole('button', { name: 'Add place' }).click();
    await expect(page.getByRole('heading', { level: 1, name: placeName })).toBeVisible();

    await page.goto('/add/poll');
    await page.getByLabel('Question').fill(question);
    await page.getByLabel('Option 1', { exact: true }).fill('Marina');
    await page.getByLabel('Option 2', { exact: true }).fill('Deira');
    await page.getByRole('button', { name: 'Post poll' }).click();
    await expect(page).toHaveURL(/\/talk\/[0-9a-f-]{36}$/);
  });

  await test.step('both appear on Home, and the poll votes inline', async () => {
    // The poll page is a detail page: Back to Talk, then Home from the tab bar.
    await back(page, /\/talk$/);
    await home(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(welcome).toHaveCount(0);
    const feed = page.getByRole('region', { name: 'Latest from members' });
    const placeCard = feed.locator('[data-type="listing_added"]').filter({ hasText: placeName });
    const pollCard = feed.locator('[data-type="topic"]').filter({ hasText: question });
    await expect(placeCard).toBeVisible();
    await expect(placeCard).toContainText('New place');
    await expect(placeCard).toContainText('JLT');
    await expect(placeCard).toContainText('Fully vegan');
    await expect(placeCard).toContainText('What to order: The green bowl with tahini');
    await expect(placeCard).toContainText('1 member recommends');
    await expect(pollCard).toBeVisible();
    // The poll is newer, so it comes first.
    await expect(feed.getByTestId('feed-item').first()).toHaveAttribute('data-type', 'topic');
    await expect(pollCard.getByText('Results after you vote')).toBeVisible();

    await pollCard.getByRole('button', { name: 'Vote for Deira' }).click();
    await expect(pollCard.getByRole('button', { name: 'Deira, 100 percent, your vote' })).toBeVisible();
    await expect(pollCard.getByText('You voted')).toBeVisible();
  });

  await test.step('a later recommendation with an offer shows as its own card and fills Deals now', async () => {
    const slug = await page.evaluate(async (name) => {
      const me = await (await fetch('/api/me')).json() as { csrf: string };
      const list = await (await fetch('/api/listings?kind=place&sort=new')).json() as { items: { name: string; slug: string }[] };
      const slug = list.items.find((l) => l.name === name)!.slug;
      const until = new Date(Date.now() + 7 * 86_400_000 + 4 * 3_600_000).toISOString().slice(0, 10);
      const res = await fetch(`/api/listings/${slug}/recommendations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrf },
        body: JSON.stringify({ body: 'Came back for the mango smoothie bowl.', offer: '20% off weekday brunch', offerExpiresOn: until }),
      });
      if (res.status !== 201) throw new Error(`recommendation failed: ${res.status}`);
      return slug;
    }, placeName);
    await page.reload();
    const feed = page.getByRole('region', { name: 'Latest from members' });
    const recCard = feed.locator('[data-type="recommendation"]').filter({ hasText: 'mango smoothie bowl' });
    await expect(recCard).toBeVisible();
    await expect(recCard).toContainText('recommends');
    await expect(recCard).toContainText('20% off weekday brunch');
    await expect(recCard.getByRole('link')).toHaveAttribute('href', `/places/${slug}`);
    await expect(feed.getByTestId('feed-item')).toHaveCount(3);
    await expect(feed.getByTestId('feed-item').first()).toHaveAttribute('data-type', 'recommendation');
    await expect(page.getByRole('heading', { name: 'Deals now' })).toBeVisible();
    await recCard.getByRole('button', { name: 'Upvote recommendation, 0 upvotes' }).click();
    await expect(recCard.getByRole('button', { name: 'Upvote recommendation, 1 upvote' })).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('the filled Home passes the checks and its cards tap through', async () => {
    const feed = page.getByRole('region', { name: 'Latest from members' });
    const placeCard = feed.locator('[data-type="listing_added"]').filter({ hasText: placeName });
    const pollCard = feed.locator('[data-type="topic"]').filter({ hasText: question });
    await expect(pollCard.getByRole('button', { name: 'Deira, 100 percent, your vote' })).toBeVisible();
    await expectNoSideScroll(page, 'Home filled');
    await expectNoSeriousA11yIssues(page, 'Home filled');
    await shot(page, 'filled', project);

    // Cards tap through.
    await placeCard.getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1, name: placeName })).toBeVisible();
    await back(page);
    await pollCard.getByRole('link', { name: question }).click();
    await expect(page).toHaveURL(/\/talk\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('button', { name: 'Deira, 100 percent, your vote' })).toBeVisible();
  });

  expect(problems).toEqual([]);
});
