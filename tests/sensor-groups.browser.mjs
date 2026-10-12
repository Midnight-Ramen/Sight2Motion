import { chromium, expect } from '@playwright/test';
import { openSetup } from './setup-ui.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('http://127.0.0.1:30061/**', route => {
  const path = new URL(route.request().url()).pathname;
  return route.fulfill({ body: path.includes('/Light/Left/') ? '20' : path.includes('/Light/Right/') ? '60' : path.includes('/Encoder/') ? '0' : path.includes('/Line/') ? '18' : path.includes('/Distance/') ? '37' : path.includes('/in/') ? 'true' : '200' });
});
try {
  await page.goto('http://127.0.0.1:5174');
  await openSetup(page, 'Sensors');
  for (const label of ['Distance', 'Line', 'Light level', 'Orientation', 'Wheel movement']) {
    await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('checkbox', { name: 'Left Light', exact: true })).toBeHidden();
  await page.getByRole('checkbox', { name: 'Light level', exact: true }).check();
  await page.getByText('Advanced sensors', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Left Light', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Right Light', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Left Line', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Line', exact: true })).toBeChecked({ indeterminate: true });
  await page.getByLabel('Condition source').selectOption('sensor');
  await page.getByRole('button', { name: '+ Add sensor condition', exact: true }).click();
  await page.getByLabel('Sensor condition 1 input').selectOption('finchLineLeft');
  await expect(page.getByLabel('Sensor condition 1 input')).toHaveValue('finchLineLeft');
  await openSetup(page, 'Your robot');
  await page.getByRole('button', { name: 'Connect Finch 2 A', exact: true }).click();
  await openSetup(page, 'Sensors');
  await expect(page.locator('.sensor-group').filter({ has: page.getByRole('checkbox', { name: 'Light level', exact: true }) })).toContainText('40');
  await page.screenshot({ path: 'test-results/sensor-groups.png' });
  console.log('Sensor groups, paired configuration, partial legacy selection, raw rule input and derived light average passed.');
} finally { await browser.close(); }
