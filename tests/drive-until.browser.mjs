import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage();
let distance=100,available=true;const paths=[];
await p.route('http://127.0.0.1:30061/**',r=>{
 const path=new URL(r.request().url()).pathname;paths.push(path);
 return r.fulfill({body:path.includes('/Distance/')?(available?String(distance):'Not Connected'):path.includes('/Encoder/')?'0':path.includes('/in/')?'true':'200'});
});
const stopped=()=>paths.filter(x=>x.includes('/stopall/')).length;
try{
 await p.goto('http://127.0.0.1:5174');
 await p.getByRole('button',{name:'Your robot',exact:true}).click();
 await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await p.getByRole('button',{name:'+ Add behavior',exact:true}).click();await p.getByLabel('Add behavior',{exact:true}).selectOption('Drive Until');
 const start=p.getByRole('button',{name:'Start Drive Until',exact:true});
 await expect(start).toBeEnabled();
 await p.getByRole('spinbutton',{name:'Drive Until speed',exact:true}).fill('25');
 await expect(p.getByRole('slider',{name:'Drive Until speed slider',exact:true})).toHaveValue('25');
 for(const event of ['condition','space','button','blur','hidden','stale','manual','emergency','disconnect']){
  distance=100;available=true;await expect(start).toBeEnabled();
  if(event==='emergency')await p.getByLabel('Emergency stop distance',{exact:true}).check();
  await start.click();await expect(p.getByText('Driving until distance condition…',{exact:true})).toBeVisible();
  const n=stopped();
  if(event==='condition')distance=19;
  if(event==='space')await p.keyboard.press('Space');
  if(event==='button')await p.getByRole('button',{name:/STOP ROBOT/}).click();
  if(event==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(event==='hidden')await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(event==='stale')available=false;
  if(event==='manual'){await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');}
  if(event==='emergency')distance=10;
  if(event==='disconnect')await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();
  await expect.poll(stopped).toBeGreaterThan(n);
  if(event==='manual')await p.keyboard.up('w');
  if(event==='hidden')await p.evaluate(()=>Object.defineProperty(document,'hidden',{value:false,configurable:true}));
  if(event==='emergency')await expect(p.getByText('Emergency braking: obstacle distance',{exact:true})).toBeVisible();
  if(event==='condition')await expect(p.getByText('Drive Until complete',{exact:true})).toBeVisible();
  distance=100;available=true;
  // Wait for the existing provider to refresh the restored distance before restarting.
  if(event!=='disconnect')await p.waitForTimeout(350);
 }
 console.log('Drive Until condition, speed sync, Space/STOP/blur/hidden/stale/manual/disconnect and emergency braking passed; hardware mocked.');
}finally{await b.close();}
