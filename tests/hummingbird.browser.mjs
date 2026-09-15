import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const commands = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
// This fixture never sends commands to physical hardware.
await page.route('http://127.0.0.1:30061/**', route => {
  const path = new URL(route.request().url()).pathname;
  commands.push(path);
  return route.fulfill({ body: path.includes('/in/') ? 'true' : '200', headers: { 'access-control-allow-origin': '*' } });
});
try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5174');
  await expect(page.getByLabel('Robot', { exact: true }).locator('option')).toHaveText(['Finch 2', 'Hummingbird Bit']);
  await page.getByLabel('Robot', { exact: true }).selectOption('hummingbird');
  await expect(page.getByText('Not available for Hummingbird Bit', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Action 1 type', { exact: true })).not.toContainText('Beak light');
  await page.getByRole('button', { name: 'Attach to Hummingbird Bit A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect from app', exact: true })).toBeVisible();
  for (const [name, path] of [
    ['Single LED 1 → 100%', '/led/1/255/A'],
    ['Tri LED 1 → Green', '/triled/1/0/255/0/A'],
    ['Position servo 2 → 90°', '/servo/2/127/A'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => commands.includes(`/hummingbird/out${path}`)).toBe(true);
  }
  await page.getByRole('button', { name: 'Rotation servo 1 → 25% · 500 ms', exact: true }).click();
  await expect.poll(() => commands.includes('/hummingbird/out/rotation/1/127/A')).toBe(true);
  await page.getByRole('button', { name: 'STOP', exact: true }).click();
  await expect.poll(() => commands.includes('/hummingbird/out/rotation/1/255/A')).toBe(true);
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('rotationServo');
  await page.getByLabel('Action 1 movement mode', { exact: true }).selectOption('continuous');
  await expect(page.getByText('Runs while this rule remains true.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vision-robot-studio.projects.v1'))[0]);
  expect(saved.robotType).toBe('hummingbird');
  expect(saved.rules[0].actions[0].mode).toBe('continuous');
  await page.getByRole('button', { name: 'Reset project', exact: true }).click();
  await expect(page.getByText('Robot outputs reset. Your rules are kept.', { exact: true })).toBeVisible();
  expect(commands).toContain('/hummingbird/out/led/3/0/A');
  expect(commands).toContain('/hummingbird/out/triled/2/0/0/0/A');
  await expect(page.getByLabel('Action 1 type', { exact: true })).toHaveValue('rotationServo');
  await page.getByLabel('Robot', { exact: true }).selectOption('finch');
  await expect(page.getByText('Not available for Finch 2', { exact: true })).toBeVisible();
  await page.getByLabel('Robot', { exact: true }).selectOption('hummingbird');
  await expect(page.getByLabel('Action 1 type', { exact: true })).toHaveValue('rotationServo');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/hummingbird.png', fullPage: true });
  expect(errors).toEqual([]);
  console.log('Hummingbird browser fixture passed: real adapter, intercepted HTTP, manual outputs, STOP, capabilities, persistence. Physical outputs not tested.');
} finally { await browser.close(); }
