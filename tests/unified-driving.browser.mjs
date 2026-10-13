import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.mockDrive = { distance: 40, paths: [] };
  const original = window.fetch;
  window.fetch = async (url, options) => {
    if (!String(url).startsWith('http://127.0.0.1:30061/')) return original(url, options);
    const path = new URL(String(url)).pathname;
    window.mockDrive.paths.push(path);
    return new Response(path.includes('/Distance/') ? String(window.mockDrive.distance) : path.includes('/Encoder/') ? '0' : path.includes('/Line/') ? '98' : path.includes('/in/') ? 'true' : '200');
  };
});
const forwardCommands = () => page.evaluate(() => window.mockDrive.paths.filter(path => path.includes('/wheels/A/20/20/')).length);
const stops = () => page.evaluate(() => window.mockDrive.paths.filter(path => path.includes('/stopall/')).length);
try {
  await page.goto('http://127.0.0.1:5174');
  await page.getByLabel('Condition source').selectOption('sensor');
  await page.getByRole('button', { name: '+ Add sensor condition', exact: true }).click();
  await page.getByLabel('Sensor condition 1 input').selectOption('finchDistance');
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('stop');
  await page.getByRole('button', { name: 'Your robot', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Finch 2 A', exact: true }).click();
  await page.getByLabel('Base driving behavior', { exact: true }).selectOption('Cruise Forward');
  const start = page.getByRole('button', { name: 'Play rules', exact: true });
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(forwardCommands).toBeGreaterThan(0);
  const stopCount = await stops();
  await page.evaluate(() => window.mockDrive.distance = 10);
  await expect.poll(stops).toBeGreaterThan(stopCount);
  const beforeResume = await forwardCommands();
  await page.evaluate(() => window.mockDrive.distance = 40);
  await expect.poll(forwardCommands).toBeGreaterThan(beforeResume);
  await page.getByRole('button', { name: /STOP ROBOT/ }).click();
  const afterStop = await forwardCommands();
  await page.waitForTimeout(1200); expect(await forwardCommands()).toBe(afterStop);
  await expect(start).toBeEnabled(); await start.click();
  await expect.poll(forwardCommands).toBeGreaterThan(afterStop);
  await page.getByRole('button', { name: 'Drive forward', exact: true }).focus();
  await page.keyboard.down('w'); await page.keyboard.up('w');
  const afterManual = await forwardCommands();
  await page.waitForTimeout(1200); expect(await forwardCommands()).toBe(afterManual);
  await expect(start).toBeEnabled(); await start.click();
  await page.getByRole('button', { name: 'Disconnect from app', exact: true }).click();
  const afterDisconnect = await forwardCommands();
  await page.waitForTimeout(1200); expect(await forwardCommands()).toBe(afterDisconnect);
  console.log('Cruise base pauses for a sensor STOP rule, resumes safely when clear, and never resumes after global STOP, manual takeover or disconnect.');
} finally { await browser.close(); }
