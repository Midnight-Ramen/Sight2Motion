import { chromium, expect } from '@playwright/test';
const b=await chromium.launch({channel:'chrome',headless:true}),p=await b.newPage({viewport:{width:1440,height:900}});
await p.addInitScript(()=>{
 window.hardware={encoder:0,turnPair:null,available:true,paths:[]};
 const original=window.fetch;
 window.fetch=async(url,options)=>{
  if(!String(url).startsWith('http://127.0.0.1:30061/'))return original(url,options);
  const h=window.hardware,path=new URL(String(url)).pathname;h.paths.push(path);
  return new Response(path.includes('/Encoder/')?(h.available?String(h.turnPair?(path.includes('/Left/')?h.turnPair.left:h.turnPair.right):h.encoder):'Not Connected'):path.includes('/Distance/')?'100':path.includes('/in/')?'true':'200');
 };
});
const stopped=()=>p.evaluate(()=>window.hardware.paths.filter(x=>x.includes('/stopall/')).length);
try{
 await p.goto('http://127.0.0.1:5174');await p.getByRole('button',{name:'Your robot',exact:true}).click();await p.getByRole('button',{name:'Connect Finch 2 A',exact:true}).click();
 const forward=p.getByRole('button',{name:'Forward',exact:true});await expect(forward).toBeEnabled();
 await expect(p.getByText('Turn calibration required',{exact:true})).toHaveCount(0);await expect(p.getByRole('button',{name:'Turn Left',exact:true})).toBeEnabled();

 await p.getByText('Home & path recording',{exact:true}).click();
 await p.getByRole('button',{name:'Set Home',exact:true}).click();
 await p.getByLabel('Turn angle degrees').fill('180');
 await p.getByRole('button',{name:'Turn Left',exact:true}).click();
 await expect(p.getByText('Turning left 180°…',{exact:true})).toBeVisible();
 await p.evaluate(()=>window.hardware.turnPair={left:-1.01,right:1.01});
 await expect(p.getByText('Navigation complete',{exact:true})).toBeVisible();
 await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: -1.01 · Δ Right: +1.01');
 await p.getByLabel('Turn angle degrees').fill('360');
 await p.getByRole('button',{name:'Turn Right',exact:true}).click();
 await expect(p.getByText('Turning right 360°…',{exact:true})).toBeVisible();
 await p.evaluate(()=>window.hardware.turnPair={left:0,right:0});
 await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: +0.00 · Δ Right: +0.00');
 await expect(p.getByText('Turning right 360°…',{exact:true})).toBeVisible();
 await p.evaluate(()=>window.hardware.turnPair={left:1.01,right:-1.01});
 await expect(p.getByText('Navigation complete',{exact:true})).toBeVisible();
 await expect(p.getByLabel('Encoder recording')).toContainText('Δ Left: +1.01 · Δ Right: -1.01');
 await p.evaluate(()=>window.hardware.turnPair=null);
 await p.getByLabel('Turn angle degrees').fill('90');
 for(const event of ['space','button','blur','hidden','stale','manual','complete','disconnect']){
  await expect(forward).toBeEnabled();await p.getByRole('button',{name:event==='complete'?'Forward':'Turn Right',exact:true}).click();await expect(p.getByText(event==='complete'?'Driving 30 cm…':'Turning right 90°…',{exact:true})).toBeVisible();await expect(forward).toBeDisabled();const n=await stopped();
  if(event==='space')await p.keyboard.press('Space');
  if(event==='button')await p.getByRole('button',{name:/STOP ROBOT/}).click();
  if(event==='blur')await p.evaluate(()=>window.dispatchEvent(new Event('blur')));
  if(event==='hidden')await p.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  if(event==='stale')await p.evaluate(()=>window.hardware.available=false);
  if(event==='complete')await p.evaluate(()=>window.hardware.encoder+=30/(Math.PI*5));
  if(event==='disconnect')await p.getByRole('button',{name:'Disconnect from app',exact:true}).click();
  if(event==='manual'){await p.getByRole('button',{name:'Drive forward',exact:true}).focus();await p.keyboard.down('w');}
  await expect.poll(stopped).toBeGreaterThan(n);
  if(event==='manual')await p.keyboard.up('w');
  if(event==='stale')await p.evaluate(()=>window.hardware.available=true);
  if(event==='hidden')await p.evaluate(()=>Object.defineProperty(document,'hidden',{value:false,configurable:true}));
 }
 console.log('Navigation completion, enabled turns, Space/button/blur/hidden/stale/disconnect and manual takeover passed; all hardware mocked.');
}finally{await b.close();}
