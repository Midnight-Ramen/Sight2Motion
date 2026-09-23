import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
const logs=[];
page.on('console',m=>{if(m.text().includes('MobileSAM')) { logs.push(m.text()); console.log(m.text()); }});
page.on('pageerror',e=>console.log('PAGEERROR',String(e)));
await page.route('**/sam-fixture.jpg',r=>r.fulfill({path:'test-results/coco128/images/train2017/000000000036.jpg',contentType:'image/jpeg'}));
try {
 await page.goto('http://127.0.0.1:5174');
 const result=await page.evaluate(async()=>{
  const {MobileSAMSegmenter}=await import('/src/core/MobileSAMSegmenter.ts');
  const s=new MobileSAMSegmenter(); await s.load();
  const image=new Image(); image.src='/sam-fixture.jpg'; await image.decode();
  const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
  canvas.getContext('2d').drawImage(image,0,0); await s.capture(canvas);
  const selected=await s.select(image.width*0.475,image.height*0.6);
  const second=await s.select(image.width*0.5,image.height*0.5);
  const report={width:image.width,height:image.height,area:selected.area,box:selected.boundingBox,centroid:selected.centroid,secondArea:second.area};
  s.dispose(); return report;
 });
 console.log(JSON.stringify(result)); await writeFile('test-results/mobilesam-report.json',JSON.stringify({result,logs},null,2));
} finally {await browser.close();}
