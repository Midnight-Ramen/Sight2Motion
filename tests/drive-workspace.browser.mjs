import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5174');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByLabel('Base driving behavior', { exact: true })).toHaveValue('None');
  await expect(page.getByLabel('Keep Distance target cm')).toHaveCount(0);
  await expect(page.getByLabel('Road sign class 1')).toHaveCount(0);
  await page.getByLabel('Base driving behavior', { exact: true }).selectOption('Keep Distance');
  await page.getByLabel('Keep Distance target cm').fill('32');
  await expect(page.getByLabel('Line marker action')).toHaveCount(0);
  await page.getByLabel('Base driving behavior', { exact: true }).selectOption('Line Follow');
  await expect(page.getByLabel('Line marker action')).toBeVisible();
  await expect(page.getByLabel('Keep Distance target cm')).toHaveCount(0);
  await page.getByLabel('Base driving behavior', { exact: true }).selectOption('Keep Distance');
  await expect(page.getByLabel('Keep Distance target cm')).toHaveValue('32');
  await page.getByRole('button', { name: 'Your robot', exact: true }).click();
  await expect(page.locator('#robot-panel .base-driving')).toHaveCount(0);
  await expect(page.locator('#rules .base-driving')).toHaveCount(1);
  await expect(page.getByLabel('Condition source')).toBeVisible();
  for (const width of [1440, 1920, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/unified-workspace.png' });
  expect(errors).toEqual([]);
  console.log('Unified workspace, relevant base settings, retained values, ordinary rules and responsive layout passed.');
} finally { await browser.close(); }
