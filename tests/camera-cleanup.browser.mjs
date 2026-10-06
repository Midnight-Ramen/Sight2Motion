import { chromium, expect } from '@playwright/test';
import { openSetup } from './setup-ui.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
try {
 await page.goto('http://127.0.0.1:5174');
 const stage=page.locator('.camera-stage');
 await expect(stage.getByRole('heading',{name:'A little vision. A lot of possibility.'})).toBeVisible();
 await expect(stage.getByRole('button',{name:'Start Camera',exact:true})).toBeVisible();
 await expect(stage.getByText('Frames are processed in this browser. No video is uploaded.')).toBeVisible();
 await expect(stage.locator('.viewfinder, .demo-link, .selection-controls')).toHaveCount(0);
 await expect(stage.getByText(/discover the world/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Select Object',exact:true})).not.toBeVisible();
 await page.locator('.selection-drawer > summary').click();
 const drawer=page.locator('.selection-drawer');
 await expect(drawer.getByRole('button',{name:'Select Object',exact:true})).toBeVisible();
 await expect(drawer.getByText('Select an object in the camera to use Selected Target.')).toBeVisible();
 await expect(drawer.locator('.selection-controls')).toHaveCSS('position','static');
 await page.locator('.selection-drawer > summary').click();
 await openSetup(page,'AI model');
 await page.getByRole('combobox',{name:'AI model',exact:true}).selectOption('teachable-machine');
 await expect(page.getByRole('button',{name:'Select Object',exact:true})).not.toBeVisible();
 await expect(stage.locator('.selection-controls')).toHaveCount(0);
 console.log('Camera empty state and drawer-only selection UI passed for YOLO and Teachable Machine.');
} finally {await browser.close();}
