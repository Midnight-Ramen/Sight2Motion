import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto('http://127.0.0.1:5174/');
  const action = page.getByLabel('Action 1 type', { exact: true });
  await expect(action.locator('optgroup')).toHaveCount(2);
  await expect(action.locator('optgroup').first()).toHaveAttribute('label', 'Driving');
  await expect(action.locator('optgroup').last()).toHaveAttribute('label', 'Signals');
  await action.selectOption('slowDown');
  await expect(page.getByRole('spinbutton', { name: 'Action 1 speed', exact: true })).toHaveValue('20');
  await page.getByRole('spinbutton', { name: 'Action 1 speed', exact: true }).fill('25');
  await action.selectOption('setSpeed');
  await expect(page.getByRole('spinbutton', { name: 'Action 1 speed', exact: true })).toHaveValue('20');
  for (const kind of ['veerLeft', 'veerRight', 'resumeBase']) {
    await action.selectOption(kind);
    await expect(action).toHaveValue(kind);
    await expect(page.getByRole('spinbutton', { name: /Action 1 speed/ })).toHaveCount(0);
  }
  for (const direction of ['left', 'right']) {
    await action.selectOption(`turn-${direction}`);
    await expect(page.getByLabel('Move direction', { exact: true })).toHaveValue(direction);
  }
  await action.selectOption('beak');
  await expect(page.getByLabel('Action 1 color', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Base driving behavior', { exact: true })).toHaveValue('None');
  for (const width of [1440, 1152, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  console.log('Driving/Signals groups, relevant settings, existing turns/lights, and narrow layout passed.');
} finally { await browser.close(); }
