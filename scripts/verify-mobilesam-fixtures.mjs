import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const reports=[];
try {for(const mode of ['webgpu','wasm']) {
 const page=await browser.newPage();
 page.on('console',m=>{if(m.text().includes('MobileSAM'))console.log(mode,m.text());});
 await page.route('**/backpack.jpg',r=>r.fulfill({path:'test-results/coco128/images/train2017/000000000328.jpg',contentType:'image/jpeg'}));
 if(mode==='wasm') await page.route('**/MobileSAM.worker.ts*',async r=>{const response=await r.fetch();await r.fulfill({response,body:"Object.defineProperty(navigator,'gpu',{value:undefined});\n"+await response.text()});});
 await page.goto('http://127.0.0.1:5174');
 const result=await page.evaluate(async(mode)=>{
  const {MobileSAMSegmenter}=await import('/src/core/MobileSAMSegmenter.ts');
  const service=new MobileSAMSegmenter(); await service.load();
  const frame=document.createElement('canvas');frame.width=640;frame.height=480;const ctx=frame.getContext('2d');
  const results=[];
  if(mode==='webgpu') {
   const img=new Image();img.src='/backpack.jpg';await img.decode();frame.height=img.height;ctx.drawImage(img,0,0);
   await service.capture(frame);const mask=await service.select(75,207);
   results.push({fixture:'backpack',area:mask.area,box:mask.boundingBox});
  }
  frame.height=480;ctx.fillStyle='#e8e9ec';ctx.fillRect(0,0,640,480);
  ctx.fillStyle='#ac753e';ctx.beginPath();ctx.moveTo(80,140);ctx.lineTo(140,100);ctx.lineTo(210,150);ctx.lineTo(170,190);ctx.lineTo(220,250);ctx.lineTo(120,320);ctx.lineTo(60,250);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#51391e';ctx.lineWidth=4;ctx.stroke();
  ctx.fillStyle='#3469a1';ctx.fillRect(420,150,130,150);
  await service.capture(frame);
  for(const [x,y] of [[140,210],[485,225]]) {
   const mask=await service.select(x,y);
   if(!mask.mask[y*640+x]) throw Error('Mask does not contain clicked object');
   if((x<320)!==(mask.centroid.x<320)) throw Error('Wrong side segmented');
   results.push({fixture:x<320?'custom cardboard shape':'right object',area:mask.area,box:mask.boundingBox,centroid:mask.centroid});
  }
  service.dispose();return results;
 },mode);
 console.log(JSON.stringify({mode,result}));reports.push({mode,result});await page.close();
} await writeFile('test-results/mobilesam-fixtures.json',JSON.stringify(reports,null,2));}finally{await browser.close();}
