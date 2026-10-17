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
  // A toast fading in is half transparent; axe would measure its contrast mid animation.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
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

async function signUp(page: Page, email: string) {
  await page.goto('/join');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a long password here');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Keep this name' }).click();
  await expect(page).toHaveURL(/\/join\/recovery$/);
  const code = ((await page.getByTestId('recovery-code').textContent()) ?? '').trim().replace(/-/g, '');
  await page.getByLabel('I saved my recovery code').check();
  await page.getByLabel('Type the last 4 characters').fill(code.slice(-4));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/join\/service$/);
  await page.getByRole('link', { name: 'Later' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('add a place, see it in Explore, recommend it, save it', async ({ page, baseURL }, testInfo) => {
  const problems = guard(page, new URL(baseURL!).origin);
  const stamp = `${testInfo.project.name.replace(/\W/g, '')}${Date.now().toString(36)}`;
  const placeName = `Sunflower Bowl ${stamp}`;
  await signUp(page, `e2e.listings.${stamp}@example.test`);

  // Explore starts empty for this segment's filters, with an Add button.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Explore' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Places' })).toHaveAttribute('aria-checked', 'true');
  await expectNoSeriousA11yIssues(page, 'Explore');
  await expectNoSideScroll(page, 'Explore');

  // Add a place through the Add sheet.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'What would you like to add?' }).getByRole('button', { name: /^Place/ }).click();
  await expect(page).toHaveURL(/\/add\/place$/);
  await expect(page.getByRole('heading', { name: 'Add a place' })).toBeVisible();
  await expectNoSeriousA11yIssues(page, 'Add a place');
  await expectNoSideScroll(page, 'Add a place');

  // Inline validation before anything is sent.
  await page.getByRole('button', { name: 'Add place' }).click();
  await expect(page.getByText('Enter the name of the place.')).toBeVisible();

  await page.getByLabel('Name').fill(placeName);
  await page.getByRole('group', { name: 'Area' }).getByRole('button', { name: 'JLT', exact: true }).click();
  await page.getByRole('group', { name: 'Vegan status' }).getByRole('button', { name: 'Fully vegan' }).click();
  // The optional opinion starts unselected, so the test can recommend from the listing page.
  await expect(page.getByRole('button', { name: 'I recommend it' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('What to order (optional)').fill('The sunflower bowl with tahini');
  await page.getByRole('button', { name: 'Add place' }).click();

  // Lands on the new listing.
  await expect(page).toHaveURL(/\/places\/sunflower-bowl-/);
  await expect(page.getByRole('heading', { level: 1, name: placeName })).toBeVisible();
  await expect(page.getByText('Fully vegan').first()).toBeVisible();
  await expect(page.getByText('The sunflower bowl with tahini')).toBeVisible();
  const share = page.getByRole('link', { name: 'Share on WhatsApp' });
  await expect(share).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
  await expectNoSeriousA11yIssues(page, 'Listing');
  await expectNoSideScroll(page, 'Listing');

  // Recommend, with an optimistic count and an Undo toast.
  const recommend = page.getByRole('button', { name: /^Recommend/ });
  await expect(recommend).toHaveAttribute('aria-pressed', 'false');
  await recommend.click();
  await expect(recommend).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('opinion-summary')).toHaveText('1 member recommends');
  // The count shows once, in the page body, not again in the bar.
  await expect(recommend).toHaveText('Recommend');
  await expect(page.getByText('You recommend this.')).toBeVisible();

  // Save it.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The recommendation upvote toggles.
  const upvote = page.getByRole('button', { name: /^Upvote/ }).first();
  await upvote.click();
  await expect(upvote).toHaveAttribute('aria-pressed', 'true');

  // A detail page has no tab bar: Back returns to Explore, where it shows with its count.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.getByTestId('opinion-summary')).toHaveText('1 member recommends');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore', exact: true }).click();
  const card = page.getByRole('link', { name: new RegExp(placeName) });
  await expect(card).toBeVisible();
  await expect(card).toContainText('1 member recommends');
  await expectNoSideScroll(page, 'Explore with a card');

  // Filters: JLT keeps it, another area hides it.
  await page.getByRole('button', { name: 'Area' }).click();
  await page.getByRole('dialog', { name: 'Area' }).getByRole('button', { name: 'Deira', exact: true }).click();
  await expect(page.getByText('Nothing matches these filters yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(card).toBeVisible();

  // The duplicate check offers the existing place.
  await page.goto('/add/place');
  await page.getByLabel('Name').fill(`sunflower bowl ${stamp}`);
  await expect(page.getByText('Already here? Add your recommendation instead.')).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(placeName) })).toBeVisible();

  // Saved in Me. The Add form has no tab bar: Back first.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Me', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved' }).getByRole('link', { name: new RegExp(placeName) })).toBeVisible();

  expect(problems).toEqual([]);
});

test('signed out visitors can browse Explore, and acting sends them to Join', async ({ page, baseURL }) => {
  const problems = guard(page, new URL(baseURL!).origin);
  await page.goto('/explore?kind=product');
  await expect(page.getByRole('radio', { name: 'Products' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Store' })).toBeVisible();
  await expectNoSideScroll(page, 'Explore products signed out');
  await page.goto('/add/product');
  await expect(page).toHaveURL(/\/join\?next=%2Fadd%2Fproduct$/);
  expect(problems).toEqual([]);
});
