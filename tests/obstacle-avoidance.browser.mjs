import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5174/');
  await page.getByText('Navigation & safety', { exact: true }).click();
  const avoidance = page.getByRole('checkbox', { name: 'Obstacle avoidance', exact: true });
  const mode = page.getByLabel('Base driving behavior', { exact: true });
  await expect(avoidance).toBeDisabled();
  for (const selected of ['Line Follow', 'Keep Distance']) {
    await mode.selectOption(selected); await expect(avoidance).toBeDisabled();
  }
  await mode.selectOption('Cruise Forward'); await expect(avoidance).toBeEnabled();
  await avoidance.check();
  const distance = page.getByLabel('Obstacle avoidance distance cm', { exact: true });
  await expect(distance).toHaveValue('20'); await expect(distance).toBeEnabled();
  await distance.fill('25'); await expect(distance).toHaveValue('25');
  await expect(page.getByRole('button', { name: /Start.*avoid|Start base behavior/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play rules', exact: true })).toHaveCount(1);
  for (const width of [1440, 1152, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  console.log('Compact avoidance toggle, default threshold, Cruise-only support, single Play, and narrow layout passed.');
} finally { await browser.close(); }
