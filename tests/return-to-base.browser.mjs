import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage({viewport:{width:1440,height:900}});
let encoder=0,available=true;const paths=[];
await p.route('http://127.0.0.1:30061/**',r=>{const path=new URL(r.request().url()).pathname;paths.push(path);return r.fulfill({body:path.includes('/Encoder/')?(available?String(encoder):'Not Connected'):path.includes('/in/')?'true':'200'});});
const stopped=()=>paths.filter(x=>x.includes('/stopall/')).length;
try{
 await p.goto('http://127.0.0.1:5174');
 await p.getByRole('button',{name:'Your robot',exact:true}).click();
 await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 await p.getByText('Home & path recording',{exact:true}).click();
 const home=p.getByRole('button',{name:'Set Home',exact:true});
 const back=p.getByRole('button',{name:'Return to Base',exact:true});
 await expect(back).toBeDisabled();
 for(const event of ['complete','space','button','blur','hidden','stale','manual','panel','disconnect']){
  await expect(home).toBeEnabled();await home.click();
  await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');
  encoder+=1;
  await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: +1.00');
  await p.keyboard.up('w');await expect(back).toBeEnabled();await back.click();
  await expect(p.getByText('Returning to Base · 1/1',{exact:true})).toBeVisible();
  await expect(home).toBeDisabled();const n=stopped();
  if(event==='complete')encoder-=1;
  if(event==='space')await p.keyboard.press('Space');
  if(event==='button')await p.getByRole('button',{name:/STOP ROBOT/}).click();
  if(event==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(event==='hidden')await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(event==='stale')available=false;
  if(event==='manual'){await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');}
  if(event==='panel')await p.getByRole('button',{name:'Your robot',exact:true}).click();
  if(event==='disconnect')await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();
  await expect.poll(stopped).toBeGreaterThan(n);
  if(event==='manual')await p.keyboard.up('w');
  if(event==='stale')available=true;
  if(event==='hidden')await p.evaluate(()=>Object.defineProperty(document,'hidden',{value:false,configurable:true}));
  if(event==='panel')await p.getByRole('button',{name:'Your robot',exact:true}).click();
  if(event==='complete'){
   await expect(p.getByText('At Home',{exact:true})).toBeVisible();
   await expect(p.getByLabel('Encoder recording')).toContainText('Home: Set');
  }else await expect(p.getByLabel('Encoder recording')).toContainText('Home: Not set');
  await expect(p.getByText('Path: 0 segments',{exact:true})).toBeVisible();
  await expect(back).toBeDisabled();
 }
 console.log('Return success and Space/STOP/blur/hidden/stale/manual/panel/disconnect invalidation passed; all hardware mocked.');
}finally{await b.close();}
