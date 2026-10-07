import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage({viewport:{width:1440,height:900}});
let encoder=0,turnPair=null,available=true;const paths=[];
await p.route('http://127.0.0.1:30061/**',r=>{const path=new URL(r.request().url()).pathname;paths.push(path);return r.fulfill({body:path.includes('/Encoder/')?(available?String(turnPair ? (path.includes('/Left/')?turnPair.left:turnPair.right) : encoder):'Not Connected'):path.includes('/in/')?'true':'200'});});
const stopped=()=>paths.filter(x=>x.includes('/stopall/')).length;
try{
 await p.goto('http://127.0.0.1:5174');await p.getByRole('button',{name:'Your robot',exact:true}).click();await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 const forward=p.getByRole('button',{name:'Forward',exact:true});await expect(forward).toBeEnabled();
 await expect(p.getByText('Turn calibration required',{exact:true})).toHaveCount(0);await expect(p.getByRole('button',{name:'Turn Left',exact:true})).toBeEnabled();

 await p.getByRole('button',{name:'Set Home',exact:true}).click();
 await p.getByLabel('Turn angle degrees').fill('180');
 await p.getByRole('button',{name:'Turn Left',exact:true}).click();
 await expect(p.getByText('Turning left 180°…',{exact:true})).toBeVisible();
 turnPair={left:-1.01,right:1.01};
 await expect(p.getByText('Navigation complete',{exact:true})).toBeVisible();
 await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: -1.01 · Δ Right: +1.01');
 await p.getByLabel('Turn angle degrees').fill('360');
 await p.getByRole('button',{name:'Turn Right',exact:true}).click();
 await expect(p.getByText('Turning right 360°…',{exact:true})).toBeVisible();
 turnPair={left:0,right:0};
 await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: +0.00 · Δ Right: +0.00');
 await expect(p.getByText('Turning right 360°…',{exact:true})).toBeVisible();
 turnPair={left:1.01,right:-1.01};
 await expect(p.getByText('Navigation complete',{exact:true})).toBeVisible();
 await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: +1.01 · Δ Right: -1.01');
 turnPair=null;
 await p.getByLabel('Turn angle degrees').fill('90');
 for(const event of ['space','button','blur','hidden','stale','manual','complete','disconnect']){
  await expect(forward).toBeEnabled();await p.getByRole('button',{name:event==='complete'?'Forward':'Turn Right',exact:true}).click();await expect(p.getByText(event==='complete'?'Driving 30 cm…':'Turning right 90°…',{exact:true})).toBeVisible();await expect(forward).toBeDisabled();const n=stopped();
  if(event==='space')await p.keyboard.press('Space');
  if(event==='button')await p.getByRole('button',{name:/STOP ROBOT/}).click();
  if(event==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(event==='hidden')await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(event==='stale')available=false;
  if(event==='complete')encoder+=30/(Math.PI*5);
  if(event==='disconnect')await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();
  if(event==='manual'){await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');}
  await expect.poll(stopped).toBeGreaterThan(n);
  if(event==='manual')await p.keyboard.up('w');
  if(event==='stale')available=true;
  if(event==='hidden')await p.evaluate(()=>Object.defineProperty(document,'hidden',{value:false,configurable:true}));
 }
 console.log('Navigation completion, enabled turns, Space/button/blur/hidden/stale/disconnect and manual takeover passed; all hardware mocked.');
}finally{await b.close();}
