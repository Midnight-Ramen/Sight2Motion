import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const paths = [], errors = [];
let raw = '30';
page.on('pageerror', error => errors.push(error.message));
// Isolated test fixture: no requests reach hardware.
await page.route('http://127.0.0.1:30061/**', route => {
  const path = new URL(route.request().url()).pathname;
  paths.push(path);
  return route.fulfill({ body: path.includes('/sensor/') ? raw : path.includes('/in/') ? 'true' : '200', headers: { 'access-control-allow-origin': '*' } });
});
try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5174');
  await page.getByLabel('Robot', { exact: true }).selectOption('hummingbird');
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  await page.getByLabel('Input 1 sensor').selectOption('distance');
  await expect(page.getByLabel('Input 4 sensor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Attach to Hummingbird Bit A', exact: true }).click();
  await expect(page.getByLabel('Hummingbird sensor inputs')).toContainText('35 cm');
  await page.getByRole('button', { name: '+ Add sensor condition', exact: true }).click();
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('triLed');
  await page.getByLabel('Action 1 color', { exact: true }).fill('#ff0000');
  await page.getByRole('button', { name: 'Just exploring? Try the demo', exact: true }).click();
  await page.getByRole('button', { name: 'Play rules', exact: true }).click();
  await page.waitForTimeout(900);
  expect(paths.includes('/hummingbird/out/triled/1/255/0/0/A')).toBe(false);
  raw = '10';
  await expect.poll(() => paths.includes('/hummingbird/out/triled/1/255/0/0/A')).toBe(true);
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('rotationServo');
  await page.getByLabel('Action 1 movement mode').selectOption('continuous');
  await page.getByLabel('Sensor condition 1 operator').selectOption('greaterThan');
  await page.getByLabel('Sensor condition 1 value').fill('25');
  raw = '30';
  paths.length = 0;
  await page.getByRole('button', { name: 'Play rules', exact: true }).click();
  await expect.poll(() => paths.some(p => p.includes('/out/rotation/1/') && !p.includes('/255/'))).toBe(true);
  paths.length = 0; raw = '10';
  await expect.poll(() => paths.includes('/hummingbird/out/rotation/1/255/A')).toBe(true);
  raw = 'Not Connected';
  await expect(page.getByLabel('Hummingbird sensor inputs')).toContainText('Unavailable');
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const download = await downloadReady;
  const downloaded = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(downloaded.rules[0].sensorConditions[0].value).toBe(25);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vision-robot-studio.projects.v1'))[0]);
  expect(saved.sensorConfiguration[0].id).toBe('distance:1');
  expect(saved.rules[0].sensorConditions[0].value).toBe(25);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/sensors.png', fullPage: true });
  await page.getByLabel('Robot', { exact: true }).selectOption('finch');
  await expect(page.getByLabel('Sensor condition 1 input')).toHaveCount(0);
  await expect(page.getByLabel('Input 1 sensor')).toHaveCount(0);
  const count = paths.filter(p => p.includes('/in/sensor/')).length;
  await page.waitForTimeout(500);
  expect(paths.filter(p => p.includes('/in/sensor/')).length).toBe(count);
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: 'student-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(downloaded)),
  });
  await expect(page.getByLabel('Robot', { exact: true })).toHaveValue('hummingbird');
  await expect(page.getByLabel('Sensor condition 1 value')).toHaveValue('25');
  await page.getByRole('button', { name: 'Reset project', exact: true }).click();
  await expect(page.getByLabel('Sensor condition 1 input')).toHaveCount(0);
  await expect(page.getByLabel('Input 1 sensor')).toHaveValue('');
  expect(errors).toEqual([]);
  console.log('Sensor browser checks passed: configuration, live values, vision AND sensor, continuous release, unavailable input, persistence, Finch switch. Hardware requests intercepted.');
} finally { await browser.close(); }
