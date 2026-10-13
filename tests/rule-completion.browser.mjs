import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route('http://127.0.0.1:30061/**', route => route.fulfill({ body: 'false' }));
try {
  await page.goto('http://127.0.0.1:5174/');
  const card = page.locator('.rule-card').first();
  await expect(card.locator('.rule-heading input[type=text]')).toHaveCount(0);
  await card.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(card.locator('.rule-body')).not.toBeVisible();
  await expect(card.locator('.rule-title')).toHaveText('Person \u2192 Beak light');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(card.locator('.rule-body')).toBeVisible();
  await card.getByLabel('Action 1 type', { exact: true }).selectOption('stop');
  await card.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(card.locator('.rule-title')).toHaveText('Person \u2192 Stop');
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await card.getByLabel('Condition source').selectOption('sensor');
  await card.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(card.locator('.rule-body')).toBeVisible();
  await expect(card.getByRole('alert')).toHaveText('Choose a sensor condition.');
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/rule-completion-validation.png' });
  console.log('Done naming, collapse, reopen, edit refresh and incomplete guidance passed. No hardware requests escaped mocks.');
} finally { await browser.close(); }
