// Run against vite preview: tests real production assets, backend fallback, and reload.
import { chromium, expect } from '@playwright/test';
for (const mode of ['webgpu', 'wasm', 'gpu-failure']) {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 const page = await browser.newPage();
 const errors = [], failures = [];
 page.on('pageerror', error => errors.push(error.message));
 page.on('response', response => {
  if (/\.(onnx|wasm|mjs)(\?|$)/.test(response.url()) && !response.ok()) failures.push(response.url());
 });
 if (mode === 'wasm') await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
 if (mode === 'gpu-failure') await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: { requestAdapter: async () => null }, configurable: true }));
 try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:5175');
  await page.getByRole('button', { name: 'Load local model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({ timeout: 120000 });
  await expect(page.locator('.backend')).toHaveText(mode === 'wasm' ? 'WASM worker' : mode === 'gpu-failure' ? 'WASM' : 'WebGPU');
  await page.getByRole('button', { name: 'Reload model', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload model', exact: true })).toBeVisible({ timeout: 120000 });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  console.log(`Production YOLO11n load/reload passed: ${mode}`);
 } finally { await browser.close(); }
}
