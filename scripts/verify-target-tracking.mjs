import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const logs=[]; page.on('console',m=>{if(m.text().includes('MobileSAM')){logs.push(m.text());console.log(m.text());}});
await page.route('**/sam-fixture.jpg',r=>r.fulfill({path:'test-results/coco128/images/train2017/000000000036.jpg',contentType:'image/jpeg'}));
await page.addInitScript(()=>{
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
  const img=new Image();img.src='/sam-fixture.jpg';await img.decode();
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);
  setInterval(()=>c.getContext('2d').drawImage(img,0,0),125);return c.captureStream(8);
 }});
});
try {
 await page.goto(process.env.STUDIO_URL||'http://127.0.0.1:5174');
 await page.evaluate(async()=>{
  const {YoloVisionEngine}=await import('/src/core/VisionEngine.ts');
  const detect=YoloVisionEngine.prototype.detect;window.__yoloCompletions=[];
  YoloVisionEngine.prototype.detect=async function(...args){const result=await detect.apply(this,args);window.__yoloCompletions.push(performance.now());return result;};
 });
 const sampleFps=async()=>{const start=await page.evaluate(()=>performance.now());await page.waitForTimeout(12000);return page.evaluate(start=>window.__yoloCompletions.filter(t=>t>=start).length/((performance.now()-start)/1000),start);};
 const requests=[];page.on('request',r=>{if(r.url().includes('/mobilesam/')) requests.push(r.url());});
 await page.getByRole('button',{name:'Connect camera',exact:true}).click();
 await expect(page.getByRole('button',{name:'Select Object',exact:true})).toBeEnabled({timeout:20000});
 expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'Load local model',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reload model',exact:true})).toBeVisible({timeout:120000});
 await expect(page.locator('.detection-chip').filter({hasText:'person'}).first()).toBeVisible({timeout:30000});
 await page.getByRole('switch',{name:'Mirror horizontally'}).check();
 await expect(page.locator('.detection-chip').filter({hasText:'person'}).first()).toBeVisible({timeout:30000});
 const beforeFps=await sampleFps();
 await page.getByRole('button',{name:'Select Object',exact:true}).click();
 await expect(page.getByText('Click an object · frozen frame',{exact:true})).toBeVisible({timeout:180000});
 const c=page.locator('canvas.selection-frame');const rect=await c.boundingBox();
 const scale=Math.min(rect.width/481,rect.height/640),off=(rect.width-481*scale)/2;
 await page.mouse.click(rect.x+off+(481-320)*scale,rect.y+400*scale);
 await expect(page.getByText('Object selected · frozen frame',{exact:true})).toBeVisible({timeout:180000});
 await page.getByRole('button',{name:'Lock target',exact:true}).click();
 await expect(page.getByText(/TARGET LOCKED.*person/)).toBeVisible({timeout:30000});
 await expect(page.getByText(/TARGET LOCKED.*X error -/)).toBeVisible();
 const samCalls=logs.length; const trackingFps=await sampleFps();
 expect(logs.length).toBe(samCalls);
 await page.screenshot({path:'test-results/target-tracking.png'});
 console.log(JSON.stringify({beforeFps,trackingFps}));
 await writeFile('test-results/target-tracking-fps.json',JSON.stringify({beforeFps,trackingFps},null,2));
 await page.getByRole('button',{name:'Stop Tracking',exact:true}).click();
 await expect(page.locator('canvas.tracking-overlay')).toHaveCount(0);
 await expect(c).toHaveCount(0);
 await expect(page.locator('.detection-chip').filter({hasText:'person'}).first()).toBeVisible({timeout:30000});
 expect(requests.filter(x=>x.endsWith('encoder.onnx'))).toHaveLength(1);
 expect(requests.filter(x=>x.endsWith('decoder.onnx'))).toHaveLength(1);
 console.log('Lazy load, mirrored point selection, mask overlay and return to live passed.');
 await writeFile('test-results/target-tracking-ui.json',JSON.stringify({logs,requests},null,2));
}finally{await browser.close();}
