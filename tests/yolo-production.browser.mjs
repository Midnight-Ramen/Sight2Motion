// Run against `vite preview` to catch worker/asset problems hidden by Vite's dev server.
import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = [], failures = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (/\.(onnx|wasm|mjs)(\?|$)/.test(response.url()) && !response.ok()) failures.push(response.url());
});
try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5175');
  await page.getByRole('button', { name: 'Load local model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.backend')).toHaveText('WASM worker');
  await page.getByRole('button', { name: 'Reload model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({ timeout: 60000 });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  console.log('Production YOLO load/reload passed using the real model and WASM worker.');
} finally { await browser.close(); }
