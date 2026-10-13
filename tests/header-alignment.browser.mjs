import { chromium, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.route('http://127.0.0.1:30061/**', route => route.fulfill({ body: 'false' }));
try {
  await page.goto('http://127.0.0.1:5174/');
  for (const width of [1280, 1366, 1440, 1920, 1024, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const result = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { y: r.y + r.height / 2, bottom: r.bottom, top: r.top, width: r.width }; };
      return { brand: rect('.topbar .brand'), beta: rect('.topbar .beta'), icon: rect('.brand-icon'), input: rect('[aria-label="Project name"]'),
        theme: rect('.theme-toggle'), help: rect('.topbar [aria-label="Help"]'), buttons: rect('.project-buttons'),
        overflow: document.documentElement.scrollWidth > innerWidth, scale: devicePixelRatio, zoom: getComputedStyle(document.documentElement).zoom };
    });
    expect(result.scale).toBe(1); expect(['1', 'normal']).toContain(result.zoom);
    expect(result.overflow).toBe(false);
    expect(Math.abs(result.theme.y - result.help.y)).toBeLessThanOrEqual(.5);
    if (result.beta.width > 0) expect(Math.abs(result.beta.y - result.icon.y)).toBeLessThanOrEqual(.5);
    if (width > 1250) {
      expect(Math.abs(result.brand.y - result.input.y)).toBeLessThanOrEqual(.5);
      expect(Math.abs(result.theme.y - result.input.y)).toBeLessThanOrEqual(.5);
      expect(result.buttons.top).toBeGreaterThanOrEqual(result.input.bottom);
    }
    console.log(`${width}px: aligned at 100% zoom; no horizontal overflow`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/header-alignment.png', clip: { x: 0, y: 0, width: 1440, height: 110 } });
} finally { await browser.close(); }
