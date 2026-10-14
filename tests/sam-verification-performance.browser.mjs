import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
await page.route('http://127.0.0.1:30061/**',r=>r.fulfill({body:'false'}));
page.on('console',m=>{if(m.text().includes('MobileSAM'))console.log(m.text());});
try {await page.goto('http://127.0.0.1:5174');const result=await page.evaluate(async()=>{
 const {MobileSAMSegmenter}=await import('/src/core/MobileSAMSegmenter.ts');
 const {AppearanceTracker,clusterAppearanceCandidates}=await import('/src/core/AppearanceTracker.ts');
 const {createSAMVerifier}=await import('/src/core/SAMCandidateVerification.ts');
 const {captureTargetReference}=await import('/src/components/TargetReferenceCapture.ts');
 const {summarizeMask}=await import('/src/core/SegmentationGeometry.ts');
 const sam=new MobileSAMSegmenter(),canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const ctx=canvas.getContext('2d');ctx.fillStyle='#ddd';ctx.fillRect(0,0,160,120);ctx.fillStyle='#348547';ctx.fillRect(50,35,35,53);
 const image=ctx.getImageData(0,0,160,120),mask=new Uint8Array(160*120);for(let y=35;y<88;y++)for(let x=50;x<85;x++)mask[y*160+x]=1;
 const segment=summarizeMask(mask,160,120),reference=captureTargetReference(canvas,segment,AppearanceTracker.reference(image,segment));
 const profile={label:'Synthetic cup',matchThreshold:.7,references:[reference]},tracker=new AppearanceTracker();tracker.initializeProfile(profile,false,160,120);
 const start=performance.now();await sam.load();const loadMs=performance.now()-start,verify=createSAMVerifier(()=>sam,profile.references),cycles=[];
 for(let n=0;n<2;n++){const t=performance.now();const candidates=clusterAppearanceCandidates(tracker.globalSearch(image)).slice(0,5);const coarseMs=performance.now()-t;const result=await verify(image,candidates,new AbortController().signal);cycles.push({coarseMs,shortlist:candidates.length,samMs:result.samMs,totalCycleMs:performance.now()-t,verified:result.verifiedCount,verifiedScores:result.candidates.map(c=>c.score)});}
 sam.dispose();return {loadMs,cycles,note:'Actual installed SAM + descriptors and coarse search in headless Chrome on a synthetic frame. No physical robot/camera.'};});writeFileSync('test-results/sam-verification-cycle.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}finally{await browser.close();}
