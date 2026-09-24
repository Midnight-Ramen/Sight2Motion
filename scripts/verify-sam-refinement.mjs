// Real exported models; local COCO fixtures only. Does not connect to a robot.
import { chromium } from '@playwright/test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const fixtures=[{name:'cup',file:'000000000127.jpg',points:[{x:455,y:295,label:1},{x:540,y:300,label:1},{x:422,y:377,label:0}]}];
for(const [name,id] of [['bottle',39],['cell phone',67]]) {
 for(const file of await readdir('test-results/coco128/labels/train2017')) {
  const rows=(await readFile('test-results/coco128/labels/train2017/'+file,'utf8')).trim().split('\n').map(r=>r.split(' ').map(Number));
  const row=rows.find(r=>r[0]===id&&r[3]*r[4]>0.01);
  if(row){fixtures.push({name,file:file.replace('.txt','.jpg'),normalized:row.slice(1),
    ...(name==='cell phone'?{points:[{x:350,y:155,label:1},{x:520,y:190,label:1},{x:565,y:175,label:0}]}:{})});break;}
 }
}
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(); const logs=[];
 page.on('console',m=>{if(m.text().includes('MobileSAM'))logs.push(m.text());});
 await page.route('**/sam-test/*',r=>r.fulfill({path:'test-results/coco128/images/train2017/'+new URL(r.request().url()).pathname.split('/').pop(),contentType:'image/jpeg'}));
 await page.goto('http://127.0.0.1:5174');
 const results=await page.evaluate(async fixtures=>{
  const {MobileSAMSegmenter}=await import('/src/core/MobileSAMSegmenter.ts');
  const {YoloVisionEngine}=await import('/src/core/VisionEngine.ts');
  const {associateSelection}=await import('/src/core/SAMAssociation.ts');
  const sam=new MobileSAMSegmenter(),yolo=new YoloVisionEngine();await sam.load();await yolo.load('./models/yolo11n.onnx');
  const results=[];
  for(const f of fixtures) {
   const image=new Image();image.src='/sam-test/'+f.file;await image.decode();
   const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);
   const detections=await yolo.detect(c,0.25);await sam.capture(c);
   let points=f.points;
   if(!points){const [cx,cy,w,h]=f.normalized;points=[{x:cx*c.width,y:cy*c.height,label:1},{x:cx*c.width,y:(cy+h*.2)*c.height,label:1},{x:(cx+w*.7)*c.width,y:cy*c.height,label:0}];}
   const first=await sam.select(points[0].x,points[0].y);
   const positive=await sam.refine({points:points.slice(0,2)});
   const refined=await sam.refine({points});
   const undone=await sam.refine({points:points.slice(0,2)});
   if(undone.area!==positive.area)throw Error('Undo is not deterministic');
   const boxed=await sam.refine({points:[],box:first.boundingBox});
   sam.clearSelection();const reused=await sam.select(points[0].x,points[0].y);
   if(reused.area!==first.area)throw Error('Clear did not preserve embedding');
   const match=associateSelection(refined,detections,false);
   const p=points[0],n=points[2];
   results.push({name:f.name,file:f.file,firstArea:first.area,positiveArea:positive.area,refinedArea:refined.area,
    positiveIncluded:!!refined.mask[Math.floor(p.y)*c.width+Math.floor(p.x)],negativeExcluded:!refined.mask[Math.floor(n.y)*c.width+Math.floor(n.x)],boxArea:boxed.area,
    yolo: detections.map(d=>({label:d.className,confidence:d.confidence})),match:match?{label:match.detection.className,iou:match.iou,coverage:match.coverage}:null});
  }
  const custom=document.createElement('canvas');custom.width=640;custom.height=480;
  const ctx=custom.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,640,480);ctx.fillStyle='#a8753e';
  ctx.beginPath();ctx.moveTo(80,140);ctx.lineTo(140,100);ctx.lineTo(210,150);ctx.lineTo(170,190);ctx.lineTo(220,250);ctx.lineTo(120,320);ctx.lineTo(60,250);ctx.closePath();ctx.fill();
  await sam.capture(custom);const prototype=await sam.refine({points:[{x:140,y:210,label:1},{x:120,y:270,label:1},{x:250,y:210,label:0}]});
  prototype.displayName='Gearbox Prototype';const customDetections=await yolo.detect(custom,0.25);
  const customMatch=associateSelection(prototype,customDetections,false);
  results.push({name:prototype.displayName,area:prototype.area,match:customMatch?.detection.className??null});
  sam.dispose();await yolo.dispose();return results;
 },fixtures);
 await writeFile('test-results/sam-refinement.json',JSON.stringify({results,encoderCalls:logs.filter(l=>l.includes('embedding ms')).length,decoderCalls:logs.filter(l=>l.includes('decode ms')).length},null,2));
 console.log(JSON.stringify(results,null,2));
 console.log('Encoder calls:',logs.filter(l=>l.includes('embedding ms')).length,'expected:',fixtures.length+1);
}finally{await browser.close();}
