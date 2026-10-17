import { expect, test, type Page } from '@playwright/test';
import type { AccountWithCodeResponse } from '../../shared/types';

async function member(page: Page, origin: string) {
  await page.context().clearCookies();
  const response = await page.request.post('/api/auth/signup', {
    headers: { origin },
    data: { email: `disc.${crypto.randomUUID()}@example.test`, password: 'synthetic password only' },
  });
  expect(response.status()).toBe(201);
  const signed: AccountWithCodeResponse = await response.json();
  return { origin, 'x-csrf-token': signed.csrf };
}

test('DATA-06: adding a product records no opinion until the member chooses one', async ({ page, baseURL }) => {
  await member(page, baseURL!);
  await page.goto('/add/product');
  await page.getByLabel('Product name').fill(`Synthetic oat drink ${crypto.randomUUID().slice(0, 6)}`);
  await page.getByRole('group', { name: 'Where to buy it' }).getByRole('button', { name: 'Online', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I recommend it' })).toHaveAttribute('aria-pressed', 'false');
  const created = page.waitForResponse((r) => r.url().endsWith('/api/listings') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const { listing } = await (await created).json();
  expect(listing.myOpinion).toBeNull();
  expect(listing.recommendCount).toBe(0);
  await expect(page.getByTestId('opinion-summary')).toHaveText('Be the first to recommend');
});

test('UX-04: the owner shortcut selects the service and publishes an offer there', async ({ page, baseURL }) => {
  const headers = await member(page, baseURL!);
  const name = `Synthetic bakery ${crypto.randomUUID().slice(0, 6)}`;
  const response = await page.request.post('/api/services', { headers, data: {
    name, summary: 'Synthetic vegan cakes baked to order', category: 'Home baker', area: 'JLT', veganStatus: 'fully_vegan',
  } });
  expect(response.status()).toBe(201);
  const service = await response.json();
  const failed: string[] = [];
  page.on('response', (r) => { if (r.url().includes('/api/listings/') && r.status() === 404) failed.push(r.url()); });
  await page.goto(`/services/${service.slug}`);
  await page.getByRole('button', { name: 'Edit your page' }).click();
  await page.getByRole('link', { name: 'Post an offer', exact: true }).click();
  await expect(page).toHaveURL(`/add/offer?listing=${service.slug}`);
  await expect(page.getByRole('button', { name: 'Choose another' })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByLabel('The offer', { exact: true }).fill('Synthetic weekend discount');
  await page.getByRole('button', { name: 'Share offer', exact: true }).click();
  await expect(page).toHaveURL(`/services/${service.slug}`);
  await expect(page.getByText('Synthetic weekend discount', { exact: false })).toBeVisible();
  expect(failed).toEqual([]);
});

test('UX-06: choosing a duplicate opens its recommendation composer', async ({ page, baseURL }) => {
  const headers = await member(page, baseURL!);
  const name = `Synthetic duplicate ${crypto.randomUUID().slice(0, 6)}`;
  const response = await page.request.post('/api/listings', { headers, data: {
    kind: 'place', name, area: 'JLT', veganStatus: 'fully_vegan', opinion: null,
  } });
  expect(response.status()).toBe(201);
  const { listing } = await response.json();
  await page.goto('/add/place');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(`/places/${listing.slug}#recommend`);
  const composer = page.getByRole('dialog', { name: `Recommend ${name}` });
  await expect(composer).toBeVisible();
  await composer.getByLabel('What to order, and why').fill('Synthetic recommendation from the duplicate shortcut');
  await composer.getByRole('button', { name: 'Post recommendation' }).click();
  await expect(composer).not.toBeVisible();
  await expect(page.getByText('Synthetic recommendation from the duplicate shortcut', { exact: true })).toBeVisible();
});

for (const type of ['places', 'products', 'services', 'discussions'] as const) {
  test(`UX-03: ${type} search loads every page with loading, retry and end states`, async ({ page }) => {
    let failing = true;
    let release: (() => void) | undefined;
    await page.route('**/api/search?**', async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const category = url.searchParams.get('type');
      if (offset === 30 && failing) {
        await route.fulfill({ status: 503, json: { error: 'Synthetic unavailable search' } });
        return;
      }
      if (offset === 30) await new Promise<void>((resolve) => { release = resolve; });
      const count = category ? (offset === 0 ? 30 : 1) : 3;
      const items = Array.from({ length: count }, (_, i) => {
        const id = String(offset + i + 1);
        return type === 'discussions'
          ? { id, kind: 'discussion', title: `Synthetic result ${id}`, snippet: null, replyCount: 0, matchedVia: 'topic' }
          : { id, kind: type === 'places' ? 'place' : type === 'products' ? 'product' : 'service', name: `Synthetic result ${id}`, slug: `synthetic-${id}`, category: '', area: 'JLT', veganStatus: 'fully_vegan', recommendCount: 0, photoUrl: null, snippet: null, matchedVia: 'listing' };
      });
      await route.fulfill({ json: {
        q: 'Synthetic', places: { items: [], total: 0 }, products: { items: [], total: 0 },
        services: { items: [], total: 0 }, discussions: { items: [], total: 0 }, [type]: { items, total: 31 },
      } });
    });
    await page.goto('/search?q=Synthetic');
    await page.getByRole('link', { name: `See all 31 ${type}` }).click();
    await expect(page).toHaveURL(`/search?q=Synthetic&type=${type}`);
    await expect(page.getByText('Synthetic result 30', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic result 1', { exact: true })).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Loading', exact: true })).toBeVisible();
    expect(release).toBeDefined();
    release?.();
    await expect(page.getByText('Synthetic result 31', { exact: true })).toBeVisible();
    await expect(page.getByText('All results shown.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(`/search?q=Synthetic&type=${type}`);
  });
}

async function reportingFixture(page: Page, origin: string, kind: 'place' | 'service') {
  const owner = await member(page, origin);
  await page.goto('/');
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const photoResponse = await page.request.post('/api/photos', {
    headers: { ...owner, 'content-type': 'image/jpeg' }, data: Buffer.from(jpeg, 'base64'),
  });
  expect(photoResponse.status()).toBe(201);
  const hero = await photoResponse.json();
  const name = `Synthetic report ${crypto.randomUUID().slice(0, 6)}`;
  const response = await page.request.post(kind === 'place' ? '/api/listings' : '/api/services', { headers: owner, data: kind === 'place'
    ? { kind, name, area: 'JLT', veganStatus: 'fully_vegan', opinion: null, photoId: hero.id }
    : { name, area: 'JLT', summary: 'Synthetic vegan cakes', category: 'Home baker', photoId: hero.id },
  });
  expect(response.status()).toBe(201);
  const created = await response.json();
  const listing = kind === 'place' ? created.listing : created;
  const author = await member(page, origin);
  const recPhotoResponse = await page.request.post('/api/photos', {
    headers: { ...author, 'content-type': 'image/jpeg' }, data: Buffer.from(jpeg, 'base64'),
  });
  expect(recPhotoResponse.status()).toBe(201);
  const photo = await recPhotoResponse.json();
  const recommendationResponse = await page.request.post(`/api/listings/${listing.slug}/recommendations`, {
    headers: author, data: { body: 'Synthetic recommendation to report', photoId: photo.id },
  });
  expect(recommendationResponse.status()).toBe(201);
  const { recommendation } = await recommendationResponse.json();
  await member(page, origin);
  return { listing, recommendation, photo, hero, path: `/${kind === 'place' ? 'places' : 'services'}/${listing.slug}` };
}

async function sendReport(page: Page, targetType: string, targetId: string) {
  const dialog = page.getByRole('dialog', { name: 'What is wrong?' });
  await dialog.getByRole('radio', { name: 'Spam or advertising' }).click();
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/reports') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  const response = await sent;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ target_type: targetType, target_id: targetId, reason: 'spam' });
  await expect(dialog).not.toBeVisible();
}

for (const kind of ['place', 'service'] as const) {
  test(`UX-01: ${kind} reports target the recommendation and each photo`, async ({ page, baseURL }, testInfo) => {
    const fixture = await reportingFixture(page, baseURL!, kind);
    await page.goto(fixture.path);
    const hero = page.getByTestId('hero');
    await expect(hero).toBeVisible();
    const bounds = await hero.boundingBox();
    expect(bounds?.x).toBe(0);
    expect(bounds?.width).toBe(page.viewportSize()?.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()?.width);
    const rec = page.getByRole('article').filter({ has: page.getByText('Synthetic recommendation to report', { exact: true }) }).last();
    await rec.getByRole('button', { name: 'Report recommendation', exact: true }).click();
    await sendReport(page, 'recommendation', fixture.recommendation.id);
    await rec.getByRole('button', { name: 'Report photo', exact: true }).click();
    await sendReport(page, 'photo', fixture.photo.id);
    await page.getByTestId('listing-photo').getByRole('button', { name: 'Report photo', exact: true }).click();
    await sendReport(page, 'photo', fixture.hero.id);
    await page.screenshot({ path: testInfo.outputPath('reporting.png'), fullPage: true });
  });
}

test('UX-01: Home reports target the displayed recommendation and photo', async ({ page, baseURL }) => {
  const fixture = await reportingFixture(page, baseURL!, 'place');
  await page.goto('/');
  const card = page.getByTestId('feed-item').filter({ hasText: fixture.listing.name }).filter({ hasText: 'Synthetic recommendation to report' });
  await card.getByRole('button', { name: 'Report recommendation', exact: true }).click();
  await sendReport(page, 'recommendation', fixture.recommendation.id);
  await card.getByRole('button', { name: 'Report photo', exact: true }).click();
  await sendReport(page, 'photo', fixture.photo.id);
});

test('DATA-04: service areas match Explore and delivery services appear in every area', async ({ page, baseURL }) => {
  const headers = await member(page, baseURL!);
  const name = `Synthetic downtown ${crypto.randomUUID().slice(0, 6)}`;
  await page.goto('/add/service');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('What you offer').fill('Synthetic vegan cakes baked to order');
  await page.getByRole('group', { name: 'Category', exact: true }).getByRole('button', { name: 'Home baker', exact: true }).click();
  await page.getByRole('group', { name: 'Vegan status', exact: true }).getByRole('button', { name: 'Fully vegan', exact: true }).click();
  await page.getByRole('group', { name: 'Area', exact: true }).getByRole('button', { name: 'Downtown Dubai', exact: true }).click();
  await page.getByRole('button', { name: 'Add my service', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const delivered = await page.request.post('/api/services', { headers, data: {
    name: `Synthetic delivery ${crypto.randomUUID().slice(0, 6)}`, summary: 'Synthetic delivery across Dubai',
    category: 'Home baker', area: 'Delivery only',
  } });
  expect(delivered.status()).toBe(201);
  const delivery = await delivered.json();
  await page.goto('/explore?kind=service');
  await page.getByRole('button', { name: 'Area', exact: true }).click();
  await page.getByRole('dialog', { name: 'Area', exact: true }).getByRole('button', { name: 'Downtown Dubai', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(page.locator(`a[href="/services/${delivery.slug}"]`)).toBeVisible();
  await expect(page).toHaveURL('/explore?kind=service&area=Downtown+Dubai');
  await page.getByRole('button', { name: 'Downtown Dubai', exact: true }).click();
  await page.getByRole('dialog', { name: 'Area', exact: true }).getByRole('button', { name: 'Motor City', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
  await expect(page.locator(`a[href="/services/${delivery.slug}"]`)).toBeVisible();
});

test('review 14: previous search results stay visible while a debounced query loads', async ({ page, baseURL }, testInfo) => {
  const headers = await member(page, baseURL!);
  const term = `flash${crypto.randomUUID().slice(0, 6)}`;
  const name = `Synthetic tofu ${term}`;
  expect((await page.request.post('/api/listings', { headers, data: {
    kind: 'place', name, area: 'JLT', veganStatus: 'fully_vegan',
  } })).status()).toBe(201);
  await page.goto(`/search?q=${term}`);
  const result = page.getByRole('link').filter({ hasText: name });
  await expect(result).toBeVisible();
  const next = `${term} unmatched`;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === next) await gate;
    await route.continue();
  });
  try {
    const requested = page.waitForRequest(request => request.url().includes('/api/search?') && new URL(request.url()).searchParams.get('q') === next);
    await page.getByRole('searchbox').fill(next);
    await requested;
    await expect(result).toBeVisible();
    await expect(page.getByRole('status', { name: 'Searching', exact: true })).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('search-previous-results.png'), fullPage: true });
  } finally { release(); }
  await expect(page.getByText(/^Nothing found for/)).toBeVisible();
  await expect(result).toHaveCount(0);
});
