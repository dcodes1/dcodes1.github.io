import { test, expect } from '@playwright/test';
test('built dictionary loads its index only on search and retrieves source data', async ({page}) => {
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto('/translator/index.html');
  await expect(page.getByRole('heading', {name:'Buxori dictionary & learning'})).toBeVisible();
  expect(requests.some(u => /buxori-index/.test(u))).toBe(false);
  await page.getByLabel('Word or phrase').fill('water');
  await page.getByRole('button', {name:'Look up'}).click();
  await expect(page.locator('strong').filter({hasText:'Maim'})).toBeVisible();
  expect(requests.some(u => /buxori-index/.test(u))).toBe(true);
  await page.screenshot({path:'test-results/dictionary.png',fullPage:true});
});
test('portfolio and supporting routes are packaged', async ({page, request}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'David Milov',exact:true})).toBeVisible();
  for (const route of ['/assets/nav.js','/assets/site.css','/translator/engine.js','/translator/data/index.json','/research/','/ai/']) {
    expect((await request.get(route)).status()).toBe(200);
  }
});
