import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.addInitScript(() => {
  window.driveTest = { distance: 40, paths: [] };
  const original = window.fetch;
  window.fetch = async (url, options) => {
    if (!String(url).startsWith('http://127.0.0.1:30061/')) return original(url, options);
    const path = new URL(String(url)).pathname;
    window.driveTest.paths.push(path);
    return new Response(path.includes('/Distance/') ? String(window.driveTest.distance) : path.includes('/Encoder/') ? '0' : path.includes('/Line/') ? '98' : path.includes('/in/') ? 'true' : '200');
  };
});
const wheels = () => page.evaluate(() => window.driveTest.paths.filter(path => /\/wheels\/A\/(?!0\/0\/)/.test(path)).length);
try {
  await page.goto('http://127.0.0.1:5174/');
  await page.getByLabel('Condition source').selectOption('sensor');
  await page.getByRole('button', { name: '+ Add sensor condition', exact: true }).click();
  await page.getByLabel('Sensor condition 1 input').selectOption('finchDistance');
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('stop');
  await page.getByRole('button', { name: 'Your robot', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Finch 2 A', exact: true }).click();
  const play = page.getByRole('button', { name: 'Play rules', exact: true });
  const stop = page.getByRole('button', { name: /STOP ROBOT/ });
  const mode = page.getByLabel('Base driving behavior', { exact: true });
  await expect(page.getByRole('button', { name: 'Start base behavior', exact: true })).toHaveCount(0);
  await expect(play).toBeEnabled(); await play.click();
  await expect(page.locator('#play-controls').getByRole('button', { name: 'Running', exact: true })).toBeVisible();
  await page.waitForTimeout(300); expect(await wheels()).toBe(0);
  await stop.click();
  for (const selected of ['Cruise Forward', 'Line Follow', 'Keep Distance']) {
    const before = await wheels();
    await mode.selectOption(selected);
    await page.waitForTimeout(250); expect(await wheels()).toBe(before);
    await expect(play).toBeEnabled(); await play.click();
    await expect.poll(wheels).toBeGreaterThan(before);
    await expect(mode).toBeDisabled();
    await stop.click();
    const stopped = await wheels(); await page.waitForTimeout(400); expect(await wheels()).toBe(stopped);
  }
  await mode.selectOption('Cruise Forward');
  await expect(play).toBeEnabled(); await play.click();
  const beforeBrake = await page.evaluate(() => window.driveTest.paths.filter(path => path.includes('/stopall/')).length);
  await page.evaluate(() => window.driveTest.distance = 10);
  await expect.poll(() => page.evaluate(() => window.driveTest.paths.filter(path => path.includes('/stopall/')).length)).toBeGreaterThan(beforeBrake);
  await page.waitForTimeout(200); const suspended = await wheels();
  await page.evaluate(() => window.driveTest.distance = 40);
  await expect.poll(wheels).toBeGreaterThan(suspended);
  await page.keyboard.press('Space'); const afterSpace = await wheels();
  await page.waitForTimeout(500); expect(await wheels()).toBe(afterSpace);
  console.log('Single Play: None rules-only, all three bases start, paused selection never moves, rule override/resume, STOP/Space latch passed.');
} finally { await browser.close(); }
