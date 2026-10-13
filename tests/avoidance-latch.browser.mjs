import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.addInitScript(() => {
  const realNow = performance.now.bind(performance);
  // Keep simulated input age deterministic under host load; production freshness is unchanged.
  Object.defineProperty(performance, 'now', { value: () => realNow() / 4 });
  // No hardware requests escape this simulated robot, including worker watchdogs.
  window.Worker = class extends EventTarget {
    postMessage(message) { if (message.type === 'arm') queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { type: 'armed', id: message.id } }))); }
    terminate() {}
  };
  const hardware = window.latchRobot = { left: 0, right: 0, l: 0, r: 0, at: realNow(), paths: [], statuses: [], plays: [], safetyDuringRun: [], bypass: false };
  const update = () => {
    const now = realNow(), dt = now - hardware.at; hardware.at = now;
    hardware.left += hardware.l * dt / 20000; hardware.right += hardware.r * dt / 20000;
  };
  const original = window.fetch;
  window.fetch = async (url, options) => {
    if (!String(url).startsWith('http://127.0.0.1:30061/')) return original(url, options);
    update(); const path = new URL(String(url)).pathname; hardware.paths.push(path);
    const match = path.match(/\/wheels\/A\/(-?\d+)\/(-?\d+)\//);
    if (match) { hardware.l = Number(match[1]); hardware.r = Number(match[2]); }
    if (path.includes('/stopall/') || path.includes('/stopFinch/')) { hardware.l = 0; hardware.r = 0; }
    let value = '200';
    if (path.includes('/Encoder/')) value = String(path.includes('/Left/') ? hardware.left : hardware.right);
    else if (path.includes('/Distance/')) {
      const heading = (hardware.right - hardware.left) * (Math.PI * 5) / 10.1 * 180 / Math.PI;
      value = String(hardware.bypass ? 45 : heading > 15 ? 60 : heading < -15 ? 35 : 18);
    } else if (path.includes('/Line/')) value = '98';
    else if (path.includes('/in/')) value = 'true';
    return new Response(value);
  };
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => {
      const status = document.querySelector('.base-driving > small[role=status]')?.textContent ?? '';
      const play = document.querySelector('#play-controls > .primary')?.textContent?.trim() ?? '';
      if (status && hardware.statuses.at(-1) !== status) hardware.statuses.push(status);
      if (play && hardware.plays.at(-1) !== play) hardware.plays.push(play);
      if (play === 'Running') { const disabled = document.querySelector('[aria-label="Emergency stop distance cm"]')?.disabled; if (hardware.safetyDuringRun.at(-1) !== disabled) hardware.safetyDuringRun.push(disabled); }
      if (status.startsWith('Bypassing')) hardware.bypass = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
});
try {
  await page.goto('http://127.0.0.1:5174/');
  await page.getByLabel('Condition source').selectOption('sensor');
  await page.getByRole('button', { name: '+ Add sensor condition', exact: true }).click();
  await page.getByLabel('Sensor condition 1 input').selectOption('finchDistance');
  await page.getByLabel('Action 1 type', { exact: true }).selectOption('avoidObstacle');
  await page.getByRole('button', { name: 'Your robot', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Finch 2 A', exact: true }).click();
  await page.getByLabel('Base driving behavior', { exact: true }).selectOption('Cruise Forward');
  const play = page.getByRole('button', { name: 'Play rules', exact: true });
  for (let attempt = 0; attempt < 10; attempt++) {
    await expect(play).toBeEnabled(); await play.click();
    await page.waitForTimeout(50);
    if (await page.locator('#play-controls').getByRole('button', { name: 'Running', exact: true }).count()) break;
  }
  await expect(page.locator('#play-controls').getByRole('button', { name: 'Running', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.latchRobot.statuses.includes('Bypassing left')), { timeout: 30000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.latchRobot.statuses.filter(status => status === 'Cruise Forward active').length), { timeout: 30000 }).toBe(2);
  const evidence = await page.evaluate(() => ({ statuses: window.latchRobot.statuses, plays: window.latchRobot.plays, safety: window.latchRobot.safetyDuringRun }));
  expect(evidence.statuses).toContain('Scanning left'); expect(evidence.statuses).toContain('Scanning right');
  expect(evidence.safety).toEqual([true]);
  expect(evidence.plays.slice(evidence.plays.indexOf('Running'))).toEqual(['Running']);
  expect(evidence.statuses.filter(status => status === 'Avoiding obstacle')).toHaveLength(1);
  await page.keyboard.press('Space');
  const commands = await page.evaluate(() => window.latchRobot.paths.filter(path => path.includes('/wheels/')).length);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.latchRobot.paths.filter(path => path.includes('/wheels/')).length)).toBe(commands);
  console.log('Simulated calibrated scan/bypass completed despite Distance changing; Play stayed Running; Cruise resumed once; Space latched STOP.');
} catch (error) { console.log(await page.evaluate(() => ({ statuses: window.latchRobot.statuses, plays: window.latchRobot.plays, wheels: window.latchRobot.paths.filter(p => p.includes('/wheels/')), left: window.latchRobot.left, right: window.latchRobot.right }))); throw error; } finally { await browser.close(); }
