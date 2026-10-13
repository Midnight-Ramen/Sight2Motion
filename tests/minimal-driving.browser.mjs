import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.addInitScript(() => {
  window.minimalDrive = { paths: [], distance: 40 };
  const original = window.fetch;
  window.fetch = async (url, options) => {
    if (!String(url).startsWith('http://127.0.0.1:30061/')) return original(url, options);
    const path = new URL(String(url)).pathname; window.minimalDrive.paths.push(path);
    return new Response(path.includes('/Distance/') ? String(window.minimalDrive.distance) : path.includes('/Encoder/') ? '0' : path.includes('/Line/') ? '98' : path.includes('/in/') ? 'true' : '200');
  };
});
try {
  await page.goto('http://127.0.0.1:5174/');
  const emergency = page.getByRole('checkbox', { name: 'Emergency braking', exact: true });
  await expect(emergency).toBeVisible(); await expect(emergency).toBeChecked();
  const threshold = page.getByLabel('Emergency stop distance cm', { exact: true });
  await expect(threshold).toHaveValue('10'); await threshold.fill('12'); await expect(threshold).toHaveValue('12');
  await emergency.uncheck(); await expect(emergency).not.toBeChecked(); await emergency.check();
  for (const name of ['Drive distance cm', 'Turn angle degrees', 'Drive Until distance cm']) await expect(page.getByLabel(name, { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to Base', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Obstacle avoidance', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Obstacle avoidance distance cm', { exact: true })).toHaveCount(0);
  await page.getByLabel('Condition source').selectOption('sensor');
  await page.getByRole('button', { name: '+ Add sensor condition', exact: true }).click();
  await page.getByLabel('Sensor condition 1 input').selectOption('finchDistance');
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('avoidObstacle');
  await expect(page.getByText('Uses this rule’s Distance threshold. Cruise Forward only.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your robot', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Finch 2 A', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.minimalDrive.paths.filter(path => path.includes('/Distance/')).length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.minimalDrive.paths.filter(path => path.includes('/wheels/')).length)).toBe(0);
  const play = page.getByRole('button', { name: 'Play rules', exact: true });
  await expect(play).toBeEnabled(); await play.click();
  await expect(page.locator('#play-controls').getByRole('button', { name: 'Running', exact: true })).toBeVisible();
  await page.evaluate(() => window.minimalDrive.distance = 8);
  await expect(play).toBeVisible();
  await page.evaluate(() => window.minimalDrive.distance = 40);
  await expect(play).toBeEnabled(); await page.waitForTimeout(250);
  await expect(play).toBeVisible();
  for (const width of [1440, 1152, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  console.log('Safety default ON/10, editable/uncheckable, hidden navigation, condition-owned avoidance threshold, Distance registration, paused no-motion, compact layout passed.');
} finally { await browser.close(); }
