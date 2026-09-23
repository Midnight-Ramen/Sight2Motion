// Requires Ultralytics coco128.zip extracted under test-results and Vite on port 5174.
import { chromium } from '@playwright/test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const labels = 'test-results/coco128/labels/train2017/';
const ids = { person: 0, bottle:39, 'cell phone':67, chair:56, backpack:24 };
const fixtures=[];
for (const [name,id] of Object.entries(ids)) {
  let count=0;
  for (const file of await readdir(labels)) {
    const rows=(await readFile(labels+file,'utf8')).trim().split('\n');
    if (rows.some(r => Number(r.split(' ')[0])===id)) {
      fixtures.push({ name, file:file.replace('.txt','.jpg') });
      if (++count===3) break;
    }
  }
}
const reports=[];
for (const mode of ['webgpu','wasm']) {
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage();
  page.on('console',m=>{ if(m.text().includes('YOLO11')) console.log(mode,m.text()); });
  await page.route('**/yolo-fixture/*',r=>r.fulfill({path:'test-results/coco128/images/train2017/'+new URL(r.request().url()).pathname.split('/').pop(),contentType:'image/jpeg'}));
  if(mode==='wasm') await page.addInitScript(()=>Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true}));
  await page.goto('http://127.0.0.1:5174');
  const report=await page.evaluate(async ({fixtures,mode})=>{
   const {YoloVisionEngine}=await import('/src/core/VisionEngine.ts');
   const {orientDetections}=await import('/src/core/CameraOrientation.ts');
   const {withDetectionRegions}=await import('/src/core/DetectionRegions.ts');
   const {followTargets}=await import('/src/core/DetectionManager.ts');
   const {makeRule}=await import('/src/core/types.ts');
   const engine=new YoloVisionEngine(); const backend=await engine.load('./models/yolo11n.onnx');
   const results=[];
   for(const fixture of fixtures) {
    const image=new Image(); image.src='/yolo-fixture/'+fixture.file; await image.decode();
    const start=performance.now(); const detections=await engine.detect(image,0.25); const elapsed=performance.now()-start;
    const mirrored=withDetectionRegions(orientDetections(detections,image.width,true),image.width);
    for(let i=0;i<detections.length;i++) {
     const d=detections[i],m=mirrored[i];
     if(Math.abs(m.x-(image.width-d.x-d.width))>0.001 || m.width!==d.width) throw Error('Mirror regression');
     const targets=followTargets({...makeRule(),className:m.className,confidence:0.25},[m],image.width,image.height);
     if(!targets.length || Math.abs(targets[0].x-m.x/image.width)>0.001) throw Error('Follow coordinate regression');
    }
    results.push({expected:fixture.name,file:fixture.file,ms:Math.round(elapsed),detections:detections.map(d=>({class:d.className,confidence:+d.confidence.toFixed(3)}))});
   }
   await engine.dispose(); return {mode,backend,results};
  },{fixtures,mode});
  for (const name of Object.keys(ids)) {
    if (!report.results.some(r => r.expected === name && r.detections.some(d => d.class === name))) throw Error('Missing fixture detection: ' + name);
  }
  reports.push(report); console.log(JSON.stringify(report));
 } finally {await browser.close();}
}
await writeFile('test-results/yolo11-report.json',JSON.stringify(reports,null,2));
